-- Turnia: percentage-based participation for full-day shifts.
-- Backward compatibility: historic and legacy shifts default to 100%, with unchanged distribution.
-- Percentages are participation factors *inside* an area's quota, not shares of restaurant totals.
ALTER TABLE public.propina_shifts
  ADD COLUMN IF NOT EXISTS participation numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agreed boolean NOT NULL DEFAULT false;

DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.propina_shifts'::regclass AND conname='propina_shifts_participation_agreement') THEN
    ALTER TABLE public.propina_shifts
      ADD CONSTRAINT propina_shifts_participation_agreement
      CHECK (
        participation BETWEEN 0.01 AND 2
        AND char_length(note) <= 300
        AND (participation = 1 OR (agreed AND char_length(btrim(note)) BETWEEN 10 AND 300))
      );
  END IF;
END $constraint$;

-- The existing RLS policies stay in place; the view remains security_invoker.
CREATE OR REPLACE VIEW public.propina_daily_distribution WITH (security_invoker=true) AS
WITH shares AS (
         SELECT d.id AS day_id,
            d.restaurant_id,
            d.work_date,
            d.amount_clp,
            a.id AS area_id,
            a.name AS area_name,
            a.percentage,
            w.id AS worker_id,
            w.name AS worker_name,
            s.hours,
            s.hours * s.participation AS effective_hours,
            sum(s.hours * s.participation) OVER (PARTITION BY d.id, a.id) AS area_hours
           FROM public.propina_days d
             JOIN public.propina_shifts s ON s.day_id = d.id
             JOIN public.propina_workers w ON w.id = s.worker_id
             JOIN public.propina_areas a ON a.id = w.area_id
        ), quotas AS (
         SELECT shares.day_id,
            shares.restaurant_id,
            shares.work_date,
            shares.amount_clp,
            shares.area_id,
            shares.area_name,
            shares.percentage,
            shares.worker_id,
            shares.worker_name,
            shares.hours,
            shares.area_hours,
            shares.amount_clp::numeric * shares.percentage / 100.0 * shares.effective_hours / NULLIF(shares.area_hours, 0::numeric) AS exact_clp
           FROM shares
        ), ranked AS (
         SELECT quotas.day_id,
            quotas.restaurant_id,
            quotas.work_date,
            quotas.amount_clp,
            quotas.area_id,
            quotas.area_name,
            quotas.percentage,
            quotas.worker_id,
            quotas.worker_name,
            quotas.hours,
            quotas.area_hours,
            quotas.exact_clp,
            floor(quotas.exact_clp)::bigint AS base_clp,
            row_number() OVER (PARTITION BY quotas.day_id, quotas.area_id ORDER BY (quotas.exact_clp - floor(quotas.exact_clp)) DESC, quotas.worker_id) AS rn
           FROM quotas
        ), allocated AS (
         SELECT ranked.day_id,
            ranked.restaurant_id,
            ranked.work_date,
            ranked.amount_clp,
            ranked.area_id,
            ranked.area_name,
            ranked.percentage,
            ranked.worker_id,
            ranked.worker_name,
            ranked.hours,
            ranked.area_hours,
            ranked.exact_clp,
            ranked.base_clp,
            ranked.rn,
            round(ranked.amount_clp::numeric * ranked.percentage / 100.0)::bigint::numeric - sum(ranked.base_clp) OVER (PARTITION BY ranked.day_id, ranked.area_id) AS remaining
           FROM ranked
        )
 SELECT day_id,
    restaurant_id,
    work_date,
    area_id,
    area_name,
    percentage,
    worker_id,
    worker_name,
    hours,
    (base_clp +
        CASE
            WHEN rn::numeric <= remaining THEN 1
            ELSE 0
        END)::numeric AS calculated_clp
   FROM allocated;

-- Preserve the public RPC signature and existing grants. Older clients do not send
-- participation/note/agreed and continue to save with 100% participation.
CREATE OR REPLACE FUNCTION public.propina_save_day(p_restaurant uuid, p_date date, p_amount bigint, p_shift_hours numeric, p_workers jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
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
    IF participation <> 1 AND (NOT accepted OR length(reason) < 10) THEN
      RAISE EXCEPTION 'Una participación distinta de 100% requiere acuerdo confirmado y motivo de al menos 10 caracteres.';
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

  RETURN d;
END
$function$;

-- A linked worker can see the saved percentage on their own history.
-- This is the existing worker-scoped private function; never broaden access.
CREATE OR REPLACE FUNCTION propina_private.propina_my_tips(rid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE wid uuid;
BEGIN
 SELECT a.worker_id INTO wid
 FROM public.propina_access a
 JOIN public.propina_restaurants r ON r.id=a.restaurant_id
 JOIN auth.users u ON u.id=a.user_id
 WHERE a.user_id=auth.uid() AND a.restaurant_id=rid AND a.active AND r.active
   AND u.email_confirmed_at IS NOT NULL;
 IF wid IS NULL THEN
  RAISE EXCEPTION 'No tienes una ficha de trabajador vinculada en este restaurante.'
    USING ERRCODE='42501';
 END IF;
 RETURN (
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'work_date',t.work_date,'hours',t.hours,
   'calculated_clp',t.calculated_clp,'kind',t.kind,
   'group_code',t.group_code,'weight',t.weight
 ) ORDER BY t.work_date DESC,t.group_code),'[]'::jsonb)
 FROM (
 SELECT d.work_date,d.hours,d.calculated_clp,
    'classic'::text AS kind,'CLASICO'::text AS group_code,s.participation AS weight
 FROM public.propina_daily_distribution d
 JOIN public.propina_shifts s ON s.day_id=d.day_id AND s.worker_id=d.worker_id AND s.restaurant_id=d.restaurant_id
 WHERE d.restaurant_id=rid AND d.worker_id=wid
 UNION ALL
 SELECT f.work_date,NULL::numeric AS hours,f.calculated_clp,
   'flex'::text AS kind,f.group_code,f.weight
 FROM public.propina_flex_payouts f
 WHERE f.restaurant_id=rid AND f.worker_id=wid
 ) t
 );
END $function$;
