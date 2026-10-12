-- Full-day restaurant tip allocations remain independent per area.
-- A 16-hour double shift with an 8-hour base already counts as two points.
-- Do not allow 200% participation to turn those two points into four.
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
