-- Turnia support center: tenant-scoped tickets and conversations.
-- Email delivery is intentionally separate: no third-party API key is stored in the browser.
create table if not exists public.turnia_support_tickets (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.propina_restaurants(id) on delete restrict,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  category text not null check (category in ('consulta','error','mejora','otro')),
  subject text not null check (char_length(trim(subject)) between 4 and 150),
  description text not null check (char_length(trim(description)) between 10 and 5000),
  status text not null default 'pendiente' check (status in ('pendiente','en_revision','resuelto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.turnia_support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.turnia_support_tickets(id) on delete restrict,
  author_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists turnia_support_tickets_restaurant_date_idx
  on public.turnia_support_tickets (restaurant_id, created_at desc);
create index if not exists turnia_support_tickets_status_date_idx
  on public.turnia_support_tickets (status, created_at desc);
create index if not exists turnia_support_messages_ticket_date_idx
  on public.turnia_support_messages (ticket_id, created_at);

alter table public.turnia_support_tickets enable row level security;
alter table public.turnia_support_messages enable row level security;

create policy turnia_support_tickets_read on public.turnia_support_tickets
for select to authenticated using (
  (select propina_private.is_platform_admin())
  or (
    exists (
      select 1 from public.propina_access a
      where a.user_id = (select auth.uid())
        and a.restaurant_id = turnia_support_tickets.restaurant_id
        and a.active
        and (
          a.role in ('owner','admin')
          or turnia_support_tickets.created_by = (select auth.uid())
        )
    )
  )
);
create policy turnia_support_tickets_create on public.turnia_support_tickets
for insert to authenticated with check (
  created_by = (select auth.uid())
  and status = 'pendiente'
  and exists (
    select 1 from public.propina_access a
    join public.propina_restaurants r on r.id = a.restaurant_id
    where a.user_id = (select auth.uid())
      and a.restaurant_id = turnia_support_tickets.restaurant_id
      and a.active and r.active and r.archived_at is null
  )
);
create policy turnia_support_tickets_owner_status on public.turnia_support_tickets
for update to authenticated
using ((select propina_private.is_platform_admin()))
with check ((select propina_private.is_platform_admin()));

create policy turnia_support_messages_read on public.turnia_support_messages
for select to authenticated using (
  exists (select 1 from public.turnia_support_tickets t
          where t.id = turnia_support_messages.ticket_id)
);
create policy turnia_support_messages_create on public.turnia_support_messages
for insert to authenticated with check (
  author_id = (select auth.uid())
  and exists (select 1 from public.turnia_support_tickets t
              where t.id = turnia_support_messages.ticket_id)
);

revoke all on public.turnia_support_tickets from anon, authenticated;
revoke all on public.turnia_support_messages from anon, authenticated;
grant select, insert on public.turnia_support_tickets to authenticated;
grant update(status) on public.turnia_support_tickets to authenticated;
grant select, insert on public.turnia_support_messages to authenticated;
