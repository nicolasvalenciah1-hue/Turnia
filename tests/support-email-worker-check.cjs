// Offline regression checks: no live API, database mutations or secret values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const { canAutomaticallyRetry, MAX_ATTEMPTS } = await import(
    pathToFileURL(path.join(root, 'supabase/functions/turnia-support-drain/policy.mjs')).href
  );
  const now = Date.parse('2026-10-13T03:00:00Z');
  const ago = delta => new Date(now - delta).toISOString();
  const pending = {status:'pending',attempts:0};
  assert.equal(canAutomaticallyRetry(pending, now), true);
  assert.equal(canAutomaticallyRetry({...pending,status:'sent'}, now), false);
  assert.equal(canAutomaticallyRetry({...pending,attempts:MAX_ATTEMPTS}, now), false);
  assert.equal(canAutomaticallyRetry({status:'failed',attempts:1,last_attempt_at:ago(30_000),last_error:'provider_http_503'},now),false);
  assert.equal(canAutomaticallyRetry({status:'failed',attempts:1,last_attempt_at:ago(61_000),last_error:'provider_http_503'},now),true);
  assert.equal(canAutomaticallyRetry({status:'failed',attempts:2,last_attempt_at:ago(61_000),last_error:'provider_http_503'},now),false);
  assert.equal(canAutomaticallyRetry({status:'failed',attempts:2,last_attempt_at:ago(121_000),last_error:'provider_http_503'},now),true);
  assert.equal(canAutomaticallyRetry({status:'failed',attempts:1,last_attempt_at:ago(121_000),last_error:'provider_http_401'},now),false);
  assert.equal(canAutomaticallyRetry({status:'failed',attempts:1,last_attempt_at:ago(24*60*60_000),last_error:'network_or_provider_error'},now),false);
  assert.equal(canAutomaticallyRetry({status:'sending',attempts:1,last_attempt_at:ago(121_000),locked_until:ago(1_000)},now),true);
  assert.equal(canAutomaticallyRetry({status:'sending',attempts:1,last_attempt_at:ago(121_000),locked_until:new Date(now+2000).toISOString()},now),false);
  assert.equal(canAutomaticallyRetry({status:'sending',attempts:1,last_attempt_at:ago(24*60*60_000),locked_until:ago(24*60*60_000)},now),false);
  const edge=fs.readFileSync(path.join(root,'supabase/functions/turnia-support-drain/index.ts'),'utf8');
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261013_support_email_cron_security.sql'),'utf8');
  const schedule=fs.readFileSync(path.join(root,'supabase/migrations/20261013_support_email_cron_activate.sql'),'utf8');
  assert.match(edge,/turnia_support_cron_authorized/);
  assert.match(edge,/x-turnia-cron-token/);
  assert.match(edge,/\.eq\("attempts", event\.attempts\)/);
  assert.match(edge,/Idempotency-Key/);
  assert.match(edge,/\.eq\("status", "sending"\)/);
  assert.match(edge,/MAX_ATTEMPTS|canAutomaticallyRetry/);
  assert.match(migration,/vault\.create_secret/);
  assert.match(migration,/extensions\.gen_random_bytes\(32\)/);
  assert.match(migration,/revoke all on function public\.turnia_support_cron_authorized\(text\) from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.turnia_support_cron_authorized\(text\) to service_role/);
  assert.match(schedule,/vault\.decrypted_secrets/);
  assert.match(schedule,/cron\.schedule/);
  assert(!edge.includes('turnia.notificaciones@gmail.com') || edge.includes('TURNIA_SUPPORT_NOTIFY_TO'));
  console.log('PASS: worker authentication contract, bounded retries, stale locks, idempotency and private scheduled token. Offline tests only.');
})().catch(e=>{console.error(e);process.exitCode=1});
