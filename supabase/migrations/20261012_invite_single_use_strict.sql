-- Codes cannot be consumed twice, even by the original account.
-- Does not modify existing used or unused invitations.
CREATE OR REPLACE FUNCTION propina_private.propina_accept_invitation(token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv propina_private.invitations; mail text; confirmed timestamptz; uid uuid;
begin
 uid:=(select auth.uid());
 select lower(email),email_confirmed_at into mail,confirmed from auth.users where id=uid;
 if uid is null or confirmed is null then raise exception 'Verifica tu correo antes de activar la cuenta.'; end if;
 select * into inv from propina_private.invitations where token_hash=encode(extensions.digest(token,'sha256'),'hex') and email=mail for update;
 if not found then raise exception 'Invitación no disponible.'; end if;
 if inv.used_at is not null or inv.used_by is not null then raise exception 'Invitación ya utilizada. Cada código se activa una sola vez.'; end if;
 if inv.revoked_at is not null or inv.expires_at<=now() then raise exception 'Invitación no disponible.'; end if;
 if inv.used_at is not null or (inv.reserved_user_id is not null and inv.reserved_user_id<>uid) then raise exception 'Invitación ya utilizada.'; end if;
 if inv.access_role='platform_owner' then
  insert into propina_private.platform_admins(user_id) values(uid);
 elsif inv.access_role='restaurant_owner' then
  insert into propina_private.owner_approvals(user_id,invitation_id,membership_duration_days,membership_price_clp,membership_payment_status)
  values(uid,inv.id,inv.membership_duration_days,inv.membership_price_clp,inv.membership_payment_status)
  on conflict(user_id) do update set invitation_id=excluded.invitation_id,restaurant_id=null,active=true,approved_at=now(),
    membership_duration_days=excluded.membership_duration_days,membership_price_clp=excluded.membership_price_clp,
    membership_payment_status=excluded.membership_payment_status
  where propina_private.owner_approvals.restaurant_id is not null or not propina_private.owner_approvals.active;
  if not found then raise exception 'Ya tienes una autorización pendiente para crear un restaurante.'; end if;
 else
  if not exists(select 1 from public.propina_restaurants where id=inv.restaurant_id and active) then raise exception 'Restaurante no disponible.'; end if;
  perform 1 from public.propina_restaurants where id=inv.restaurant_id for update;
  if inv.worker_id is not null and exists(select 1 from public.propina_access where restaurant_id=inv.restaurant_id and active
    and (user_id=uid or worker_id=inv.worker_id)) then
   raise exception 'La cuenta o el trabajador ya tienen una vinculación activa. Pide al propietario que la revise.';
  end if;
  insert into public.propina_access(user_id,restaurant_id,role,worker_id,read_scope) values(uid,inv.restaurant_id,inv.access_role,inv.worker_id,inv.read_scope)
  on conflict(user_id,restaurant_id) do update set role=excluded.role,active=true,
   worker_id=case when inv.worker_id is not null then inv.worker_id else public.propina_access.worker_id end,
   read_scope=case when inv.worker_id is not null then inv.read_scope else public.propina_access.read_scope end where public.propina_access.role<>'owner';
  if not found then raise exception 'El propietario ya tiene acceso y no puede cambiar de rol por una invitación.'; end if;
  if inv.worker_id is not null then
   update public.propina_access set worker_id=inv.worker_id,read_scope=inv.read_scope where user_id=uid and restaurant_id=inv.restaurant_id;
   insert into propina_private.access_audit(actor,action,target,details) values(uid,'accept_worker_link',inv.id,
    jsonb_build_object('worker_id',inv.worker_id,'visibility',inv.read_scope));
  end if;
 end if;
 update propina_private.invitations set used_by=uid,used_at=now() where id=inv.id;
 insert into propina_private.access_audit(actor,action,target) values(uid,'accept_invitation',inv.id);
 return jsonb_build_object('role',inv.access_role,'restaurant_id',inv.restaurant_id);
end $function$
;
