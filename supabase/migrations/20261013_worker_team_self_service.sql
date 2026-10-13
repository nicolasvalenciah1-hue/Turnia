-- Worker teams are independent workspaces, not employer-owned restaurants.
-- Reuse the mature restaurant tenancy/RLS and payout engine without modifying
-- existing rows. Only confirmed accounts may create one beta team.
create table if not exists propina_private.turnia_worker_teams (
  restaurant_id uuid primary key references public.propina_restaurants(id) on delete restrict,
  created_by uuid not null unique references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table propina_private.turnia_worker_teams enable row level security;
revoke all on propina_private.turnia_worker_teams from public, anon, authenticated;

create or replace function public.turnia_create_worker_team(team_name text)
returns uuid
language plpgsql security definer set search_path=''
as $function$
declare
  creator uuid := (select auth.uid());
  account_email text;
  person_name text;
  cleaned_name text := trim(regexp_replace(coalesce(team_name,''), '[[:space:]]+', ' ', 'g'));
  existing uuid;
  team_id uuid;
  area_id uuid;
  worker_id uuid;
begin
  if creator is null then
    raise exception 'Inicia sesión para crear tu equipo.' using errcode='42501';
  end if;
  select lower(email),
         left(coalesce(nullif(trim(raw_user_meta_data->>'display_name'),''), split_part(email,'@',1)),80)
    into account_email,person_name
    from auth.users where id=creator and email_confirmed_at is not null;
  if account_email is null then
    raise exception 'Confirma tu correo electrónico antes de crear el equipo.' using errcode='42501';
  end if;
  if length(cleaned_name)<2 or length(cleaned_name)>80 then
    raise exception 'El nombre del equipo debe tener entre 2 y 80 caracteres.';
  end if;
  -- Serialized creation per Auth user prevents double-click races and orphan workspaces.
  perform pg_advisory_xact_lock(hashtextextended(creator::text, 20261013));
  select restaurant_id into existing from propina_private.turnia_worker_teams where created_by=creator;
  if existing is not null then
    return existing; -- safe retry; do not create additional teams or paid memberships
  end if;
  if exists(select 1 from auth.users where id=creator
            and raw_user_meta_data->>'turnia_registration'='v1') then
    raise exception 'Esta cuenta tiene un registro comercial en curso. Usa otra cuenta para gestionar tu equipo.';
  end if;

  insert into public.propina_restaurants(owner_id,name)
    values(creator,cleaned_name) returning id into team_id;
  insert into public.propina_areas(restaurant_id,name,percentage)
    values(team_id,'Garzones',100) returning id into area_id;
  insert into public.propina_workers(restaurant_id,area_id,name)
    values(team_id,area_id,person_name) returning id into worker_id;
  insert into public.propina_access(user_id,restaurant_id,role,worker_id,read_scope)
    values(creator,team_id,'owner',worker_id,'shared');
  insert into propina_private.memberships(restaurant_id,plan_code,duration_days,starts_at,expires_at,
                                          price_clp,payment_status,responsible_name,responsible_email,created_by)
    values(team_id,'custom',90,now(),now()+interval '90 days',
           0,'trial',person_name,account_email,creator);
  insert into propina_private.turnia_worker_teams(restaurant_id,created_by)
    values(team_id,creator);
  insert into propina_private.access_audit(actor,action,target,details)
    values(creator,'create_worker_team',team_id,
      jsonb_build_object('beta',true,'member_role','owner','payment_status','trial'));
  return team_id;
end
$function$;
revoke all on function public.turnia_create_worker_team(text) from public, anon, authenticated;
grant execute on function public.turnia_create_worker_team(text) to authenticated;

comment on function public.turnia_create_worker_team(text) is
 'Creates one independently managed, free beta worker team per confirmed account. No payment.';
