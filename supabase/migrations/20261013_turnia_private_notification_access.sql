-- Bind one original Turnia owner to a private, single-user notification access record.
create table if not exists propina_private.turnia_notification_owner (
  user_id uuid primary key,
  sole_account boolean not null default true unique check(sole_account)
);
revoke all on propina_private.turnia_notification_owner from public, anon, authenticated;
do $$
begin
  if (select count(*) from propina_private.platform_admins where active) <> 1 then
    raise exception 'Expected exactly one active platform owner';
  end if;
  insert into propina_private.turnia_notification_owner(user_id)
  select user_id from propina_private.platform_admins where active
  on conflict (user_id) do nothing;
end $$;
create or replace function propina_private.is_turnia_notification_owner()
returns boolean language sql stable security definer set search_path=''
as $body$
  select auth.uid() is not null and propina_private.is_platform_admin()
  and exists(select 1 from propina_private.turnia_notification_owner p where p.user_id = auth.uid());
$body$;
revoke all on function propina_private.is_turnia_notification_owner() from public, anon, authenticated;
create or replace function public.turnia_notifications_access()
returns boolean language sql stable security definer set search_path=''
as $body$
 select coalesce(propina_private.is_turnia_notification_owner(),false);
$body$;
revoke all on function public.turnia_notifications_access() from public, anon, authenticated;
grant execute on function public.turnia_notifications_access() to authenticated;
