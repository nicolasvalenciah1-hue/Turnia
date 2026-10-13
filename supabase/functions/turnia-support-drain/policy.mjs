// Pure policy used by the Edge worker and Node regression tests.
// Resend deduplicates an idempotency key for 24h. Ambiguous outcomes older
// than that must be reviewed manually instead of re-sent automatically.
export const MAX_ATTEMPTS = 5;
export const IDEMPOTENCY_SAFETY_MS = 23 * 60 * 60 * 1000;
export function canAutomaticallyRetry(row, now = Date.now()) {
  if (!row || row.status === 'sent' || row.attempts >= MAX_ATTEMPTS) return false;
  if (row.status === 'pending') return true;
  const last = Date.parse(row.last_attempt_at || '');
  if (!Number.isFinite(last)) return false;
  const elapsed = now - last;
  if (elapsed < 0) return false;
  if (row.status === 'sending') {
    const lock = Date.parse(row.locked_until || '');
    return Number.isFinite(lock) && lock < now && elapsed < IDEMPOTENCY_SAFETY_MS;
  }
  if (row.status !== 'failed') return false;
  if (/^provider_http_(400|401|403|404|413|422)$/.test(row.last_error || '')) return false;
  if ((row.last_error === 'network_or_provider_error' ||
       row.last_error === 'provider_no_message_id') &&
      elapsed >= IDEMPOTENCY_SAFETY_MS) return false;
  const delay = Math.min(15 * 60_000, 60_000 * Math.pow(2, Math.max(0, row.attempts - 1)));
  return elapsed >= delay;
}
