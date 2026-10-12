-- Explicit account-to-worker links. Existing access remains unchanged (shared).
-- No payroll, auth, restaurant, billing or subscription records are modified.
alter table public.propina_access
  add column worker_id uuid,
  add column read_scope text not null default 'shared' check (read_scope in ('personal','shared')),
  add constraint access_worker_same_restaurant foreign key(worker_id,restaurant_id)
    references public.propina_workers(id,restaurant_id);
create unique index access_one_active_account_per_worker
  on public.propina_access(restaurant_id,worker_id) where active and worker_id is not null;
alter table propina_private.invitations
  add column worker_id uuid,
  add column read_scope text not null default 'shared' check (read_scope in ('personal','shared')),
  add column agreement_note text,
  add constraint invitation_worker_same_restaurant foreign key(worker_id,restaurant_id)
    references public.propina_workers(id,restaurant_id);
create index invitations_worker_pending on propina_private.invitations(restaurant_id,worker_id)
  where used_at is null and revoked_at is null;

create or replace function propina_private.can_read_restaurant(rid uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select propina_private.is_platform_admin() or exists(
  select 1 from public.propina_access a join public.propina_restaurants r on r.id=a.restaurant_id
  where a.user_id=auth.uid() and a.restaurant_id=rid and a.active and r.active
    and (a.role in ('owner','admin') or a.read_scope='shared'))
$$;

-- Owner records an agreement already reached outside Turnia; this is not a vote.
create or replace function propina_private.propina_link_worker(
 rid uuid, member_email text, target_worker uuid, visibility text,
 agreement_confirmed boolean, agreement_note text)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid; previous jsonb; mail text:=lower(btrim(coalesce(member_email,'')));
begin
 if not propina_private.is_restaurant_owner(rid) then
  raise exception 'Solo el propietario puede vincular cuentas.' using errcode='42501';
 end if;
 if agreement_confirmed is distinct from true or length(btrim(coalesce(agreement_note,''))) not between 10 and 500 then
  raise exception 'Confirma el acuerdo de todos los trabajadores y deja una nota de 10 a 500 caracteres.';
 end if;
 if visibility is null or visibility not in ('personal','shared') then raise exception 'Visibilidad inválida.'; end if;
 -- Lock the restaurant to serialize links and invitations for the same local.
 perform 1 from public.propina_restaurants where id=rid for update;
 select id into uid from auth.users where lower(email)=mail and email_confirmed_at is not null;
 select to_jsonb(a) into previous from public.propina_access a
  where a.user_id=uid and a.restaurant_id=rid and a.active for update;
 if not found then raise exception 'Selecciona una cuenta confirmada con acceso activo.'; end if;
 if previous->>'role'<>'viewer' then raise exception 'La vinculación personal requiere una cuenta de solo consulta.'; end if;
 if not exists(select 1 from public.propina_workers where id=target_worker and restaurant_id=rid) then
  raise exception 'El trabajador no pertenece a este restaurante.';
 end if;
 if exists(select 1 from public.propina_access where restaurant_id=rid and worker_id=target_worker and active and user_id<>uid) then
  raise exception 'Este trabajador ya tiene otra cuenta vinculada.';
 end if;
 if exists(select 1 from propina_private.invitations where restaurant_id=rid and worker_id=target_worker
  and email<>mail and used_at is null and revoked_at is null and expires_at>now()) then
  raise exception 'Revoca primero la invitación pendiente de este trabajador.';
 end if;
 update public.propina_access set worker_id=target_worker,read_scope=visibility where user_id=uid and restaurant_id=rid;
 -- Old invitation codes must not restore broader access after linking.
 update propina_private.invitations set revoked_at=now() where restaurant_id=rid and email=mail
  and used_at is null and revoked_at is null;
 insert into propina_private.access_audit(actor,action,target,details)
 values(auth.uid(),'link_worker',rid,jsonb_build_object('user_id',uid,'worker_id',target_worker,'visibility',visibility,
  'previous_worker_id',previous->'worker_id','previous_visibility',previous->'read_scope',
  'agreement_note',btrim(agreement_note),'agreement_declared',true));
end $$;

create or replace function propina_private.propina_issue_worker_invitation(
 rid uuid, invitee_email text, target_worker uuid, visibility text,
 agreement_confirmed boolean, agreement_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mail text:=lower(btrim(coalesce(invitee_email,''))); token text; iid uuid; expiry timestamptz;
begin
 if not propina_private.is_restaurant_owner(rid) then
  raise exception 'Solo el propietario puede invitar una cuenta personal.' using errcode='42501';
 end if;
 if agreement_confirmed is distinct from true or length(btrim(coalesce(agreement_note,''))) not between 10 and 500 then
  raise exception 'Confirma el acuerdo de todos los trabajadores y deja una nota de 10 a 500 caracteres.';
 end if;
 if visibility is null or visibility not in ('personal','shared') then raise exception 'Visibilidad inválida.'; end if;
 if mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(mail)>254 then raise exception 'Correo inválido.'; end if;
 perform 1 from public.propina_restaurants where id=rid for update;
 if not exists(select 1 from public.propina_workers where id=target_worker and restaurant_id=rid) then
  raise exception 'El trabajador no pertenece a este restaurante.';
 end if;
 if exists(select 1 from public.propina_access a join auth.users u on u.id=a.user_id
  where a.restaurant_id=rid and a.active and (a.worker_id=target_worker or lower(u.email)=mail)) then
  raise exception 'Ya existe una cuenta activa. Usa Vincular una cuenta existente.';
 end if;
 if exists(select 1 from propina_private.invitations where restaurant_id=rid and worker_id=target_worker
  and email<>mail and used_at is null and revoked_at is null and expires_at>now()) then
  raise exception 'Revoca primero la invitación pendiente de este trabajador.';
 end if;
 update propina_private.invitations set revoked_at=now() where restaurant_id=rid and email=mail
  and used_at is null and revoked_at is null;
 token:=encode(extensions.gen_random_bytes(32),'hex'); expiry:=now()+interval '7 days';
 insert into propina_private.invitations(email,token_hash,access_role,restaurant_id,expires_at,created_by,worker_id,read_scope,agreement_note)
 values(mail,encode(extensions.digest(token,'sha256'),'hex'),'viewer',rid,expiry,auth.uid(),target_worker,visibility,btrim(agreement_note)) returning id into iid;
 insert into propina_private.access_audit(actor,action,target,details)
 values(auth.uid(),'issue_worker_invitation',iid,jsonb_build_object('restaurant_id',rid,'worker_id',target_worker,
  'visibility',visibility,'agreement_note',btrim(agreement_note),'agreement_declared',true));
 return jsonb_build_object('id',iid,'email',mail,'token',token,'expires_at',expiry);
end $$;

-- Full distribution is computed before filtering to the authenticated worker.
-- Never accept a worker/user id from the caller for this endpoint.
create or replace function propina_private.propina_my_tips(rid uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare wid uuid;
begin
 select a.worker_id into wid from public.propina_access a join public.propina_restaurants r on r.id=a.restaurant_id
 join auth.users u on u.id=a.user_id
 where a.user_id=auth.uid() and a.restaurant_id=rid and a.active and r.active and u.email_confirmed_at is not null;
 if wid is null then raise exception 'No tienes una ficha de trabajador vinculada en este restaurante.' using errcode='42501'; end if;
 return (with distribution as materialized (
   select * from public.propina_daily_distribution where restaurant_id=rid
 ) select coalesce(jsonb_agg(jsonb_build_object('work_date',d.work_date,'hours',d.hours,'calculated_clp',d.calculated_clp)
   order by d.work_date desc),'[]'::jsonb) from distribution d where d.worker_id=wid);
end $$;

CREATE OR REPLACE FUNCTION propina_private.propina_account_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=(select auth.uid()); platform boolean;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Inicia sesión y confirma tu correo.'; end if;
 platform:=propina_private.is_platform_admin();
 return jsonb_build_object('display_name',(select coalesce(nullif(raw_user_meta_data->>'display_name',''),nullif(raw_user_meta_data->>'full_name',''),email) from auth.users where id=uid),'platform_admin',platform,'can_create',platform or exists(select 1 from propina_private.owner_approvals where user_id=uid and active and restaurant_id is null),
 'registered_ids',case when platform then coalesce((select jsonb_agg(id) from public.propina_restaurants where owner_id=uid),'[]'::jsonb) else '[]'::jsonb end,
 'restaurants',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'role',a.role,'owner_id',r.owner_id,'worker_id',a.worker_id,'worker_name',w.name,'read_scope',case when platform or a.role in ('owner','admin') then 'shared' else a.read_scope end) order by r.created_at)
 from public.propina_restaurants r join public.propina_access a on a.restaurant_id=r.id left join public.propina_workers w on w.id=a.worker_id and w.restaurant_id=r.id where a.user_id=uid and a.active and r.active),'[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION propina_private.propina_restaurant_team(rid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not propina_private.is_restaurant_owner(rid) then raise exception 'Solo el propietario puede consultar los accesos.'; end if;
 return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('email',u.email,'role',a.role,'worker_id',a.worker_id,'worker_name',w.name,'read_scope',a.read_scope) order by u.email)
 from public.propina_access a join auth.users u on u.id=a.user_id left join public.propina_workers w on w.id=a.worker_id and w.restaurant_id=a.restaurant_id where a.restaurant_id=rid and a.active and a.role<>'owner'),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'role',access_role,'worker_id',worker_id,'read_scope',read_scope,'expires_at',expires_at,'used_at',used_at,'revoked_at',revoked_at) order by created_at desc)
 from propina_private.invitations where restaurant_id=rid),'[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION propina_private.membership_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform propina_private.queue_due_membership_reminders();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'restaurant_id',r.id,'restaurant_name',r.name,'membership_id',m.id,'plan_code',m.plan_code,
      'duration_days',m.duration_days,'starts_at',m.starts_at,'expires_at',m.expires_at,
      'days_remaining',greatest(0,ceil(extract(epoch from (m.expires_at-now()))/86400.0)::integer),
      'payment_status',m.payment_status,
      'responsible_email',m.responsible_email,
      'status',case when m.payment_status not in ('trial','paid') then 'payment_pending'
                    when m.expires_at<=now() then 'expired'
                    when m.expires_at<=now()+interval '7 days' then 'expiring' else 'active' end,
      'reminders',(select coalesce(jsonb_agg(jsonb_build_object('id',mr.id,'kind',mr.reminder_kind,'channel',mr.channel,'status',mr.status,'scheduled_for',mr.scheduled_for) order by mr.scheduled_for desc),'[]'::jsonb) from propina_private.membership_reminders mr where mr.membership_id=m.id)
    ) order by r.name)
    from public.propina_restaurants r
    join lateral (select m.* from propina_private.memberships m where m.restaurant_id=r.id order by m.expires_at desc limit 1) m on true
    where r.active and propina_private.can_read_restaurant(r.id)
  ),'[]'::jsonb);
