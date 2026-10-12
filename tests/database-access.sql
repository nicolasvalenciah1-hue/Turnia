-- Run with the project's administrative SQL connection. Every fixture/change
-- is uncommitted and rolled back; no credentials or auth.users rows are edited.
-- Uses existing identities to exercise authenticated RLS and public RPCs.
begin;
do $$
declare
  owner_uid uuid; other_uid uuid; target uuid; other_restaurant uuid;
  other_email text; owner_email text; result jsonb; invitation jsonb; affected integer;
begin
  select r.id,r.owner_id,u.email into target,owner_uid,owner_email
  from public.propina_restaurants r join auth.users u on u.id=r.owner_id
  where r.active order by r.created_at limit 1;
  select id,email into other_uid,other_email from auth.users u
  where u.id<>owner_uid and u.email_confirmed_at is not null
    and not exists(select 1 from propina_private.platform_admins p where p.user_id=u.id and p.active)
    and not exists(select 1 from public.propina_access a where a.user_id=u.id)
  order by u.created_at limit 1;
  select id into other_restaurant from public.propina_restaurants where id<>target and active limit 1;
  if target is null or other_uid is null or other_restaurant is null then
    raise exception 'Test requires an owner, an unrelated confirmed identity, and two restaurants.';
  end if;
  if has_function_privilege('anon','public.propina_update_restaurant_name(uuid,text)','execute') then
    raise exception 'Anonymous rename privilege';
  end if;
  if (select prosecdef from pg_proc where oid='public.propina_update_restaurant_name(uuid,text)'::regprocedure) then
    raise exception 'Exposed rename wrapper must be security invoker';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true);
  set local role authenticated;
  result:=public.propina_update_restaurant_name(target,'  Nombre   temporal de prueba  ');
  if result->>'name'<>'Nombre temporal de prueba' then raise exception 'Whitespace normalization'; end if;
  perform public.propina_update_restaurant_name(target,repeat('a',80));
  begin
    perform public.propina_update_restaurant_name(target,repeat('a',81));
    raise exception 'Accepted 81-character name' using errcode='ZX001';
  exception when sqlstate 'ZX001' then raise;
    when others then if sqlerrm not like '%2 y 80%' then raise; end if;
  end;
  perform public.propina_restaurant_team(target);
  perform public.propina_platform_snapshot();
  begin
    perform public.propina_manage_member(target,owner_email,null);
    raise exception 'Owner access removed' using errcode='ZX001';
  exception when sqlstate 'ZX001' then raise;
    when others then if sqlerrm not like '%propietario%' then raise; end if;
  end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_uid,'role','authenticated','user_metadata',jsonb_build_object('platform_admin',true,'role','owner'))::text,true);
  if exists(select 1 from public.propina_restaurants) or exists(select 1 from public.propina_workers)
     or exists(select 1 from public.propina_days) or exists(select 1 from public.propina_shifts)
     or exists(select 1 from public.propina_daily_distribution) then
    raise exception 'Unrelated account can read restaurant data';
  end if;
  begin
    perform public.propina_update_restaurant_name(target,'No autorizado');
    raise exception 'Unrelated account renamed restaurant' using errcode='ZX001';
  exception when insufficient_privilege then null; end;
  begin
    perform public.propina_restaurant_team(target);
    raise exception 'Unrelated account read team' using errcode='ZX001';
  exception when sqlstate 'ZX001' then raise;
    when others then if sqlerrm not like '%Solo el propietario%' then raise; end if;
  end;
  begin
    perform public.propina_platform_snapshot();
    raise exception 'Metadata granted platform admin' using errcode='ZX001';
  exception when sqlstate 'ZX001' then raise;
    when others then if sqlerrm not like '%solo para%' then raise; end if;
  end;

  reset role;
  insert into public.propina_access(user_id,restaurant_id,role) values(other_uid,target,'viewer');
  set local role authenticated;
  if not exists(select 1 from public.propina_restaurants where id=target)
     or exists(select 1 from public.propina_restaurants where id=other_restaurant) then
    raise exception 'Viewer isolation failed';
  end if;
  update public.propina_areas set percentage=percentage where restaurant_id=target;
  get diagnostics affected = row_count;
  if affected<>0 then raise exception 'Viewer could update areas'; end if;
  begin
    perform public.propina_update_restaurant_name(target,'No autorizado');
    raise exception 'Viewer renamed restaurant' using errcode='ZX001';
  exception when insufficient_privilege then null; end;

  reset role;
  update public.propina_access set role='admin' where user_id=other_uid and restaurant_id=target;
  set local role authenticated;
  if not propina_private.can_edit_restaurant(target) then raise exception 'Admin cannot edit own restaurant'; end if;
  if propina_private.can_edit_restaurant(other_restaurant) then raise exception 'Admin can edit another restaurant'; end if;
  begin
    perform public.propina_manage_member(target,owner_email,'viewer');
    raise exception 'Admin changed owner role' using errcode='ZX001';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true);
  invitation:=public.propina_issue_staff_invitation(other_email,'admin',target);
  perform public.propina_manage_member(target,other_email,'viewer');
  reset role;
  if not exists(select 1 from propina_private.invitations where id=(invitation->>'id')::uuid and revoked_at is not null) then
    raise exception 'Old invitation could restore privileges after downgrade';
  end if;
  set local role authenticated;
  perform public.propina_manage_member(target,other_email,null);
  begin
    perform public.propina_manage_member(target,other_email,'admin');
    raise exception 'Inactive member update reported success' using errcode='ZX001';
  exception when sqlstate 'ZX001' then raise;
    when others then if sqlerrm not like '%ya no tiene acceso activo%' then raise; end if;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_uid,'role','authenticated')::text,true);
  if exists(select 1 from public.propina_restaurants where id=target) then raise exception 'Removed access still reads data'; end if;
  reset role;
end $$;
select 'PASS: owner, viewer, admin, unrelated account, metadata escalation, rename bounds, protected ownership, invitation invalidation and access revocation. All changes rolled back.' as result;
rollback;
