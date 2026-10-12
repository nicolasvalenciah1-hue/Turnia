-- Existing confirmed identities, temporary restaurant fixtures, no Auth mutations.
-- Administrative connection only. Everything rolls back, including audit entries.
begin;
do $$
declare
 owner_uid uuid; member_uid uuid; member_email text; rest uuid:=gen_random_uuid(); rest2 uuid:=gen_random_uuid();
 area uuid:=gen_random_uuid(); area2 uuid:=gen_random_uuid(); w1 uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); w3 uuid:=gen_random_uuid();
 day uuid:=gen_random_uuid(); invitation jsonb; result jsonb; n integer; expected jsonb;
begin
 select r.owner_id into owner_uid from public.propina_restaurants r where r.active order by r.created_at limit 1;
 select u.id,u.email into member_uid,member_email from auth.users u where u.id<>owner_uid and u.email_confirmed_at is not null
  and not exists(select 1 from propina_private.platform_admins p where p.user_id=u.id and p.active) order by u.created_at limit 1;
 if member_uid is null then raise exception 'Requires a confirmed non-platform member identity'; end if;
 insert into public.propina_restaurants(id,owner_id,name) values(rest,owner_uid,'Fixture vinculación'),(rest2,owner_uid,'Fixture otro local');
 insert into public.propina_access(user_id,restaurant_id,role) values(owner_uid,rest,'owner'),(owner_uid,rest2,'owner');
 insert into public.propina_areas(id,restaurant_id,name,percentage) values(area,rest,'Área fixture',100),(area2,rest2,'Área fixture',100);
 insert into public.propina_workers(id,restaurant_id,area_id,name) values(w1,rest,area,'Persona uno'),(w2,rest,area,'Persona dos'),(w3,rest2,area2,'Otro local');
 insert into public.propina_days(id,restaurant_id,work_date,amount_clp,hours_per_shift) values(day,rest,'2026-01-02',100001,8);
 insert into public.propina_shifts(restaurant_id,day_id,worker_id,hours) values(rest,day,w1,8),(rest,day,w2,12);
 select jsonb_agg(to_jsonb(d) order by worker_id) into expected from public.propina_daily_distribution d where restaurant_id=rest;
 if has_function_privilege('anon','public.propina_my_tips(uuid)','execute')
  or has_function_privilege('anon','public.propina_link_worker(uuid,text,uuid,text,boolean,text)','execute') then raise exception 'Anonymous function permission'; end if;
 if exists(select 1 from pg_proc where oid in ('public.propina_my_tips(uuid)'::regprocedure,'public.propina_link_worker(uuid,text,uuid,text,boolean,text)'::regprocedure,
  'public.propina_issue_worker_invitation(uuid,text,uuid,text,boolean,text)'::regprocedure) and prosecdef) then raise exception 'Exposed definer'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true);
 set local role authenticated;
 begin
  perform public.propina_issue_worker_invitation(rest,member_email,w1,'personal',false,'Acuerdo en reunión del equipo');
  raise exception 'Agreement omitted' using errcode='ZX001';
 exception when sqlstate 'ZX001' then raise; when others then if sqlerrm not like '%acuerdo%' then raise; end if; end;
 begin
  perform public.propina_issue_worker_invitation(rest,member_email,w3,'personal',true,'Acuerdo en reunión del equipo');
  raise exception 'Cross-restaurant worker accepted' using errcode='ZX001';
 exception when sqlstate 'ZX001' then raise; when others then if sqlerrm not like '%no pertenece%' then raise; end if; end;
 invitation:=public.propina_issue_worker_invitation(rest,member_email,w1,'personal',true,'Acuerdo en reunión del equipo');
 begin
  perform public.propina_issue_worker_invitation(rest,'another@example.invalid',w1,'personal',true,'Acuerdo en reunión del equipo');
  raise exception 'Duplicate pending worker invitation' using errcode='ZX001';
 exception when sqlstate 'ZX001' then raise; when others then if sqlerrm not like '%Revoca primero%' then raise; end if; end;
 begin
  perform public.propina_accept_invitation(invitation->>'token');
  raise exception 'Wrong email accepted invitation' using errcode='ZX001';
 exception when sqlstate 'ZX001' then raise; when others then if sqlerrm not like '%no disponible%' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member_uid,'role','authenticated','user_metadata',jsonb_build_object('role','owner','worker_id',w2))::text,true);
 perform public.propina_accept_invitation(invitation->>'token');
 perform public.propina_accept_invitation(invitation->>'token'); -- idempotent
 result:=public.propina_account_context();
 if not exists(select 1 from jsonb_array_elements(result->'restaurants') r where r->>'id'=rest::text and r->>'worker_id'=w1::text and r->>'read_scope'='personal') then raise exception 'Account context link missing'; end if;
 result:=public.propina_my_tips(rest);
 if result<>jsonb_build_array(jsonb_build_object('work_date','2026-01-02','hours',8,'calculated_clp',40000)) then raise exception 'Personal payout changed full-distribution calculation or leaked columns: %',result; end if;
 if exists(select 1 from public.propina_restaurants where id=rest)
  or exists(select 1 from public.propina_areas where restaurant_id=rest)
  or exists(select 1 from public.propina_workers where restaurant_id=rest)
  or exists(select 1 from public.propina_days where restaurant_id=rest)
  or exists(select 1 from public.propina_shifts where restaurant_id=rest)
  or exists(select 1 from public.propina_daily_distribution where restaurant_id=rest) then raise exception 'Personal viewer can read full restaurant'; end if;
 if exists(select 1 from jsonb_array_elements(public.propina_membership_context()) m where m->>'restaurant_id'=rest::text) then raise exception 'Membership metadata exposed'; end if;
 update public.propina_workers set name='Unwanted' where id=w1; get diagnostics n=row_count;
 if n<>0 then raise exception 'Personal viewer changed worker'; end if;
 begin
  perform public.propina_my_tips(rest2); raise exception 'Other restaurant payouts exposed' using errcode='ZX001';
 exception when insufficient_privilege then null; end;
 begin
  perform public.propina_link_worker(rest,member_email,w2,'shared',true,'Acuerdo en reunión del equipo'); raise exception 'Self escalation' using errcode='ZX001';
 exception when insufficient_privilege then null; end;
 begin
  update public.propina_access set read_scope='shared' where restaurant_id=rest and user_id=member_uid;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Direct scope escalation' using errcode='ZX001'; end if;
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true);
 -- Older broad-access codes must not undo a newly declared personal scope.
 result:=public.propina_issue_staff_invitation(member_email,'admin',rest);
 perform public.propina_link_worker(rest,member_email,w1,'shared',true,'Acuerdo unánime de consulta compartida');
 reset role;
 if not exists(select 1 from propina_private.invitations where id=(result->>'id')::uuid and revoked_at is not null) then raise exception 'Old broad invite remains valid'; end if;
 set local role authenticated;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member_uid,'role','authenticated')::text,true);
 if (select count(*) from public.propina_daily_distribution where restaurant_id=rest)<>2 then raise exception 'Shared reader cannot read agreed data'; end if;
 if jsonb_array_length(public.propina_my_tips(rest))<>1 then raise exception 'My tips contains coworkers in shared mode'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true);
 perform public.propina_link_worker(rest,member_email,w2,'personal',true,'Acuerdo de corrección de la ficha');
 reset role;
 update public.propina_access set worker_id=w1 where restaurant_id=rest and user_id=owner_uid;
 set local role authenticated;
 begin
  perform public.propina_link_worker(rest,member_email,w1,'personal',true,'Acuerdo en reunión del equipo');
  raise exception 'Duplicate active worker link' using errcode='ZX001';
 exception when sqlstate 'ZX001' then raise; when others then if sqlerrm not like '%otra cuenta vinculada%' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member_uid,'role','authenticated')::text,true);
 result:=public.propina_my_tips(rest);
 if (result->0->>'calculated_clp')::numeric<>60001 then raise exception 'Largest-remainder payout changed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true);
 perform public.propina_manage_member(rest,member_email,null);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member_uid,'role','authenticated')::text,true);
 begin
  perform public.propina_my_tips(rest); raise exception 'Removed member can still read tips' using errcode='ZX001';
 exception when insufficient_privilege then null; end;
 reset role;
 update public.propina_access set active=true where restaurant_id=rest and user_id=member_uid;
 update public.propina_workers set active=false where id=w2;
 set local role authenticated;
 if (public.propina_my_tips(rest)->0->>'calculated_clp')::numeric<>60001 then raise exception 'Inactive worker history lost'; end if;
 reset role;
 update public.propina_restaurants set active=false where id=rest;
 set local role authenticated;
 begin
  perform public.propina_my_tips(rest); raise exception 'Suspended restaurant visible' using errcode='ZX001';
 exception when insufficient_privilege then null; end;
 reset role;
 if (select jsonb_agg(to_jsonb(d) order by worker_id) from public.propina_daily_distribution d where restaurant_id=rest)<>expected then raise exception 'Operational payout changed'; end if;
 if not exists(select 1 from propina_private.access_audit where target=rest and action='link_worker' and details->>'agreement_declared'='true') then raise exception 'Missing agreement audit'; end if;
end $$;
select 'PASS: worker invitations, verified email, agreement, personal/shared RLS, precise payouts, cross-restaurant denial, duplicate links, stale tokens, inactive history, revocation, suspension and metadata spoofing; all fixtures rolled back.' as result;
rollback;
