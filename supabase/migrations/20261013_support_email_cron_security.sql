-- A dedicated, authenticated server-side worker for support email delivery.
-- No customer data is modified and no literal credentials are stored in migrations.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Create an unguessable internal token directly in Vault without returning its value.
do $vault$
begin
  if not exists (select 1 from vault.secrets where name = 'turnia_support_cron_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'turnia_support_cron_token',
      'Private authentication for Turnia support-email scheduled worker'
    );
  end if;
end
$vault$;

-- Edge Function service role alone may validate the Cron token.
-- No browser role may invoke this function via PostgREST.
create or replace function public.turnia_support_cron_authorized(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $body$
  select length(coalesce(p_token, '')) = 64
     and exists (
       select 1 from vault.decrypted_secrets
       where name = 'turnia_support_cron_token'
         and decrypted_secret = p_token
     );
$body$;
revoke all on function public.turnia_support_cron_authorized(text) from public, anon, authenticated;
grant execute on function public.turnia_support_cron_authorized(text) to service_role;
