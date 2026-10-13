-- Team labels are only returned to users already authorized for that workspace.
create or replace function public.turnia_is_worker_team(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path=''
as $body$
  select p_workspace_id is not null and
         propina_private.can_read_restaurant(p_workspace_id) and
         exists(select 1 from propina_private.turnia_worker_teams
                where restaurant_id=p_workspace_id);
$body$;
revoke all on function public.turnia_is_worker_team(uuid) from public, anon, authenticated;
grant execute on function public.turnia_is_worker_team(uuid) to authenticated;
