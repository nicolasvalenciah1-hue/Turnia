ALTER TABLE propina_private.turnia_runtime_flags
 ADD COLUMN IF NOT EXISTS sandbox_test_user_id uuid;
CREATE OR REPLACE FUNCTION public.turnia_sandbox_checkout_available()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((
  SELECT sandbox_checkout_enabled AND sandbox_test_user_id=auth.uid()
  FROM propina_private.turnia_runtime_flags WHERE id=1),false)
$$;
REVOKE ALL ON FUNCTION public.turnia_sandbox_checkout_available() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.turnia_sandbox_checkout_available() TO authenticated;
CREATE OR REPLACE FUNCTION propina_private.turnia_register_checkout(
 p_user_id uuid,p_reference text,p_price bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE result_id uuid;
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN
  RAISE EXCEPTION 'Solo servidor' USING ERRCODE='42501';
 END IF;
 IF NOT COALESCE((SELECT sandbox_checkout_enabled AND sandbox_test_user_id=p_user_id
  FROM propina_private.turnia_runtime_flags WHERE id=1),false) THEN
  RAISE EXCEPTION 'Checkout de pruebas no autorizado' USING ERRCODE='42501';
 END IF;
 IF p_reference !~ ('^turnia:' || p_user_id::text || ':[a-f0-9-]{36}$')
    OR p_price <> 5000 THEN RAISE EXCEPTION 'Orden inválida'; END IF;
 IF NOT EXISTS(SELECT 1 FROM propina_private.turnia_registrations r
   JOIN auth.users u ON u.id=r.user_id WHERE r.user_id=p_user_id
   AND r.status='pending_payment' AND u.email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Cliente no elegible'; END IF;
 INSERT INTO propina_private.turnia_checkout_attempts(user_id,external_reference,price_clp)
 VALUES(p_user_id,p_reference,p_price) RETURNING id INTO result_id;
 RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION propina_private.turnia_register_checkout(uuid,text,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION propina_private.turnia_register_checkout(uuid,text,bigint)
 TO service_role;
