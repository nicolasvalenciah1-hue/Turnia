-- Turnia: record approved sandbox payments without granting restaurant access.
-- Caller is a service-role webhook that independently verifies Mercado Pago.
-- Runtime activation flags remain OFF unless separately approved.
CREATE OR REPLACE FUNCTION propina_private.turnia_complete_verified_payment(
 p_reference text,p_provider_payment_id text,p_subscription text,
 p_amount bigint,p_currency text,p_live_mode boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 attempt propina_private.turnia_checkout_attempts;
 verified propina_private.turnia_verified_payments;
 flags propina_private.turnia_runtime_flags;
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN
   RAISE EXCEPTION 'Solo servidor' USING ERRCODE='42501';
 END IF;
 SELECT * INTO attempt FROM propina_private.turnia_checkout_attempts
   WHERE external_reference=p_reference FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Orden no registrada'; END IF;
 IF p_live_mode IS DISTINCT FROM false OR attempt.mode<>'sandbox'
   OR p_currency IS DISTINCT FROM 'CLP'
   OR p_amount IS DISTINCT FROM attempt.price_clp
   OR p_provider_payment_id IS NULL OR length(p_provider_payment_id)<1
   OR p_subscription IS NULL
   OR attempt.provider_preapproval_id IS DISTINCT FROM p_subscription THEN
   RAISE EXCEPTION 'Pago de prueba no verificable';
 END IF;
 SELECT * INTO flags FROM propina_private.turnia_runtime_flags WHERE id=1;

 IF attempt.status='completed' THEN
   SELECT * INTO verified FROM propina_private.turnia_verified_payments
     WHERE provider_payment_id=p_provider_payment_id
       AND external_reference=p_reference
       AND provider_subscription_id=p_subscription
       AND user_id=attempt.user_id AND amount_clp=p_amount
       AND currency=p_currency AND live_mode=false
       AND provider_status='approved' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Notificación repetida con datos inconsistentes'; END IF;
   IF verified.applied_at IS NOT NULL THEN
     RETURN jsonb_build_object('status','already_active','restaurant_id',verified.restaurant_id);
   END IF;
   IF COALESCE(flags.automatic_activation_enabled,false)
      AND COALESCE(flags.allow_sandbox_activations,false) THEN
     RETURN propina_private.activate_verified_registration(p_provider_payment_id);
   END IF;
   RETURN jsonb_build_object('status','verified_pending_activation');
 END IF;
 IF attempt.status <> 'pending' THEN RAISE EXCEPTION 'Orden no disponible para pago'; END IF;

 INSERT INTO propina_private.turnia_verified_payments
   (user_id,provider,provider_payment_id,provider_subscription_id,external_reference,
    currency,amount_clp,live_mode,provider_status)
 VALUES(attempt.user_id,'mercadopago',p_provider_payment_id,p_subscription,
   p_reference,p_currency,p_amount,false,'approved')
 ON CONFLICT(provider_payment_id) DO NOTHING;

 SELECT * INTO verified FROM propina_private.turnia_verified_payments
   WHERE provider_payment_id=p_provider_payment_id
     AND external_reference=p_reference
     AND provider_subscription_id=p_subscription
     AND user_id=attempt.user_id
     AND amount_clp=p_amount AND currency=p_currency
     AND live_mode=false AND provider_status='approved';
 IF NOT FOUND THEN RAISE EXCEPTION 'Pago duplicado o referencia inconsistente'; END IF;
 UPDATE propina_private.turnia_checkout_attempts SET status='completed'
   WHERE id=attempt.id;

 IF COALESCE(flags.automatic_activation_enabled,false)
    AND COALESCE(flags.allow_sandbox_activations,false) THEN
   RETURN propina_private.activate_verified_registration(p_provider_payment_id);
 END IF;
 RETURN jsonb_build_object('status','verified_pending_activation');
END $$;
REVOKE ALL ON FUNCTION propina_private.turnia_complete_verified_payment(text,text,text,bigint,text,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION propina_private.turnia_complete_verified_payment(text,text,text,bigint,text,boolean)
 TO service_role;
