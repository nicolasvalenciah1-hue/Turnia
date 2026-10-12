-- One-to-one checkout attempt bound to a verified account.
-- Created only by server-side RPC; no client write privileges.
CREATE TABLE IF NOT EXISTS propina_private.turnia_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  external_reference text NOT NULL UNIQUE,
  provider_preapproval_id text UNIQUE,
  price_clp bigint NOT NULL CHECK(price_clp=5000),
  currency text NOT NULL DEFAULT 'CLP' CHECK(currency='CLP'),
  mode text NOT NULL DEFAULT 'sandbox' CHECK(mode='sandbox'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cancelled','completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS turnia_one_pending_checkout_per_user
ON propina_private.turnia_checkout_attempts(user_id) WHERE status='pending';
ALTER TABLE propina_private.turnia_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON propina_private.turnia_checkout_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION propina_private.turnia_register_checkout(
  p_user_id uuid, p_reference text, p_price bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE result_id uuid;
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN
   RAISE EXCEPTION 'Solo servidor' USING ERRCODE='42501';
 END IF;
 IF NOT COALESCE((SELECT sandbox_checkout_enabled
     FROM propina_private.turnia_runtime_flags WHERE id=1),false) THEN
   RAISE EXCEPTION 'Checkout de pruebas desactivado' USING ERRCODE='42501';
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
REVOKE ALL ON FUNCTION propina_private.turnia_register_checkout(uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION propina_private.turnia_register_checkout(uuid,text,bigint) TO service_role;

CREATE OR REPLACE FUNCTION propina_private.turnia_complete_verified_payment(
 p_reference text, p_provider_payment_id text, p_subscription text,
 p_amount bigint, p_currency text, p_live_mode boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE attempt propina_private.turnia_checkout_attempts; payment_id text;
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN
   RAISE EXCEPTION 'Solo servidor' USING ERRCODE='42501';
 END IF;
 SELECT * INTO attempt FROM propina_private.turnia_checkout_attempts
 WHERE external_reference=p_reference FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Orden no registrada'; END IF;
 IF p_live_mode IS DISTINCT FROM false OR attempt.mode<>'sandbox'
    OR p_currency <> 'CLP' OR p_amount<>attempt.price_clp
    OR p_provider_payment_id IS NULL OR length(p_provider_payment_id)<1 THEN
   RAISE EXCEPTION 'Pago de prueba no verificable';
 END IF;
 INSERT INTO propina_private.turnia_verified_payments
  (user_id,provider,provider_payment_id,provider_subscription_id,external_reference,
   currency,amount_clp,live_mode,provider_status)
 VALUES(attempt.user_id,'mercadopago',p_provider_payment_id,p_subscription,
    p_reference,p_currency,p_amount,false,'approved')
 ON CONFLICT(provider_payment_id) DO NOTHING;
 UPDATE propina_private.turnia_checkout_attempts SET status='completed'
 WHERE id=attempt.id;
 -- Activation remains blocked until separately authorized with runtime flags.
 RETURN propina_private.activate_verified_registration(p_provider_payment_id);
END $$;
REVOKE ALL ON FUNCTION propina_private.turnia_complete_verified_payment(text,text,text,bigint,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION propina_private.turnia_complete_verified_payment(text,text,text,bigint,text,boolean) TO service_role;
