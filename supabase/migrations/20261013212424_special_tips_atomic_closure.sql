-- No backfill or UPDATE of historical payouts. Only new reconciled closures.
create table public.turnia_tip_closures (
 restaurant_id uuid not null references public.propina_restaurants(id),
 work_date date not null, scope text not null check(scope in ('DAY','AM','PM')),
 revision integer not null check(revision>0), gross_clp bigint not null check(gross_clp between 0 and 1000000000000),
 special_clp bigint not null check(special_clp between 0 and gross_clp),
 payload jsonb not null, request_id uuid not null unique,
 confirmed_by uuid not null, confirmed_at timestamptz not null default now(),
 primary key(restaurant_id,work_date,scope)
);
create table public.turnia_special_allocations (
 restaurant_id uuid not null, work_date date not null, scope text not null,
 tip_id uuid not null, worker_id uuid not null, amount_clp bigint not null check(amount_clp>0),
 worker_name text not null, area_id uuid not null, area_name text not null,
 payment_method text not null check(payment_method in ('debito','credito','efectivo','transferencia')),
 primary key(restaurant_id,work_date,scope,tip_id,worker_id),
 foreign key(restaurant_id,work_date,scope) references public.turnia_tip_closures,
 foreign key(worker_id,restaurant_id) references public.propina_workers(id,restaurant_id)
);
create index turnia_special_allocations_worker on public.turnia_special_allocations(restaurant_id,worker_id,work_date);
create table propina_private.special_closure_audit (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null,
 work_date date not null, scope text not null, actor uuid not null,
 recorded_at timestamptz not null default now(), reason text not null,
 previous jsonb not null, replacement jsonb not null
);
alter table public.turnia_tip_closures enable row level security;
alter table public.turnia_special_allocations enable row level security;
alter table propina_private.special_closure_audit enable row level security;
revoke all on public.turnia_tip_closures,public.turnia_special_allocations,propina_private.special_closure_audit from public,anon,authenticated;
grant select on public.turnia_tip_closures,public.turnia_special_allocations to authenticated;
create policy closure_managers on public.turnia_tip_closures for select to authenticated
 using (propina_private.can_edit_restaurant(restaurant_id));
create function propina_private.owns_special_allocation(rid uuid,wid uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.propina_access a
 join public.propina_restaurants r on r.id=a.restaurant_id
 where a.user_id=auth.uid() and a.restaurant_id=rid and a.worker_id=wid and a.active and r.active)
$$;
revoke all on function propina_private.owns_special_allocation(uuid,uuid) from public,anon;
grant execute on function propina_private.owns_special_allocation(uuid,uuid) to authenticated;
create policy special_own_or_manager on public.turnia_special_allocations for select to authenticated
 using (propina_private.can_edit_restaurant(restaurant_id) or propina_private.owns_special_allocation(restaurant_id,worker_id));

-- Preserve the existing calculation implementation; its entrypoints become private.
alter function public.propina_save_day(uuid,date,bigint,numeric,jsonb) set schema propina_private;
alter function public.propina_save_flex_shift(uuid,date,text,bigint,jsonb,jsonb) set schema propina_private;
revoke all on function propina_private.propina_save_day(uuid,date,bigint,numeric,jsonb),propina_private.propina_save_flex_shift(uuid,date,text,bigint,jsonb,jsonb) from public,anon,authenticated;

