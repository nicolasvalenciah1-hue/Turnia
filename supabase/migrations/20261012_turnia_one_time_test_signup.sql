-- Test registrations require a short-lived, single-use token linked to one email.
-- Never put test codes, hashes or emails in this tracked migration.
CREATE TABLE IF NOT EXISTS propina_private.turnia_test_signup_tokens (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 consumed_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);
ALTER TABLE propina_private.turnia_test_signup_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON propina_private.turnia_test_signup_tokens FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION propina_private.test_signup_allowed(p_email text,p_meta jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE(
   p_meta->>'turnia_test_token' ~ '^[0-9a-f]{64}$'
   AND propina_private.valid_self_registration(p_meta)
   AND EXISTS (
     SELECT 1 FROM propina_private.turnia_test_signup_tokens t
     WHERE t.token_hash = encode(extensions.digest(p_meta->>'turnia_test_token','sha256'),'hex')
       AND t.email_hash = encode(extensions.digest(lower(btrim(p_email)),'sha256'),'hex')
       AND t.expires_at>now() AND t.consumed_at IS NULL
   ),FALSE)
$$;
REVOKE ALL ON FUNCTION propina_private.test_signup_allowed(text,jsonb)
 FROM PUBLIC,anon,authenticated;

-- Keep the invitation flow unchanged; token registration is pending only.
CREATE OR REPLACE FUNCTION public.propina_before_user_created(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE inv propina_private.invitations;
        mail text; token text; meta jsonb;
BEGIN
 mail := lower(btrim(event->'user'->>'email'));
 meta := event->'user'->'user_metadata';
 token := meta->>'propina_invitation';
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN
   IF mail IS NOT NULL AND
      ((propina_private.self_signup_enabled()
         AND propina_private.valid_self_registration(meta))
       OR propina_private.test_signup_allowed(mail,meta)) THEN
     RETURN '{}'::jsonb;
   END IF;
   RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,
     'message','Necesitas una invitación válida o un código de registro de prueba.'));
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
END $$;

CREATE OR REPLACE FUNCTION propina_private.validate_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE inv propina_private.invitations; credential text;
BEGIN
 IF new.email IS NOT NULL AND new.raw_user_meta_data->>'propina_invitation' IS NULL
   AND (
      (propina_private.self_signup_enabled()
         AND propina_private.valid_self_registration(new.raw_user_meta_data))
       OR propina_private.test_signup_allowed(new.email,new.raw_user_meta_data)
   ) THEN
   RETURN new;
 END IF;
 credential := new.raw_user_meta_data->>'propina_invitation';
 IF new.email IS NULL OR credential IS NULL OR credential !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Necesitas una invitación o código de prueba válido.'
     USING errcode='42501';
 END IF;
 SELECT * INTO inv FROM propina_private.invitations
 WHERE email=lower(btrim(new.email))
   AND token_hash=encode(extensions.digest(credential,'sha256'),'hex')
   AND revoked_at IS NULL AND used_at IS NULL AND expires_at>now()
   AND (reserved_user_id IS NULL OR reserved_user_id=new.id) FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Invitación no disponible para este correo.' USING errcode='42501';
 END IF;
 UPDATE propina_private.invitations SET reserved_user_id=new.id WHERE id=inv.id;
 RETURN new;
END $$;

-- After Auth user insert, token is atomically consumed within that transaction.
-- Every self-registered customer remains in pending_payment until a verified payment.
CREATE OR REPLACE FUNCTION propina_private.capture_turnia_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE m jsonb := new.raw_user_meta_data;
BEGIN
 IF COALESCE(m->>'turnia_registration','') <> 'v1' THEN RETURN new; END IF;
 IF NOT propina_private.valid_self_registration(m) OR new.email IS NULL THEN
   RAISE EXCEPTION 'Registro Turnia inválido' USING errcode='22023';
 END IF;
 IF NOT propina_private.self_signup_enabled() THEN
   UPDATE propina_private.turnia_test_signup_tokens
     SET consumed_at=now(), consumed_by=new.id
   WHERE token_hash=encode(extensions.digest(m->>'turnia_test_token','sha256'),'hex')
     AND email_hash=encode(extensions.digest(lower(btrim(new.email)),'sha256'),'hex')
     AND consumed_at IS NULL AND expires_at>now();
   IF NOT FOUND THEN
      RAISE EXCEPTION 'Código de prueba vencido o utilizado' USING errcode='42501';
   END IF;
 END IF;
 INSERT INTO propina_private.turnia_registrations
  (user_id,first_name,last_name,phone,restaurant_name,business_type,
   rut,city,commune,street,team_size)
 VALUES
  (new.id,btrim(m->>'first_name'),btrim(m->>'last_name'),
   btrim(m->>'phone'),btrim(m->>'restaurant_name'),
   m->>'business_type',nullif(btrim(m->>'rut'),''),
   btrim(m->>'city'),btrim(m->>'commune'),
   nullif(btrim(m->>'street'),''),nullif(m->>'staff',''));
 RETURN new;
END $$;

NOTIFY pgrst,'reload schema';
