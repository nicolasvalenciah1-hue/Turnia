-- Permit verified-email worker team onboarding without weakening commercial invitations.
-- Team signup is public beta; registering a commercial restaurant still requires
-- the existing approval, invite, or time-limited test token.
CREATE OR REPLACE FUNCTION propina_private.valid_worker_team_signup(meta jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
  SELECT COALESCE(
    jsonb_typeof(meta) = 'object'
    AND meta->>'turnia_team_setup' = 'v1'
    AND meta->>'turnia_registration' IS NULL
    AND meta->>'propina_invitation' IS NULL
    AND meta->>'turnia_test_token' IS NULL
    AND length(btrim(meta->>'display_name')) BETWEEN 2 AND 80
    AND length(btrim(meta->>'turnia_team_name')) BETWEEN 2 AND 80
  , FALSE)
$function$;
REVOKE ALL ON FUNCTION propina_private.valid_worker_team_signup(jsonb)
 FROM PUBLIC, anon, authenticated;

-- Existing Auth before-user-created hook: allow only the new team-specific path
-- in addition to the established commercial and invitation paths.
CREATE OR REPLACE FUNCTION public.propina_before_user_created(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE inv propina_private.invitations;
        mail text; token text; meta jsonb;
BEGIN
 mail := lower(btrim(event->'user'->>'email'));
 meta := event->'user'->'user_metadata';
 token := meta->>'propina_invitation';
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN
   IF mail IS NOT NULL AND
      (propina_private.valid_worker_team_signup(meta)
       OR (propina_private.self_signup_enabled()
            AND propina_private.valid_self_registration(meta))
       OR propina_private.test_signup_allowed(mail,meta)) THEN
     RETURN '{}'::jsonb;
   END IF;
   RETURN jsonb_build_object('error',jsonb_build_object('http_code',403,
     'message','Necesitas una invitación válida o un registro de equipo válido.'));
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
END $function$;

-- Existing Auth database INSERT trigger: same permission decision as the hook.
CREATE OR REPLACE FUNCTION propina_private.validate_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE inv propina_private.invitations; credential text;
BEGIN
 IF new.email IS NOT NULL AND new.raw_user_meta_data->>'propina_invitation' IS NULL
   AND (
        propina_private.valid_worker_team_signup(new.raw_user_meta_data)
       OR (propina_private.self_signup_enabled()
            AND propina_private.valid_self_registration(new.raw_user_meta_data))
       OR propina_private.test_signup_allowed(new.email,new.raw_user_meta_data)
   ) THEN
   RETURN new;
 END IF;
 credential := new.raw_user_meta_data->>'propina_invitation';
 IF new.email IS NULL OR credential IS NULL OR credential !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Necesitas una invitación o un registro de equipo válido.'
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
END $function$;

-- Lightweight preflight ensures malformed team payloads cannot pass.
DO $test$
DECLARE good jsonb := '{"display_name":"Camila Soto","turnia_team_setup":"v1","turnia_team_name":"Garzones del centro"}'::jsonb;
BEGIN
 IF NOT propina_private.valid_worker_team_signup(good) THEN
   RAISE EXCEPTION 'Valid team signup unexpectedly blocked';
 END IF;
 IF propina_private.valid_worker_team_signup(good-'display_name')
    OR propina_private.valid_worker_team_signup(good-'turnia_team_name')
    OR propina_private.valid_worker_team_signup(good||'{"turnia_registration":"v1"}'::jsonb)
    OR propina_private.valid_worker_team_signup(good||'{"propina_invitation":"bogus"}'::jsonb)
    OR propina_private.valid_worker_team_signup('{}'::jsonb)
 THEN RAISE EXCEPTION 'Invalid worker team signup unexpectedly allowed'; END IF;
END $test$;