create function propina_private.close_special_day(p_restaurant uuid,p_date date,p_scope text,p_payload jsonb,p_expected_revision integer,p_request_id uuid,p_confirmed boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.turnia_tip_closures%rowtype; existing public.turnia_tip_closures%rowtype;
 tip jsonb; allocation jsonb; worker public.propina_workers%rowtype;
 gross bigint; special bigint:=0; amount bigint; allocated bigint; n integer; i integer;
 entries jsonb; result_id uuid; ref text; rev integer;
begin
 if auth.uid() is null or not propina_private.can_edit_restaurant(p_restaurant) then raise exception 'Acceso denegado' using errcode='42501'; end if;
 if p_confirmed is distinct from true then raise exception 'Confirma la conciliación antes de cerrar.'; end if;
 if p_date is null or p_scope is null or p_scope not in ('DAY','AM','PM') or p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Cierre inválido'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or coalesce(p_payload->>'gross','') !~ '^[0-9]+$' then raise exception 'Monto inválido'; end if;
 gross:=(p_payload->>'gross')::bigint;
 if gross<0 or gross>1000000000000 or jsonb_typeof(p_payload->'tips') is distinct from 'array' or jsonb_array_length(p_payload->'tips')>200 then raise exception 'Monto o propinas inválidos'; end if;
 perform 1 from public.propina_restaurants where id=p_restaurant for update;
 select * into existing from public.turnia_tip_closures where request_id=p_request_id;
 if found then
  if existing.restaurant_id<>p_restaurant or existing.work_date<>p_date or existing.scope<>p_scope or existing.payload<>p_payload then raise exception 'Solicitud duplicada con datos diferentes'; end if;
  return jsonb_build_object('revision',existing.revision,'shared',existing.gross_clp-existing.special_clp,'special',existing.special_clp);
 end if;
 select * into old from public.turnia_tip_closures where restaurant_id=p_restaurant and work_date=p_date and scope=p_scope;
 if coalesce(old.revision,0)<>p_expected_revision then raise exception 'Otra persona actualizó el cierre. Actualiza antes de corregir.'; end if;
 if old.revision is not null and length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Una corrección requiere un motivo de 10 a 500 caracteres'; end if;
 -- Legacy dates stay immutable through this module, including the other flex shift.
 if exists(select 1 from public.propina_days d where d.restaurant_id=p_restaurant and d.work_date=p_date and not exists(select 1 from public.turnia_tip_closures c where c.restaurant_id=d.restaurant_id and c.work_date=d.work_date and c.scope='DAY'))
 or exists(select 1 from public.propina_flex_shifts s where s.restaurant_id=p_restaurant and s.work_date=p_date and not exists(select 1 from public.turnia_tip_closures c where c.restaurant_id=s.restaurant_id and c.work_date=s.work_date and c.scope=s.shift_code)) then raise exception 'El módulo no modifica repartos históricos.'; end if;
 entries:=p_payload->'workers';
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 200 then raise exception 'Selecciona personal'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'tips'))<>jsonb_array_length(p_payload->'tips') then raise exception 'Propina duplicada'; end if;
 if (select count(distinct lower(btrim(value->>'reference'))) from jsonb_array_elements(p_payload->'tips'))<>jsonb_array_length(p_payload->'tips') then raise exception 'Comprobante duplicado'; end if;
 for tip in select value from jsonb_array_elements(p_payload->'tips') loop
  perform (tip->>'id')::uuid;
  ref:=btrim(coalesce(tip->>'reference',''));
  if length(ref) not between 3 and 120 or coalesce(tip->>'amount','') !~ '^[0-9]+$' or coalesce(tip->>'method','') not in ('equal','custom') or coalesce(tip->>'payment','') not in ('debito','credito','efectivo','transferencia') then raise exception 'Propina inválida'; end if;
  -- Same receipt cannot occur in AM and PM or another day's closure.
  if exists(select 1 from public.turnia_tip_closures c,jsonb_array_elements(c.payload->'tips') x where c.restaurant_id=p_restaurant and (c.work_date<>p_date or c.scope<>p_scope) and (x->>'id'=tip->>'id' or lower(btrim(x->>'reference'))=lower(ref))) then raise exception 'Comprobante ya registrado'; end if;
  amount:=(tip->>'amount')::bigint;
  if amount<=0 or amount>gross or jsonb_typeof(tip->'allocations') is distinct from 'array' then raise exception 'Monto especial inválido'; end if;
  n:=jsonb_array_length(tip->'allocations');
  if n not between 1 and 200 or n>amount or (select count(distinct value->>'worker_id') from jsonb_array_elements(tip->'allocations'))<>n then raise exception 'Beneficiarios duplicados o inválidos'; end if;
  allocated:=0;i:=0;
  for allocation in select value from jsonb_array_elements(tip->'allocations') order by value->>'worker_id' loop
   select * into worker from public.propina_workers where id=(allocation->>'worker_id')::uuid and restaurant_id=p_restaurant and active;
   if not found or not exists(select 1 from jsonb_array_elements(entries) e where e->>'worker_id'=allocation->>'worker_id') then raise exception 'El beneficiario debe estar presente y pertenecer al local'; end if;
   if coalesce(allocation->>'amount','') !~ '^[0-9]+$' or (allocation->>'amount')::bigint<=0 then raise exception 'Asignación inválida'; end if;
   if tip->>'method'='equal' and (allocation->>'amount')::bigint<>(amount/n+case when i<amount%n then 1 else 0 end) then raise exception 'Reparto igualitario inválido'; end if;
   allocated:=allocated+(allocation->>'amount')::bigint;i:=i+1;
  end loop;
  if allocated<>amount then raise exception 'Las asignaciones no suman la propina'; end if;
  special:=special+amount;
 end loop;
 if special>gross then raise exception 'Las propinas especiales superan el total de caja'; end if;
 if p_scope='DAY' then
  result_id:=propina_private.propina_save_day(p_restaurant,p_date,gross-special,(p_payload->>'hours')::numeric,entries);
 else
  result_id:=propina_private.propina_save_flex_shift(p_restaurant,p_date,p_scope,gross-special,p_payload->'modes',entries);
 end if;
 rev:=coalesce(old.revision,0)+1;
 insert into propina_private.special_closure_audit(restaurant_id,work_date,scope,actor,reason,previous,replacement)
 values(p_restaurant,p_date,p_scope,auth.uid(),case when old.revision is null then 'Cierre inicial conciliado' else btrim(p_reason) end,coalesce(to_jsonb(old),'{}'),p_payload);
 insert into public.turnia_tip_closures(restaurant_id,work_date,scope,revision,gross_clp,special_clp,payload,request_id,confirmed_by)
 values(p_restaurant,p_date,p_scope,rev,gross,special,p_payload,p_request_id,auth.uid())
 on conflict(restaurant_id,work_date,scope) do update set revision=excluded.revision,gross_clp=excluded.gross_clp,special_clp=excluded.special_clp,payload=excluded.payload,request_id=excluded.request_id,confirmed_by=excluded.confirmed_by,confirmed_at=now();
 delete from public.turnia_special_allocations where restaurant_id=p_restaurant and work_date=p_date and scope=p_scope;
 for tip in select value from jsonb_array_elements(p_payload->'tips') loop
  insert into public.turnia_special_allocations
  select p_restaurant,p_date,p_scope,(tip->>'id')::uuid,w.id,(a->>'amount')::bigint,w.name,w.area_id,ar.name,tip->>'payment'
  from jsonb_array_elements(tip->'allocations') a join public.propina_workers w on w.id=(a->>'worker_id')::uuid and w.restaurant_id=p_restaurant
  join public.propina_areas ar on ar.id=w.area_id and ar.restaurant_id=p_restaurant;
 end loop;
 return jsonb_build_object('revision',rev,'shared',gross-special,'special',special);