end $function$
;

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
 if inv.used_by=uid then return jsonb_build_object('role',inv.access_role,'restaurant_id',inv.restaurant_id); end if;
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

create or replace function public.propina_link_worker(rid uuid, member_email text, target_worker uuid, visibility text, agreement_confirmed boolean, agreement_note text) returns void language sql security invoker set search_path='' as $$ select propina_private.propina_link_worker(rid,member_email,target_worker,visibility,agreement_confirmed,agreement_note) $$;
revoke all on function public.propina_link_worker(uuid,text,uuid,text,boolean,text) from public,anon;
grant execute on function public.propina_link_worker(uuid,text,uuid,text,boolean,text) to authenticated;
revoke all on function propina_private.propina_link_worker(uuid,text,uuid,text,boolean,text) from public,anon;
grant execute on function propina_private.propina_link_worker(uuid,text,uuid,text,boolean,text) to authenticated;

create or replace function public.propina_issue_worker_invitation(rid uuid, invitee_email text, target_worker uuid, visibility text, agreement_confirmed boolean, agreement_note text) returns jsonb language sql security invoker set search_path='' as $$ select propina_private.propina_issue_worker_invitation(rid,invitee_email,target_worker,visibility,agreement_confirmed,agreement_note) $$;
revoke all on function public.propina_issue_worker_invitation(uuid,text,uuid,text,boolean,text) from public,anon;
grant execute on function public.propina_issue_worker_invitation(uuid,text,uuid,text,boolean,text) to authenticated;
revoke all on function propina_private.propina_issue_worker_invitation(uuid,text,uuid,text,boolean,text) from public,anon;
grant execute on function propina_private.propina_issue_worker_invitation(uuid,text,uuid,text,boolean,text) to authenticated;

create or replace function public.propina_my_tips(rid uuid) returns jsonb language sql security invoker set search_path='' as $$ select propina_private.propina_my_tips(rid) $$;
revoke all on function public.propina_my_tips(uuid) from public,anon;
grant execute on function public.propina_my_tips(uuid) to authenticated;
revoke all on function propina_private.propina_my_tips(uuid) from public,anon;
grant execute on function propina_private.propina_my_tips(uuid) to authenticated;

notify pgrst, 'reload schema';
