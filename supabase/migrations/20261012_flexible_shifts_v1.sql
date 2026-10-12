-- Phase 2: new independent AM/PM shift ledger. Never alters legacy propina_days/shifts.
CREATE TABLE IF NOT EXISTS public.propina_flex_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id uuid NOT NULL REFERENCES public.propina_restaurants(id),
 work_date date NOT NULL,
 shift_code text NOT NULL CHECK (shift_code IN ('AM','PM')),
 amount_clp bigint NOT NULL CHECK (amount_clp BETWEEN 0 AND 1000000000000),
 rules jsonb NOT NULL CHECK (jsonb_typeof(rules)='array'),
 entries jsonb NOT NULL CHECK (jsonb_typeof(entries)='array'),
 changed_by uuid NOT NULL REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (restaurant_id,work_date,shift_code)
);
CREATE INDEX IF NOT EXISTS propina_flex_shifts_restaurant_date_idx ON public.propina_flex_shifts (restaurant_id,work_date DESC);
ALTER TABLE public.propina_flex_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flex_shifts_read ON public.propina_flex_shifts;
CREATE POLICY flex_shifts_read ON public.propina_flex_shifts FOR SELECT TO authenticated USING (propina_private.can_read_restaurant(restaurant_id));
REVOKE ALL ON public.propina_flex_shifts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.propina_flex_shifts TO authenticated;

-- Deterministic largest-remainder allocation at area and person level. Both stages
-- reconcile to exact integer CLP totals, including small odd-valued shifts.
CREATE OR REPLACE VIEW public.propina_flex_payouts
WITH (security_invoker=true) AS
WITH area_quota AS (
 SELECT s.id AS shift_id,s.restaurant_id,s.work_date,s.shift_code,
        a.area_id,a.area_name,a.mode,
        (s.amount_clp::numeric*a.percentage/100) AS exact_clp,
        s.amount_clp
 FROM public.propina_flex_shifts s
 CROSS JOIN LATERAL jsonb_to_recordset(s.rules) AS a(area_id uuid,area_name text,percentage numeric,mode text)
), area_ranked AS (
 SELECT q.*,floor(q.exact_clp)::bigint AS base_clp,
   row_number() OVER (PARTITION BY q.shift_id ORDER BY q.exact_clp-floor(q.exact_clp) DESC,q.area_id) AS rn,
   sum(floor(q.exact_clp)::bigint) OVER (PARTITION BY q.shift_id) AS base_total
 FROM area_quota q
), area_budget AS (
 SELECT a.*, (a.base_clp+CASE WHEN a.rn<=a.amount_clp-a.base_total THEN 1 ELSE 0 END)::bigint AS pool_clp,
   CASE WHEN a.mode='daily_unique' THEN 'DIA' ELSE a.shift_code END AS group_code
 FROM area_ranked a
), pools AS (
 SELECT restaurant_id,work_date,area_id,max(area_name) AS area_name,group_code,sum(pool_clp) AS amount_clp
 FROM area_budget GROUP BY restaurant_id,work_date,area_id,group_code
), attendees AS (
 SELECT s.restaurant_id,s.work_date,p.area_id,p.worker_id,max(p.worker_name) AS worker_name,
   CASE WHEN a.mode='daily_unique' THEN 'DIA' ELSE s.shift_code END AS group_code,
   max(p.weight) AS weight
 FROM public.propina_flex_shifts s
 CROSS JOIN LATERAL jsonb_to_recordset(s.rules) AS a(area_id uuid,area_name text,percentage numeric,mode text)
 CROSS JOIN LATERAL jsonb_to_recordset(s.entries) AS p(worker_id uuid,worker_name text,area_id uuid,weight numeric,note text)
 WHERE p.area_id=a.area_id
 GROUP BY s.restaurant_id,s.work_date,p.area_id,p.worker_id,
   CASE WHEN a.mode='daily_unique' THEN 'DIA' ELSE s.shift_code END
), exact_shares AS (
 SELECT p.restaurant_id,p.work_date,p.area_id,p.area_name,p.group_code,
        a.worker_id,a.worker_name,a.weight,p.amount_clp,
        (p.amount_clp::numeric*a.weight/
          nullif(sum(a.weight) OVER(PARTITION BY p.restaurant_id,p.work_date,p.area_id,p.group_code),0)) AS exact_clp
 FROM pools p JOIN attendees a ON a.restaurant_id=p.restaurant_id AND a.work_date=p.work_date AND
        a.area_id=p.area_id AND a.group_code=p.group_code
), ranked AS (
 SELECT e.*, floor(e.exact_clp)::bigint AS base_clp,
        row_number() OVER(PARTITION BY restaurant_id,work_date,area_id,group_code ORDER BY exact_clp-floor(exact_clp) DESC,worker_id) AS rn,
        sum(floor(e.exact_clp)::bigint) OVER(PARTITION BY restaurant_id,work_date,area_id,group_code) AS base_total
 FROM exact_shares e
)
SELECT restaurant_id,work_date,group_code,area_id,area_name,worker_id,worker_name,weight,
 (base_clp+CASE WHEN rn<=amount_clp-base_total THEN 1 ELSE 0 END)::bigint AS calculated_clp
