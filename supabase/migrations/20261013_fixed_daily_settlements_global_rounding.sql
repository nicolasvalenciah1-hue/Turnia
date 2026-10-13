-- Turnia: fixed historical settlements and exact-peso, global largest remainder rounding.
-- Existing day/shift records stay intact; two legacy +/- $1 discrepancies are
-- recorded in a privileged audit table before normalizing their payout snapshots.

CREATE TABLE IF NOT EXISTS public.propina_day_settlements (
  day_id uuid NOT NULL REFERENCES public.propina_days(id) ON DELETE RESTRICT,
  restaurant_id uuid NOT NULL REFERENCES public.propina_restaurants(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  area_id uuid NOT NULL,
  area_name text NOT NULL,
  percentage numeric NOT NULL,
  worker_id uuid NOT NULL,
  worker_name text NOT NULL,
  hours numeric NOT NULL,
  calculated_clp bigint NOT NULL CHECK (calculated_clp>=0),
  fixed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(day_id,worker_id),
  FOREIGN KEY (day_id,restaurant_id) REFERENCES public.propina_days(id,restaurant_id)
);
CREATE INDEX IF NOT EXISTS propina_day_settlements_restaurant_day_idx
 ON public.propina_day_settlements (restaurant_id,work_date);
CREATE INDEX IF NOT EXISTS propina_day_settlements_worker_idx
 ON public.propina_day_settlements (restaurant_id,worker_id);
ALTER TABLE public.propina_day_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_snapshot_read ON public.propina_day_settlements;
CREATE POLICY settlement_snapshot_read ON public.propina_day_settlements
 FOR SELECT TO authenticated
 USING (propina_private.can_read_restaurant(restaurant_id));
REVOKE ALL ON public.propina_day_settlements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.propina_day_settlements TO authenticated;
COMMENT ON TABLE public.propina_day_settlements IS 'Immutable saved classic daily payouts; inserted/replaced only by authorized save_day RPC.';

CREATE TABLE IF NOT EXISTS propina_private.day_settlement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES public.propina_days(id) ON DELETE RESTRICT,
  restaurant_id uuid NOT NULL REFERENCES public.propina_restaurants(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  change_kind text NOT NULL CHECK (change_kind IN ('rounding_normalization','explicit_revision')),
  actor uuid,
  previous_amount_clp bigint NOT NULL,
  previous_total_clp bigint NOT NULL,
  previous_rows jsonb NOT NULL
);
ALTER TABLE propina_private.day_settlement_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE propina_private.day_settlement_history FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS day_settlement_history_day_idx
 ON propina_private.day_settlement_history (day_id,recorded_at DESC);

-- Reconstructed calculation for unsnapshotted legacy/test rows, never the source
-- of truth for saved historical data.
CREATE OR REPLACE VIEW public.propina_daily_distribution_live WITH (security_invoker=true) AS
WITH attendees AS (
  SELECT d.id AS day_id,d.restaurant_id,d.work_date,d.amount_clp,
         a.id AS area_id,a.name AS area_name,a.percentage,
         w.id AS worker_id,w.name AS worker_name,s.hours,
         s.hours*s.participation AS effective_weight,
         sum(s.hours*s.participation) OVER (PARTITION BY d.id,a.id) AS area_weight
  FROM public.propina_days d
  JOIN public.propina_shifts s ON s.day_id=d.id AND s.restaurant_id=d.restaurant_id
  JOIN public.propina_workers w ON w.id=s.worker_id AND w.restaurant_id=d.restaurant_id
  JOIN public.propina_areas a ON a.id=w.area_id AND a.restaurant_id=d.restaurant_id
), area_quotas AS (
  SELECT day_id,restaurant_id,work_date,amount_clp,area_id,area_name,percentage,
         amount_clp::numeric*percentage/100 AS exact_pool
  FROM attendees
  GROUP BY day_id,restaurant_id,work_date,amount_clp,area_id,area_name,percentage
), area_rank AS (
  SELECT q.*,
         floor(exact_pool)::bigint AS base_pool,
         row_number() OVER
           (PARTITION BY day_id ORDER BY exact_pool-floor(exact_pool) DESC,area_id) AS area_rank,
         sum(floor(exact_pool)::bigint) OVER (PARTITION BY day_id) AS base_total
  FROM area_quotas q
), area_budgets AS (
  SELECT day_id,area_id,
         (base_pool + CASE WHEN area_rank<=amount_clp-base_total THEN 1 ELSE 0 END)::bigint AS pool_clp
  FROM area_rank
), worker_quotas AS (
  SELECT a.day_id,a.restaurant_id,a.work_date,a.area_id,a.area_name,a.percentage,
         a.worker_id,a.worker_name,a.hours,
         (b.pool_clp::numeric*a.effective_weight/NULLIF(a.area_weight,0)) AS exact_share,
         b.pool_clp
  FROM attendees a JOIN area_budgets b ON b.day_id=a.day_id AND b.area_id=a.area_id
), worker_rank AS (
  SELECT q.*,
         floor(exact_share)::bigint AS base_share,
         row_number() OVER (PARTITION BY day_id,area_id
             ORDER BY exact_share-floor(exact_share) DESC,worker_id) AS worker_rank,
         sum(floor(exact_share)::bigint) OVER (PARTITION BY day_id,area_id) AS base_total
  FROM worker_quotas q
)
SELECT day_id,restaurant_id,work_date,area_id,area_name,percentage,
       worker_id,worker_name,hours,
       (base_share + CASE WHEN worker_rank<=pool_clp-base_total THEN 1 ELSE 0 END)::numeric AS calculated_clp
FROM worker_rank;
GRANT SELECT ON public.propina_daily_distribution_live TO authenticated;

-- Preserve evidence of the two observed historical 1-CLP discrepancies.
INSERT INTO propina_private.day_settlement_history
  (day_id,restaurant_id,change_kind,actor,previous_amount_clp,previous_total_clp,previous_rows)
SELECT d.id,d.restaurant_id,'rounding_normalization',NULL,d.amount_clp,
       sum(v.calculated_clp)::bigint,jsonb_agg(to_jsonb(v) ORDER BY v.worker_id)
FROM public.propina_days d JOIN public.propina_daily_distribution v ON v.day_id=d.id
GROUP BY d.id,d.restaurant_id,d.amount_clp
HAVING sum(v.calculated_clp)<>d.amount_clp;

-- Backfill exactly one snapshot per selected worker for all existing classic days.
INSERT INTO public.propina_day_settlements
  (day_id,restaurant_id,work_date,area_id,area_name,percentage,worker_id,worker_name,hours,calculated_clp)
SELECT day_id,restaurant_id,work_date,area_id,area_name,percentage,
       worker_id,worker_name,hours,calculated_clp::bigint
FROM public.propina_daily_distribution_live
ON CONFLICT(day_id,worker_id) DO NOTHING;

DO $integrity$
BEGIN
 IF EXISTS (
   SELECT 1 FROM public.propina_days d
   LEFT JOIN public.propina_day_settlements s ON s.day_id=d.id
   GROUP BY d.id,d.amount_clp
   HAVING count(s.worker_id)=0 OR coalesce(sum(s.calculated_clp),0)<>d.amount_clp
 ) THEN
   RAISE EXCEPTION 'Historical settlement backfill mismatch; migration rolled back.';
 END IF;
END
$integrity$;

-- Same columns and types as the previous public view, so existing UI/RPC keeps working.
CREATE OR REPLACE VIEW public.propina_daily_distribution WITH (security_invoker=true) AS
 SELECT s.day_id,s.restaurant_id,s.work_date,s.area_id,s.area_name,s.percentage,
        s.worker_id,s.worker_name,s.hours,s.calculated_clp::numeric AS calculated_clp
 FROM public.propina_day_settlements s
 UNION ALL
 SELECT v.day_id,v.restaurant_id,v.work_date,v.area_id,v.area_name,v.percentage,
        v.worker_id,v.worker_name,v.hours,v.calculated_clp
 FROM public.propina_daily_distribution_live v
 WHERE NOT EXISTS (SELECT 1 FROM public.propina_day_settlements s WHERE s.day_id=v.day_id);
GRANT SELECT ON public.propina_daily_distribution TO authenticated;

-- Deny direct writes that would bypass the snapshot and revision log.
-- Authorized save uses SECURITY DEFINER, validates auth.uid and can_edit_restaurant.
REVOKE INSERT,UPDATE,DELETE ON public.propina_days,public.propina_shifts FROM authenticated,anon;

CREATE OR REPLACE FUNCTION public.propina_save_day(p_restaurant uuid, p_date date, p_amount bigint, p_shift_hours numeric, p_workers jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  d uuid;
  total numeric;
  worker_entry jsonb;
  wid uuid;
  h numeric;
  participation numeric;
  reason text;
  accepted boolean;
  missing_count integer;
  prior_day uuid;
  previous_rows jsonb;
  previous_total bigint;
  payout_total bigint;
  payout_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT propina_private.can_edit_restaurant(p_restaurant) THEN
    RAISE EXCEPTION 'No tienes permisos para guardar esta jornada.' USING ERRCODE='42501';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 OR p_date IS NULL
     OR p_shift_hours IS NULL OR p_shift_hours <= 0 OR p_shift_hours > 24
  THEN
    RAISE EXCEPTION 'Jornada inválida';
  END IF;

  IF p_workers IS NULL OR jsonb_typeof(p_workers) <> 'array'
     OR jsonb_array_length(p_workers) = 0
  THEN
    RAISE EXCEPTION 'Selecciona trabajadores';
  END IF;

  -- Serialize all daily writes, including flexible shift saves, by restaurant.
  PERFORM 1 FROM public.propina_restaurants WHERE id=p_restaurant FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.propina_flex_shifts
     WHERE restaurant_id=p_restaurant AND work_date=p_date) THEN
    RAISE EXCEPTION 'Esta fecha ya tiene turnos AM/PM. No mezcles métodos de reparto.';
  END IF;
  SELECT coalesce(sum(a.percentage),0)
    INTO total
  FROM public.propina_areas AS a
  WHERE a.restaurant_id = p_restaurant;

  IF total <> 100 THEN
    RAISE EXCEPTION 'Los porcentajes deben sumar 100';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_workers))
     <> (SELECT count(DISTINCT selected_worker.value->>'worker_id')
         FROM jsonb_array_elements(p_workers) AS selected_worker(value))
  THEN
    RAISE EXCEPTION 'Trabajador duplicado';
  END IF;

  FOR worker_entry IN
    SELECT selected_worker.value
    FROM jsonb_array_elements(p_workers) AS selected_worker(value)
  LOOP
    wid := (worker_entry->>'worker_id')::uuid;
    h := (worker_entry->>'hours')::numeric;
    participation := coalesce((worker_entry->>'participation')::numeric,1);
    reason := btrim(coalesce(worker_entry->>'note',''));
    accepted := coalesce((worker_entry->>'agreed')::boolean,false);
    IF h IS NULL OR h <= 0 OR h > 24
       OR NOT EXISTS (
         SELECT 1 FROM public.propina_workers AS w
         WHERE w.id = wid AND w.restaurant_id = p_restaurant
       )
    THEN
      RAISE EXCEPTION 'Horas o trabajador inválido';
    END IF;
    IF participation < 0.01 OR participation > 2 OR length(reason) > 300 THEN
      RAISE EXCEPTION 'Participación inválida: usa un porcentaje entre 1 y 200.';
    END IF;
    IF h * participation / p_shift_hours > 2.000001 THEN
      RAISE EXCEPTION 'Máximo 2 puntos por trabajador. Para 16 horas con base de 8, se aplica 100 por ciento y no 200.';
    END IF;
    IF participation <> 1 AND (NOT accepted OR length(reason) < 10) THEN
      RAISE EXCEPTION 'Una participación distinta de 100%% requiere acuerdo confirmado y motivo de al menos 10 caracteres.';
    END IF;
  END LOOP;

  SELECT count(*) INTO missing_count
  FROM public.propina_areas AS a
  WHERE a.restaurant_id = p_restaurant
    AND a.percentage > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.propina_workers AS w
      JOIN jsonb_array_elements(p_workers) AS selected_worker(value)
        ON (selected_worker.value->>'worker_id')::uuid = w.id
      WHERE w.area_id = a.id AND w.restaurant_id = p_restaurant
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Falta personal en un área con porcentaje';
  END IF;

  -- When deliberately replacing a day, retain the previous fixed settlement.
  SELECT id INTO prior_day FROM public.propina_days
   WHERE restaurant_id=p_restaurant AND work_date=p_date FOR UPDATE;
  IF prior_day IS NOT NULL AND EXISTS
    (SELECT 1 FROM public.propina_day_settlements WHERE day_id=prior_day) THEN
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.worker_id),coalesce(sum(s.calculated_clp),0)
      INTO previous_rows,previous_total
    FROM public.propina_day_settlements s WHERE s.day_id=prior_day;
    INSERT INTO propina_private.day_settlement_history
       (day_id,restaurant_id,change_kind,actor,previous_amount_clp,previous_total_clp,previous_rows)
    SELECT d.id,d.restaurant_id,'explicit_revision',auth.uid(),d.amount_clp,
           previous_total,previous_rows
    FROM public.propina_days d WHERE d.id=prior_day;
    DELETE FROM public.propina_day_settlements WHERE day_id=prior_day;
  END IF;

  INSERT INTO public.propina_days(restaurant_id,work_date,amount_clp,hours_per_shift)
  VALUES(p_restaurant,p_date,p_amount,p_shift_hours)
  ON CONFLICT(restaurant_id,work_date)
  DO UPDATE SET
    amount_clp = excluded.amount_clp,
    hours_per_shift = excluded.hours_per_shift
  RETURNING id INTO d;

  DELETE FROM public.propina_shifts
  WHERE day_id = d AND restaurant_id = p_restaurant;

  INSERT INTO public.propina_shifts(restaurant_id,day_id,worker_id,hours,participation,note,agreed)
  SELECT p_restaurant,d,
         (selected_worker.value->>'worker_id')::uuid,
         (selected_worker.value->>'hours')::numeric,
         coalesce((selected_worker.value->>'participation')::numeric,1),
         btrim(coalesce(selected_worker.value->>'note','')),
         coalesce((selected_worker.value->>'agreed')::boolean,false)
  FROM jsonb_array_elements(p_workers) AS selected_worker(value);

  INSERT INTO public.propina_day_settlements
    (day_id,restaurant_id,work_date,area_id,area_name,percentage,worker_id,worker_name,hours,calculated_clp)
  SELECT day_id,restaurant_id,work_date,area_id,area_name,percentage,worker_id,
         worker_name,hours,calculated_clp::bigint
  FROM public.propina_daily_distribution_live WHERE day_id=d;

  SELECT count(*),coalesce(sum(calculated_clp),0)
    INTO payout_count,payout_total
  FROM public.propina_day_settlements WHERE day_id=d;
  IF payout_count <> jsonb_array_length(p_workers) OR payout_total <> p_amount THEN
    RAISE EXCEPTION 'El reparto no cuadra con la propina ingresada. No se guardó ningún cambio.';
  END IF;
  RETURN d;
END
$function$
;

CREATE OR REPLACE FUNCTION public.propina_save_flex_shift(p_restaurant uuid, p_date date, p_shift text, p_amount bigint, p_modes jsonb, p_entries jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 PERFORM 1 FROM public.propina_restaurants WHERE id=p_restaurant FOR UPDATE;
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
END $function$
;

REVOKE ALL ON FUNCTION public.propina_save_day(uuid,date,bigint,numeric,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propina_save_day(uuid,date,bigint,numeric,jsonb) TO authenticated;
-- Keep the complementary AM/PM guard and serialize both save methods.
NOTIFY pgrst, 'reload schema';
