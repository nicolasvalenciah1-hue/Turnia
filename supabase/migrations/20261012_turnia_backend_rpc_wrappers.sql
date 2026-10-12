-- Public service-role-only wrapper: private tables are not exposed to PostgREST.
CREATE OR REPLACE FUNCTION public.turnia_prepare_sandbox_checkout(p_user_id uuid, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r propina_private.turnia_registrations; amount bigint;
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN
  RAISE EXCEPTION 'Only payment backend may create checkout' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM propina_private.turnia_registrations
  WHERE user_id=p_user_id AND status='pending_payment';
 IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found'; END IF;
 PERFORM propina_private.turnia_register_checkout(p_user_id,p_reference,r.price_clp);
 RETURN jsonb_build_object('restaurant_name',r.restaurant_name,'price_clp',r.price_clp);
END $$;
REVOKE ALL ON FUNCTION public.turnia_prepare_sandbox_checkout(uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnia_prepare_sandbox_checkout(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.turnia_attach_sandbox_preapproval(p_reference text,p_preapproval_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN
  RAISE EXCEPTION 'Only payment backend may attach checkout' USING ERRCODE='42501';
 END IF;
 UPDATE propina_private.turnia_checkout_attempts
  SET provider_preapproval_id=p_preapproval_id
  WHERE external_reference=p_reference AND status='pending'
   AND provider_preapproval_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pending checkout not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.turnia_attach_sandbox_preapproval(text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnia_attach_sandbox_preapproval(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.turnia_complete_sandbox_payment(
 p_reference text, p_payment_id text, p_subscription text,
 p_amount bigint, p_currency text, p_live_mode boolean)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO '' AS $$
 SELECT propina_private.turnia_complete_verified_payment(
  p_reference,p_payment_id,p_subscription,p_amount,p_currency,p_live_mode)
$$;
REVOKE ALL ON FUNCTION public.turnia_complete_sandbox_payment(text,text,text,bigint,text,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnia_complete_sandbox_payment(text,text,text,bigint,text,boolean) TO service_role;
