-- Stores an administrator-confirmed test buyer Mercado Pago User ID.
-- Never use a user-provided payer ID alone as proof of sandbox identity.
ALTER TABLE propina_private.turnia_runtime_flags
  ADD COLUMN IF NOT EXISTS sandbox_test_buyer_mp_user_id bigint;
CREATE OR REPLACE FUNCTION public.turnia_verify_test_buyer_mp_id(
  p_turnia_user_id uuid, p_provider_payer_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE expected_id bigint;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo verificador de pagos' USING errcode='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM propina_private.turnia_runtime_flags f
    WHERE f.id=1 AND f.sandbox_test_user_id=p_turnia_user_id
  ) THEN
    RAISE EXCEPTION 'Cuenta Turnia no autorizada' USING errcode='42501';
  END IF;
  SELECT sandbox_test_buyer_mp_user_id INTO expected_id
    FROM propina_private.turnia_runtime_flags WHERE id=1;
  IF expected_id IS NULL THEN
    RETURN jsonb_build_object('configured',false,'matches',NULL);
  END IF;
  RETURN jsonb_build_object(
    'configured',true,
    'matches',CASE
      WHEN COALESCE(p_provider_payer_id,'') ~ '^[0-9]{1,18}$'
      THEN expected_id::text=p_provider_payer_id
      ELSE false
    END
  );
END $$;
REVOKE ALL ON FUNCTION public.turnia_verify_test_buyer_mp_id(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnia_verify_test_buyer_mp_id(uuid,text)
  TO service_role;
