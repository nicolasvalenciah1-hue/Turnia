-- Server-side automatic activation, deliberately disabled by default.
-- This RPC requires service_role, and an already persisted server-verified
-- provider payment record. No caller-provided paid=true or amount is accepted.
-- Safe to stage in GitHub; DO NOT apply until registration migration is reviewed.
CREATE TABLE IF NOT EXISTS propina_private.turnia_verified_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL CHECK (provider='mercadopago'),
  provider_payment_id text NOT NULL UNIQUE,
  provider_subscription_id text,
  external_reference text NOT NULL UNIQUE,
  currency text NOT NULL CHECK (currency='CLP'),
  amount_clp bigint NOT NULL CHECK (amount_clp>0),
  live_mode boolean NOT NULL,
  provider_status text NOT NULL CHECK (provider_status='approved'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  restaurant_id uuid REFERENCES public.propina_restaurants(id)
);
ALTER TABLE propina_private.turnia_verified_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE propina_private.turnia_verified_payments FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION propina_private.activate_verified_registration(p_payment_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  verified propina_private.turnia_verified_payments;
  signup propina_private.turnia_registrations;
  flags propina_private.turnia_runtime_flags;
  customer auth.users;
  restaurant uuid;
BEGIN
  -- Service role only. Frontend and authenticated users cannot invoke this.
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'Acceso restringido al verificador de pagos.' USING errcode='42501';
  END IF;
  SELECT * INTO flags FROM propina_private.turnia_runtime_flags WHERE id=1;
  IF NOT COALESCE(flags.automatic_activation_enabled,false) THEN
    RAISE EXCEPTION 'Activación automática desactivada.' USING errcode='42501';
  END IF;
  SELECT * INTO verified FROM propina_private.turnia_verified_payments
    WHERE provider_payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND OR verified.provider_status <> 'approved' THEN
    RAISE EXCEPTION 'Pago verificado no encontrado.';
  END IF;
  IF verified.live_mode AND NOT flags.allow_live_activations THEN
    RAISE EXCEPTION 'Activación con dinero real desactivada.' USING errcode='42501';
  END IF;
  IF NOT verified.live_mode AND NOT flags.allow_sandbox_activations THEN
    RAISE EXCEPTION 'Activación de pruebas desactivada.' USING errcode='42501';
  END IF;
  IF verified.applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','already_active','restaurant_id',verified.restaurant_id);
  END IF;

  SELECT * INTO signup FROM propina_private.turnia_registrations
    WHERE user_id=verified.user_id FOR UPDATE;
  IF NOT FOUND OR signup.status <> 'pending_payment' OR signup.restaurant_id IS NOT NULL THEN
    RAISE EXCEPTION 'Registro no elegible para activación.';
  END IF;
  SELECT * INTO customer FROM auth.users WHERE id=verified.user_id;
  IF customer.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Debe confirmar el correo para activar.';
  END IF;
  IF verified.amount_clp <> signup.price_clp OR verified.currency <> 'CLP'
     OR verified.provider <> 'mercadopago' THEN
    RAISE EXCEPTION 'Importe, moneda o proveedor no coinciden.';
  END IF;
  IF NOT (verified.external_reference ~ ('^turnia:' || verified.user_id::text || ':[a-f0-9-]{36}$')) THEN
    RAISE EXCEPTION 'Referencia de compra incompatible con registro.';
  END IF;

  INSERT INTO public.propina_restaurants(owner_id,name)
    VALUES (verified.user_id,signup.restaurant_name)
    RETURNING id INTO restaurant;
  INSERT INTO public.propina_access(user_id,restaurant_id,role)
    VALUES(verified.user_id,restaurant,'owner');

  INSERT INTO propina_private.memberships
    (restaurant_id,plan_code,duration_days,starts_at,expires_at,
     price_clp,payment_status,responsible_name,responsible_email,created_by,
     mp_preapproval_id,mp_last_payment_id,mp_status)
  VALUES(restaurant,'monthly',30,now(),now()+interval '30 days',
    signup.price_clp,'paid',signup.first_name||' '||signup.last_name,
    customer.email,verified.user_id,verified.provider_subscription_id,
    verified.provider_payment_id,'approved');

  UPDATE propina_private.turnia_registrations SET
    status='active',restaurant_id=restaurant,activated_at=now()
    WHERE user_id=signup.user_id;
  UPDATE propina_private.turnia_verified_payments SET
    applied_at=now(),restaurant_id=restaurant
    WHERE id=verified.id;

  INSERT INTO propina_private.access_audit(actor,action,target,details)
    VALUES(verified.user_id,'self_registration_activated',restaurant,
      jsonb_build_object('provider','mercadopago','payment_id',verified.provider_payment_id));
  RETURN jsonb_build_object('status','active','restaurant_id',restaurant);
END $$;
REVOKE ALL ON FUNCTION propina_private.activate_verified_registration(text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION propina_private.activate_verified_registration(text) TO service_role;
