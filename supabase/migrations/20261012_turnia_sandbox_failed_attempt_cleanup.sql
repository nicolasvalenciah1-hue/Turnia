-- Checkout retry clean-up: only the service-role backend may cancel an
-- unlinked order after Mercado Pago explicitly refuses to create it.
CREATE OR REPLACE FUNCTION public.turnia_cancel_failed_sandbox_checkout(
 p_reference text,p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN
   RAISE EXCEPTION 'Solo servidor' USING ERRCODE='42501';
 END IF;
 UPDATE propina_private.turnia_checkout_attempts
 SET status='cancelled'
 WHERE external_reference=p_reference
   AND user_id=p_user_id
   AND status='pending'
   AND provider_preapproval_id IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.turnia_cancel_failed_sandbox_checkout(text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnia_cancel_failed_sandbox_checkout(text,uuid)
 TO service_role;
