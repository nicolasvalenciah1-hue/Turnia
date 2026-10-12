-- Turnia: real self-registration without charging or granting access.
-- Applied only when explicitly deploying registration; existing invitation flows remain.
-- To activate customers in future, add a *server-only*, verified-payment webhook.
-- No RPC here can mark a registration as paid.
-- Gated rollout. This migration may be installed while the site remains
-- invitation-only and no payment method is configured.
CREATE TABLE IF NOT EXISTS propina_private.turnia_runtime_flags (
  id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
  self_registration_enabled boolean NOT NULL DEFAULT FALSE,
  automatic_activation_enabled boolean NOT NULL DEFAULT FALSE,
  sandbox_checkout_enabled boolean NOT NULL DEFAULT FALSE,
  allow_sandbox_activations boolean NOT NULL DEFAULT FALSE,
  allow_live_activations boolean NOT NULL DEFAULT FALSE
);
INSERT INTO propina_private.turnia_runtime_flags(id)
VALUES(1) ON CONFLICT(id) DO NOTHING;
ALTER TABLE propina_private.turnia_runtime_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE propina_private.turnia_runtime_flags FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION propina_private.self_signup_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $
  SELECT COALESCE((SELECT self_registration_enabled
                   FROM propina_private.turnia_runtime_flags WHERE id=1),FALSE)
$;
REVOKE ALL ON FUNCTION propina_private.self_signup_enabled() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION propina_private.valid_self_registration(meta jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT COALESCE(meta->>'turnia_registration' = 'v1'
    AND meta->>'plan_code' = 'monthly'
    AND meta->>'accept_terms' = 'true'
    AND length(btrim(meta->>'first_name')) BETWEEN 2 AND 70
    AND length(btrim(meta->>'last_name')) BETWEEN 2 AND 90
    AND length(btrim(meta->>'phone')) BETWEEN 8 AND 25
    AND length(btrim(meta->>'restaurant_name')) BETWEEN 2 AND 80
    AND meta->>'business_type' IN ('Restaurante','Cafetería','Bar','Hotel','Otro')
    AND length(btrim(meta->>'city')) BETWEEN 2 AND 100
    AND length(btrim(meta->>'commune')) BETWEEN 2 AND 100
    AND length(COALESCE(meta->>'rut','')) <= 12
    AND length(COALESCE(meta->>'street','')) <= 180
    AND COALESCE(meta->>'staff','') IN ('','1 a 5 personas','6 a 15 personas','16 a 30 personas','Más de 30')
  , FALSE)
$$;
REVOKE ALL ON FUNCTION propina_private.valid_self_registration(jsonb) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS propina_private.turnia_registrations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL,
  restaurant_name text NOT NULL,
  business_type text NOT NULL,
  rut text,
  city text NOT NULL,
  commune text NOT NULL,
  street text,
  team_size text,
  plan_code text NOT NULL DEFAULT 'monthly' CHECK (plan_code = 'monthly'),
  price_clp bigint NOT NULL DEFAULT 5000 CHECK (price_clp = 5000),
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'active', 'cancelled')),
  restaurant_id uuid UNIQUE REFERENCES public.propina_restaurants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  CHECK (status <> 'active' OR (restaurant_id IS NOT NULL AND activated_at IS NOT NULL))
);
ALTER TABLE propina_private.turnia_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE propina_private.turnia_registrations FROM PUBLIC, anon, authenticated;

-- Preserve invitation-only signups. Only a fully validated Turnia self-registration
-- can pass without an invitation, and neither branch grants restaurant access here.
CREATE OR REPLACE FUNCTION public.propina_before_user_created(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE inv propina_private.invitations;
        mail text; token text;
BEGIN
  mail := lower(trim(event->'user'->>'email'));
  token := event->'user'->'user_metadata'->>'propina_invitation';
  IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN
    IF mail IS NOT NULL AND propina_private.self_signup_enabled()
      AND propina_private.valid_self_registration(event->'user'->'user_metadata') THEN
      RETURN '{}'::jsonb;
    END IF;
    RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,
      'message','Necesitas una invitación válida o completar el registro de Turnia.'));
  END IF;
  SELECT * INTO inv FROM propina_private.invitations
    WHERE email=mail AND token_hash=encode(extensions.digest(token,'sha256'),'hex')
      AND revoked_at IS NULL AND used_at IS NULL AND expires_at>now()
      AND reserved_user_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,
      'message','La invitación no es válida, venció o ya fue utilizada.'));
  END IF;
  UPDATE propina_private.invitations
    SET reserved_user_id=(event->'user'->>'id')::uuid WHERE id=inv.id;
  RETURN '{}'::jsonb;
