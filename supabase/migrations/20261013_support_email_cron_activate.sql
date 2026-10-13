-- ACTIVATE ONLY AFTER the private drain function has deployed and passed checks.
-- The SQL job stores a Vault lookup, NOT the token itself. Existing rows are
-- never deleted; the worker ignores already-sent tickets and bounds retries.
do $activate$
begin
  if not exists (select 1 from cron.job where jobname = 'turnia-support-email-drain') then
    perform cron.schedule(
      'turnia-support-email-drain',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://kfaolqnrqlypoyzkejlt.supabase.co/functions/v1/turnia-support-drain',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-turnia-cron-token', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'turnia_support_cron_token'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  end if;
end
$activate$;
