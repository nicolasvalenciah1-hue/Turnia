-- Read-only dashboard scoped to the PLATFORM owner, never to a restaurant.
-- Outbox RLS/privileges stay unchanged: authenticated clients do NOT get table SELECT.
create or replace function public.turnia_owner_support_notification_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_totals jsonb;
  v_recent jsonb;
begin
  if auth.uid() is null
     or not coalesce(propina_private.is_turnia_notification_owner(), false) then
    raise exception 'Not authorized for Turnia owner notifications'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'sent', count(*) filter (where status = 'sent'),
    'pending', count(*) filter (where status in ('pending','sending')),
    'failed', count(*) filter (where status = 'failed'),
    'total', count(*)
  ) into v_totals
  from public.turnia_support_email_outbox;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
    into v_recent
  from (
    select o.ticket_id, o.status, o.attempts, o.created_at,
           o.last_attempt_at, o.sent_at,
           t.subject, t.category,
           coalesce(r.name, 'Restaurante') as restaurant_name
    from public.turnia_support_email_outbox o
    join public.turnia_support_tickets t on t.id = o.ticket_id
    left join public.propina_restaurants r on r.id = t.restaurant_id
    order by o.created_at desc
    limit 50
  ) item;

  return jsonb_build_object('totals', v_totals, 'recent', v_recent, 'limit', 50);
end
$function$;

revoke all on function public.turnia_owner_support_notification_overview()
  from public, anon, authenticated;
grant execute on function public.turnia_owner_support_notification_overview()
  to authenticated;
comment on function public.turnia_owner_support_notification_overview() is
  'Read-only delivery status summary for active Turnia platform owners. sent=provider accepted; not proof of mailbox delivery.';