END
$$;

CREATE OR REPLACE FUNCTION propina_private.validate_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE inv propina_private.invitations; credential text;
BEGIN
  IF new.email IS NOT NULL AND new.raw_user_meta_data->>'propina_invitation' IS NULL
    AND propina_private.self_signup_enabled()
    AND propina_private.valid_self_registration(new.raw_user_meta_data) THEN
    RETURN new;
  END IF;
  credential:=new.raw_user_meta_data->>'propina_invitation';
  IF new.email IS NULL OR credential IS NULL OR credential !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Necesitas una invitación válida para registrarte.'
      USING errcode='42501';
  END IF;
  SELECT * INTO inv FROM propina_private.invitations
    WHERE email=lower(trim(new.email))
      AND token_hash=encode(extensions.digest(credential,'sha256'),'hex')
      AND revoked_at IS NULL AND used_at IS NULL AND expires_at>now()
      AND (reserved_user_id IS NULL OR reserved_user_id=new.id) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitación no disponible para este correo.'
      USING errcode='42501';
  END IF;
  UPDATE propina_private.invitations SET reserved_user_id=new.id WHERE id=inv.id;
  RETURN new;
END
$$;

CREATE OR REPLACE FUNCTION propina_private.capture_turnia_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE m jsonb := new.raw_user_meta_data;
BEGIN
  IF COALESCE(m->>'turnia_registration','') <> 'v1' THEN RETURN new; END IF;
  IF NOT propina_private.valid_self_registration(m) OR new.email IS NULL THEN
    RAISE EXCEPTION 'Registro Turnia inválido' USING errcode='22023';
  END IF;
  INSERT INTO propina_private.turnia_registrations
    (user_id, first_name, last_name, phone, restaurant_name, business_type,
     rut, city, commune, street, team_size)
  VALUES
    (new.id, btrim(m->>'first_name'), btrim(m->>'last_name'),
     btrim(m->>'phone'), btrim(m->>'restaurant_name'),
     m->>'business_type', nullif(btrim(m->>'rut'),''),
     btrim(m->>'city'), btrim(m->>'commune'),
     nullif(btrim(m->>'street'),''), nullif(m->>'staff',''));
  -- No restaurant, membership, payment, or propina_access record is created.
  RETURN new;
END
$$;
DROP TRIGGER IF EXISTS turnia_capture_signup ON auth.users;
CREATE TRIGGER turnia_capture_signup AFTER INSERT ON auth.users
FOR EACH ROW WHEN (new.raw_user_meta_data->>'turnia_registration' = 'v1')
EXECUTE FUNCTION propina_private.capture_turnia_registration();

CREATE OR REPLACE FUNCTION propina_private.turnia_registration_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT (SELECT jsonb_build_object(
    'status',r.status,'restaurant_name',r.restaurant_name,
    'plan_code',r.plan_code,'price_clp',r.price_clp)
    FROM propina_private.turnia_registrations r
    WHERE r.user_id = (SELECT auth.uid()))
$$;
REVOKE ALL ON FUNCTION propina_private.turnia_registration_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION propina_private.turnia_registration_status() TO authenticated;
CREATE OR REPLACE FUNCTION public.turnia_registration_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO '' AS $$
  SELECT propina_private.turnia_registration_status()
$$;
REVOKE ALL ON FUNCTION public.turnia_registration_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.turnia_registration_status() TO authenticated;
NOTIFY pgrst, 'reload schema';
