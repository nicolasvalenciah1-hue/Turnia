-- Turnia: a confirmed owner can rename only the restaurant they manage.
-- Auth user profile/password updates continue through Supabase Auth updateUser.
CREATE OR REPLACE FUNCTION public.propina_update_restaurant_name(
  p_restaurant_id uuid,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  clean_name text := btrim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g'));
  previous_name text;
BEGIN
  IF uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Debes iniciar sesión con el correo confirmado.' USING ERRCODE='42501';
  END IF;

  IF p_restaurant_id IS NULL OR char_length(clean_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'El nombre del restaurante debe tener entre 2 y 120 caracteres.';
  END IF;

  SELECT r.name INTO previous_name
  FROM public.propina_restaurants r
  JOIN public.propina_access a ON a.restaurant_id=r.id
  WHERE r.id=p_restaurant_id AND r.active
    AND a.user_id=uid AND a.active AND a.role='owner'
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo el propietario autorizado puede editar este restaurante.'
      USING ERRCODE='42501';
  END IF;

  UPDATE public.propina_restaurants SET name=clean_name WHERE id=p_restaurant_id;
  IF previous_name IS DISTINCT FROM clean_name THEN
    INSERT INTO propina_private.access_audit(actor,action,target,details)
    VALUES(uid,'rename_restaurant',p_restaurant_id,
      jsonb_build_object('previous_name',previous_name,'new_name',clean_name));
  END IF;
  RETURN jsonb_build_object('id',p_restaurant_id,'name',clean_name);
END $$;

REVOKE ALL ON FUNCTION public.propina_update_restaurant_name(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propina_update_restaurant_name(uuid,text) TO authenticated;