end $$;
revoke all on function propina_private.close_special_day(uuid,date,text,jsonb,integer,uuid,boolean,text) from public,anon;
grant execute on function propina_private.close_special_day(uuid,date,text,jsonb,integer,uuid,boolean,text) to authenticated;
create function public.turnia_close_day(p_restaurant uuid,p_date date,p_scope text,p_payload jsonb,p_expected_revision integer,p_request_id uuid,p_confirmed boolean,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select propina_private.close_special_day(p_restaurant,p_date,p_scope,p_payload,p_expected_revision,p_request_id,p_confirmed,p_reason) $$;
revoke all on function public.turnia_close_day(uuid,date,text,jsonb,integer,uuid,boolean,text) from public,anon;
grant execute on function public.turnia_close_day(uuid,date,text,jsonb,integer,uuid,boolean,text) to authenticated;
-- Old clients fail closed instead of bypassing reconciliation or changing history.
create function public.propina_save_day(p_restaurant uuid,p_date date,p_amount bigint,p_shift_hours numeric,p_workers jsonb)
returns uuid language plpgsql set search_path='' as $$ begin raise exception 'Actualiza Turnia y confirma la conciliación del cierre.'; end $$;
create function public.propina_save_flex_shift(p_restaurant uuid,p_date date,p_shift text,p_amount bigint,p_modes jsonb,p_entries jsonb)
returns uuid language plpgsql set search_path='' as $$ begin raise exception 'Actualiza Turnia y confirma la conciliación del cierre.'; end $$;
revoke all on function public.propina_save_day(uuid,date,bigint,numeric,jsonb),public.propina_save_flex_shift(uuid,date,text,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.propina_save_day(uuid,date,bigint,numeric,jsonb),public.propina_save_flex_shift(uuid,date,text,bigint,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
