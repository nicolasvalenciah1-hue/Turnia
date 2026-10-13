-- Queue support alerts without exposing customer reports or mail credentials to the browser.
-- New tickets only: do not automatically email historical test tickets.
create table if not exists public.turnia_support_email_outbox (
  ticket_id uuid primary key references public.turnia_support_tickets(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  locked_until timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists turnia_support_email_outbox_pending_idx
  on public.turnia_support_email_outbox (status, created_at);

alter table public.turnia_support_email_outbox enable row level security;
revoke all on public.turnia_support_email_outbox from public, anon, authenticated;
grant select, insert, update on public.turnia_support_email_outbox to service_role;

create or replace function propina_private.turnia_enqueue_support_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.turnia_support_email_outbox (ticket_id)
  values (new.id) on conflict (ticket_id) do nothing;
  return new;
end;
$$;
revoke all on function propina_private.turnia_enqueue_support_email() from public, anon, authenticated;

drop trigger if exists turnia_support_email_enqueue on public.turnia_support_tickets;
create trigger turnia_support_email_enqueue
after insert on public.turnia_support_tickets
for each row execute function propina_private.turnia_enqueue_support_email();
