-- Delivery state contains no plaintext invitation or SMTP credentials.
ALTER TABLE propina_private.invitations ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE propina_private.invitations ADD COLUMN IF NOT EXISTS email_last_attempt_at timestamptz;
ALTER TABLE propina_private.invitations ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;
ALTER TABLE propina_private.invitations ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'pending';

CREATE OR REPLACE FUNCTION propina_private.turnia_claim_invitation_email(token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE inv propina_private.invitations; uid uuid := auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Inicia sesión y confirma tu correo.' USING ERRCODE='42501'; END IF;
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Código inválido.'; END IF;
 SELECT * INTO inv FROM propina_private.invitations
 WHERE token_hash=encode(extensions.digest(token,'sha256'),'hex') FOR UPDATE;
 IF NOT FOUND OR inv.used_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at<=now()
 THEN RAISE EXCEPTION 'Invitación no disponible.' USING ERRCODE='42501'; END IF;
 IF NOT propina_private.is_platform_admin() AND NOT (
   inv.created_by=uid AND EXISTS(SELECT 1 FROM public.propina_access a JOIN public.propina_restaurants r ON r.id=a.restaurant_id
     WHERE a.user_id=uid AND a.restaurant_id=inv.restaurant_id AND a.role='owner' AND a.active AND r.active)
 ) THEN RAISE EXCEPTION 'No puedes enviar esta invitación.' USING ERRCODE='42501'; END IF;
 IF inv.email_last_attempt_at > now()-interval '60 seconds' THEN RAISE EXCEPTION 'Espera un minuto antes de reenviar.'; END IF;
 UPDATE propina_private.invitations SET email_attempts=email_attempts+1,email_last_attempt_at=now(),email_status='sending' WHERE id=inv.id;
 RETURN jsonb_build_object('id',inv.id,'email',inv.email,'attempt',inv.email_attempts+1,
   'existing_account',EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=inv.email));
END; $$;
REVOKE ALL ON FUNCTION propina_private.turnia_claim_invitation_email(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION propina_private.turnia_claim_invitation_email(text) TO authenticated;

CREATE OR REPLACE FUNCTION propina_private.turnia_finish_invitation_email(invitation_id uuid, attempt integer, delivered_to_smtp boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Solo el servidor puede registrar el envío.' USING ERRCODE='42501'; END IF;
 UPDATE propina_private.invitations SET email_status=CASE WHEN delivered_to_smtp THEN 'sent' ELSE 'failed' END,
 email_sent_at=CASE WHEN delivered_to_smtp THEN now() ELSE email_sent_at END
 WHERE id=invitation_id AND email_attempts=attempt AND email_status='sending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Estado de envío cambiado.'; END IF;
END; $$;
REVOKE ALL ON FUNCTION propina_private.turnia_finish_invitation_email(uuid,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION propina_private.turnia_finish_invitation_email(uuid,integer,boolean) TO service_role;

CREATE OR REPLACE FUNCTION propina_private.turnia_validate_invitation_account(token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE inv propina_private.invitations; mail text; confirmed timestamptz; password_empty boolean; uid uuid := auth.uid();
BEGIN
 SELECT lower(email),email_confirmed_at,coalesce(encrypted_password,'')='' INTO mail,confirmed,password_empty FROM auth.users WHERE id=uid;
 IF uid IS NULL OR confirmed IS NULL THEN RAISE EXCEPTION 'Primero confirma tu correo.' USING ERRCODE='42501'; END IF;
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Código inválido.'; END IF;
 SELECT * INTO inv FROM propina_private.invitations WHERE email=mail AND token_hash=encode(extensions.digest(token,'sha256'),'hex')
 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()
 AND (reserved_user_id IS NULL OR reserved_user_id=uid);
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitación vencida, revocada, utilizada o de otro correo.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('needs_password',password_empty);
END; $$;
REVOKE ALL ON FUNCTION propina_private.turnia_validate_invitation_account(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION propina_private.turnia_validate_invitation_account(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.turnia_claim_invitation_email(token text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO '' AS $$ SELECT propina_private.turnia_claim_invitation_email(token) $$;
REVOKE ALL ON FUNCTION public.turnia_claim_invitation_email(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.turnia_claim_invitation_email(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.turnia_finish_invitation_email(invitation_id uuid, attempt integer, delivered_to_smtp boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path TO '' AS $$ SELECT propina_private.turnia_finish_invitation_email(invitation_id,attempt,delivered_to_smtp) $$;
REVOKE ALL ON FUNCTION public.turnia_finish_invitation_email(uuid,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA propina_private TO service_role;
GRANT EXECUTE ON FUNCTION public.turnia_finish_invitation_email(uuid,integer,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.turnia_validate_invitation_account(token text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO '' AS $$ SELECT propina_private.turnia_validate_invitation_account(token) $$;
REVOKE ALL ON FUNCTION public.turnia_validate_invitation_account(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.turnia_validate_invitation_account(text) TO authenticated;
