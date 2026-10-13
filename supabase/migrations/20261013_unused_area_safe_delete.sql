-- Delete only unused tip-sharing areas, preserving historical payouts.
-- When employees are attached, migrate only those without any classical shift history.
-- Flexible day rules/entries are snapshots, so referenced areas remain immutable.
CREATE OR REPLACE FUNCTION public.turnia_delete_unused_area(
  p_area_id uuid, p_destination_area_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  old_area public.propina_areas%ROWTYPE;
  next_area public.propina_areas%ROWTYPE;
  member_count integer := 0;
BEGIN
  IF (select auth.uid()) IS NULL OR p_area_id IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión y selecciona un área válida.' USING errcode='42501';
  END IF;
  SELECT * INTO old_area FROM public.propina_areas
    WHERE id=p_area_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El área ya no existe. Actualiza la pantalla.'; END IF;
  IF NOT propina_private.can_edit_restaurant(old_area.restaurant_id) THEN
    RAISE EXCEPTION 'No tienes permisos para eliminar áreas de este equipo.' USING errcode='42501';
  END IF;
  -- Serialize deletes in this workspace and avoid removing the final area.
  PERFORM 1 FROM public.propina_restaurants r WHERE r.id=old_area.restaurant_id FOR UPDATE;
  IF (SELECT count(*) FROM public.propina_areas WHERE restaurant_id=old_area.restaurant_id) <= 1 THEN
    RAISE EXCEPTION 'Conserva al menos un área en el equipo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.propina_shifts s
      JOIN public.propina_workers w ON w.id=s.worker_id
    WHERE s.restaurant_id=old_area.restaurant_id AND w.area_id=p_area_id
  ) THEN
    RAISE EXCEPTION 'No puedes eliminar un área con jornadas registradas. Su eliminación alteraría repartos anteriores.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.propina_flex_shifts f
    WHERE f.restaurant_id=old_area.restaurant_id
      AND (f.rules @> jsonb_build_array(jsonb_build_object('area_id',p_area_id::text))
           OR f.entries @> jsonb_build_array(jsonb_build_object('area_id',p_area_id::text)))
  ) THEN
    RAISE EXCEPTION 'No puedes eliminar un área utilizada en turnos AM/PM. Conserva el historial.';
  END IF;

  -- Ensure a deleted area doesn't accidentally reduce valid existing distributions.
  IF old_area.percentage <> 0 THEN
    RAISE EXCEPTION 'Primero deja el área en 0%% y distribuye el porcentaje entre las demás áreas.';
  END IF;

  PERFORM 1 FROM public.propina_workers WHERE area_id=p_area_id FOR UPDATE;
  SELECT count(*) INTO member_count FROM public.propina_workers WHERE area_id=p_area_id;
  IF member_count > 0 THEN
    IF p_destination_area_id IS NULL OR p_destination_area_id=p_area_id THEN
      RAISE EXCEPTION 'Elige otra área para trasladar las personas antes de eliminar.';
    END IF;
    SELECT * INTO next_area FROM public.propina_areas
      WHERE id=p_destination_area_id AND restaurant_id=old_area.restaurant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El área de destino no pertenece a este equipo.'; END IF;
    UPDATE public.propina_workers SET area_id=next_area.id
      WHERE restaurant_id=old_area.restaurant_id AND area_id=p_area_id;
  END IF;
  DELETE FROM public.propina_areas
   WHERE id=p_area_id AND restaurant_id=old_area.restaurant_id;
  INSERT INTO propina_private.access_audit(actor,action,target,details)
  VALUES ((select auth.uid()),'delete_unused_area',p_area_id,
    jsonb_build_object('restaurant_id',old_area.restaurant_id,
       'name',old_area.name,'percentage',old_area.percentage,
       'transferred_workers',member_count,'target_area_id',p_destination_area_id));
  RETURN jsonb_build_object('removed',true,'name',old_area.name,'moved_workers',member_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.turnia_delete_unused_area(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnia_delete_unused_area(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.turnia_delete_unused_area(uuid,uuid) IS
  'Remove a zero-percent area without shifts; move eligible team members atomically to another area.';
NOTIFY pgrst,'reload schema';
