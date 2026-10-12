-- Inspect only the order belonging to the single authorized test user.
-- Never publishes the provider ID or reference to authenticated clients.
CREATE OR REPLACE FUNCTION public.turnia_subscription_inspection_target(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a propina_private.turnia_checkout_attempts;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo servidor' USING errcode='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM propina_private.turnia_runtime_flags f
    WHERE f.id=1 AND f.sandbox_test_user_id=p_user_id
  ) THEN RAISE EXCEPTION 'Cuenta no autorizada'; END IF;
  SELECT * INTO a
  FROM propina_private.turnia_checkout_attempts
  WHERE user_id=p_user_id AND provider_preapproval_id IS NOT NULL
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
  RETURN jsonb_build_object(
    'found',true,
    'preapproval_id',a.provider_preapproval_id,
    'external_reference',a.external_reference,
    'local_status',a.status,
    'price_clp',a.price_clp,
    'currency',a.currency
  );
END $$;
REVOKE ALL ON FUNCTION public.turnia_subscription_inspection_target(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnia_subscription_inspection_target(uuid)
  TO service_role;