FROM ranked;
REVOKE ALL ON public.propina_flex_payouts FROM PUBLIC,anon;
GRANT SELECT ON public.propina_flex_payouts TO authenticated;

CREATE OR REPLACE FUNCTION public.propina_save_flex_shift(
 p_restaurant uuid,p_date date,p_shift text,p_amount bigint,p_modes jsonb,p_entries jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 v_id uuid; v_rules jsonb; v_count integer; v_area_count integer; v_total numeric;
 item jsonb; the_worker public.propina_workers%ROWTYPE; v_weight numeric;
 v_note text; v_agreed boolean; v_other public.propina_flex_shifts%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT propina_private.can_edit_restaurant(p_restaurant) THEN
  RAISE EXCEPTION 'No tienes permisos para registrar turnos.' USING ERRCODE='42501';
 END IF;
 IF p_date IS NULL OR p_shift NOT IN ('AM','PM') OR p_shift IS NULL
    OR p_amount IS NULL OR p_amount<0 OR p_amount>1000000000000 THEN
  RAISE EXCEPTION 'Revisa fecha, turno y monto.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.propina_days WHERE restaurant_id=p_restaurant AND work_date=p_date) THEN
  RAISE EXCEPTION 'Esta fecha ya tiene una jornada clásica. Usa otra fecha para evitar duplicar propinas.';
 END IF;
 IF p_modes IS NULL OR jsonb_typeof(p_modes)<>'array'
 OR p_entries IS NULL OR jsonb_typeof(p_entries)<>'array'
 OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Selecciona reglas y participantes válidos.';
 END IF;
 SELECT count(*),coalesce(sum(percentage),0) INTO v_area_count,v_total
 FROM public.propina_areas WHERE restaurant_id=p_restaurant AND percentage>0;
 IF v_area_count=0 OR v_total<>100 THEN RAISE EXCEPTION 'Los porcentajes de áreas deben sumar 100.'; END IF;
 IF jsonb_array_length(p_modes)<>v_area_count OR
   (SELECT count(DISTINCT x.value->>'area_id') FROM jsonb_array_elements(p_modes) x)<>v_area_count THEN
   RAISE EXCEPTION 'Configura un método por cada área.';
 END IF;
 IF EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_modes) x LEFT JOIN public.propina_areas a
  ON a.id=(x.value->>'area_id')::uuid AND a.restaurant_id=p_restaurant AND a.percentage>0
  WHERE a.id IS NULL OR (x.value->>'mode') NOT IN ('per_shift','daily_unique')
 ) THEN RAISE EXCEPTION 'Regla de área inválida.'; END IF;
 SELECT jsonb_agg(jsonb_build_object('area_id',a.id,'area_name',a.name,'percentage',a.percentage,'mode',m.value->>'mode') ORDER BY a.id)
 INTO v_rules
 FROM public.propina_areas a JOIN jsonb_array_elements(p_modes) m ON (m.value->>'area_id')::uuid=a.id
 WHERE a.restaurant_id=p_restaurant AND a.percentage>0;
 IF jsonb_array_length(v_rules)<>v_area_count THEN RAISE EXCEPTION 'Falta configurar alguna área.'; END IF;
 IF (SELECT count(DISTINCT x.value->>'worker_id') FROM jsonb_array_elements(p_entries) x)
      <>jsonb_array_length(p_entries) THEN RAISE EXCEPTION 'Hay trabajadores repetidos.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_entries)
 LOOP
  SELECT * INTO the_worker FROM public.propina_workers WHERE id=(item->>'worker_id')::uuid
    AND restaurant_id=p_restaurant AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trabajador inválido o inactivo.'; END IF;
  v_weight:=(item->>'weight')::numeric;
  v_note:=btrim(coalesce(item->>'note',''));
  v_agreed:=coalesce((item->>'agreed')::boolean,false);
  IF v_weight IS NULL OR v_weight<0.01 OR v_weight>2 THEN
   RAISE EXCEPTION 'Las participaciones deben estar entre 0,01 y 2.';
  END IF;
  IF v_weight<>1 AND (NOT v_agreed OR length(v_note) NOT BETWEEN 10 AND 300) THEN
   RAISE EXCEPTION 'Una participación especial requiere acuerdo confirmado y una explicación de 10 a 300 caracteres.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(v_rules) AS a(area_id uuid,area_name text,percentage numeric,mode text)
                WHERE a.area_id=the_worker.area_id) THEN
   RAISE EXCEPTION 'El área del trabajador no participa en el turno.';
  END IF;
 END LOOP;
 IF EXISTS(
 SELECT 1 FROM jsonb_to_recordset(v_rules) a(area_id uuid,area_name text,percentage numeric,mode text)
 WHERE NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_entries) x JOIN public.propina_workers w
   ON w.id=(x.value->>'worker_id')::uuid AND w.restaurant_id=p_restaurant
  WHERE w.area_id=a.area_id
 )) THEN
  RAISE EXCEPTION 'Cada área con porcentaje necesita trabajadores en este turno.';
 END IF;
 -- Daily pool modes must match between AM and PM of the same date.
 SELECT * INTO v_other FROM public.propina_flex_shifts
 WHERE restaurant_id=p_restaurant AND work_date=p_date AND shift_code<>p_shift FOR UPDATE;
 IF FOUND AND EXISTS(
   SELECT 1 FROM jsonb_to_recordset(v_rules) new_rule(area_id uuid,area_name text,percentage numeric,mode text)
   JOIN jsonb_to_recordset(v_other.rules) previous_rule(area_id uuid,area_name text,percentage numeric,mode text)
   ON new_rule.area_id=previous_rule.area_id WHERE new_rule.mode<>previous_rule.mode
 ) THEN RAISE EXCEPTION 'AM y PM deben usar el mismo método de reparto por área.'; END IF;
 INSERT INTO public.propina_flex_shifts(restaurant_id,work_date,shift_code,amount_clp,rules,entries,changed_by)
 SELECT p_restaurant,p_date,p_shift,p_amount,v_rules,
    (SELECT jsonb_agg(jsonb_build_object(
      'worker_id',w.id,'worker_name',w.name,'area_id',w.area_id,
      'weight',(entry.value->>'weight')::numeric,'note',left(btrim(coalesce(entry.value->>'note','')),300),'agreed',coalesce((entry.value->>'agreed')::boolean,false)
     ) ORDER BY w.id) FROM jsonb_array_elements(p_entries) entry
     JOIN public.propina_workers w ON w.id=(entry.value->>'worker_id')::uuid AND w.restaurant_id=p_restaurant),
    auth.uid()
 ON CONFLICT (restaurant_id,work_date,shift_code) DO UPDATE
 SET amount_clp=excluded.amount_clp,rules=excluded.rules,entries=excluded.entries,
     changed_by=excluded.changed_by,updated_at=now()
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.propina_save_flex_shift(uuid,date,text,bigint,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propina_save_flex_shift(uuid,date,text,bigint,jsonb,jsonb) TO authenticated;
