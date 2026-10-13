-- Turnia: isolated special tips draft schema. NOT applied to production.
create table public.turnia_special_tips (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.propina_restaurants(id),
 day_id uuid not null references public.propina_days(id),
 amount_clp bigint not null check(amount_clp>0),
 payment_method text not null check(payment_method in ('debito','credito','efectivo','transferencia')),
 note text not null default '',
 idempotency_key uuid not null,
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 voided_at timestamptz,
 unique(restaurant_id,idempotency_key),
 unique(id,restaurant_id)
);
create table public.turnia_special_tip_allocations (
 tip_id uuid not null,
 restaurant_id uuid not null,
 worker_id uuid not null references public.propina_workers(id),
 amount_clp bigint not null check(amount_clp>0),
 primary key(tip_id,worker_id),
 foreign key(tip_id,restaurant_id) references public.turnia_special_tips(id,restaurant_id)
);
create index on public.turnia_special_tips(restaurant_id,day_id);
create index on public.turnia_special_tip_allocations(restaurant_id,worker_id);
alter table public.turnia_special_tips enable row level security;
alter table public.turnia_special_tip_allocations enable row level security;
-- Fail closed: no direct client access until transactional RPCs and tenant/worker RLS are audited.
revoke all on public.turnia_special_tips from anon,authenticated;
revoke all on public.turnia_special_tip_allocations from anon,authenticated;
-- Before release implement transactionally: check tenant and same-day workers,
-- validate allocations sum == amount, lock day, reconcile gross - special,
-- require explicit confirmation before settlement, and audit voids.
