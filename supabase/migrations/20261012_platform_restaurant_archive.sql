-- Turnia platform owner: reversible archive. Never delete restaurant or tip rows.
ALTER TABLE public.propina_restaurants
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_prior_active boolean;

CREATE OR REPLACE FUNCTION propina_private.propina_set_restaurant_archive(
  rid uuid, should_archive boolean, change_reason text, expected_name text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous public.propina_restaurants%ROWTYPE;
  reason text := btrim(coalesce(change_reason,''));
BEGIN
  IF NOT propina_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el propietario de Turnia puede archivar restaurantes.' USING errcode='42501';
  END IF;
  IF should_archive IS NULL OR char_length(reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Indica un motivo de entre 3 y 500 caracteres.';
  END IF;
  SELECT * INTO previous FROM public.propina_restaurants WHERE id=rid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurante no encontrado.'; END IF;
  IF btrim(coalesce(expected_name,'')) <> previous.name THEN
    RAISE EXCEPTION 'El nombre de confirmación no coincide con el restaurante.';
  END IF;
  IF should_archive THEN
    IF previous.archived_at IS NOT NULL THEN RAISE EXCEPTION 'El restaurante ya está archivado.'; END IF;
    UPDATE public.propina_restaurants
      SET active=false, archived_at=now(), archived_prior_active=previous.active
      WHERE id=rid;
  ELSE
    IF previous.archived_at IS NULL THEN RAISE EXCEPTION 'El restaurante no está archivado.'; END IF;
    UPDATE public.propina_restaurants
      SET active=coalesce(previous.archived_prior_active,true),
          archived_at=NULL, archived_prior_active=NULL
      WHERE id=rid;
  END IF;
  INSERT INTO propina_private.access_audit(actor,action,target,details)
  VALUES ((select auth.uid()),case when should_archive then 'archive_restaurant' else 'restore_restaurant' end,
    rid,jsonb_build_object('name',previous.name,'reason',reason,
      'previous_active',previous.active,'archived_at_before',previous.archived_at));
END $$;
REVOKE ALL ON FUNCTION propina_private.propina_set_restaurant_archive(uuid,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION propina_private.propina_set_restaurant_archive(uuid,boolean,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.propina_set_restaurant_archive(
  rid uuid, should_archive boolean, change_reason text, expected_name text
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT propina_private.propina_set_restaurant_archive(rid,should_archive,change_reason,expected_name)
$$;
REVOKE ALL ON FUNCTION public.propina_set_restaurant_archive(uuid,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propina_set_restaurant_archive(uuid,boolean,text,text) TO authenticated;

-- Archive is distinct from temporary suspension. The old status RPC cannot
-- reactivate or silently modify an archived restaurant.
CREATE OR REPLACE FUNCTION propina_private.propina_set_restaurant_status(
  rid uuid, enabled boolean, change_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous public.propina_restaurants%ROWTYPE;
BEGIN
  IF NOT propina_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el propietario de Turnia puede cambiar el estado de un restaurante.' USING errcode='42501';
  END IF;
  IF enabled IS NULL OR length(trim(coalesce(change_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Indica un motivo de entre 3 y 500 caracteres.';
  END IF;
  SELECT * INTO previous FROM public.propina_restaurants WHERE id=rid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurante no encontrado.'; END IF;
  IF previous.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este restaurante está archivado. Usa Restaurar.';
  END IF;
  UPDATE public.propina_restaurants SET active=enabled WHERE id=rid;
  INSERT INTO propina_private.access_audit(actor,action,target,details)
  VALUES ((select auth.uid()),'restaurant_status',rid,jsonb_build_object(
    'before',previous.active,'after',enabled,'reason',trim(change_reason)));
END $$;

CREATE OR REPLACE FUNCTION propina_private.propina_platform_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT propina_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Este panel es solo para el propietario de Turnia.' USING errcode='42501';
  END IF;
  RETURN jsonb_build_object(
    'invitations',propina_private.propina_list_invitations(),
    'restaurants',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',r.id,'name',r.name,'email',u.email,'active',r.active,
        'archived_at',r.archived_at,
        'members',(SELECT count(*) FROM public.propina_access a WHERE a.restaurant_id=r.id AND a.active)
      ) ORDER BY r.created_at DESC)
      FROM public.propina_restaurants r JOIN auth.users u ON u.id=r.owner_id
    ),'[]'::jsonb)
  );
END $$;

-- Existing account-context RPC filters r.active, which already hides archived
-- restaurants from normal restaurant selection. Do not alter auth users or tips.
