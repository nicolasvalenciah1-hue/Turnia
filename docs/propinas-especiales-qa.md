# Propinas especiales — 2026-10-13

Implemented on the existing `feature/propinas-especiales` branch. Existing Supabase and Render resources are retained.

## Behavior

- Enter **all tips in the cash closing**, including special tips, in the existing amount field. This is not total restaurant sales.
- Add each special tip with payment method, a unique receipt/reference (include date/terminal/operation), beneficiaries, and equal or custom integer-CLP allocations. Beneficiaries must be active, belong to the restaurant, and participate in the selected day/shift.
- Equal distribution assigns remainder pesos in worker-ID order. No money is created or lost.
- The preview shows gross minus special tips. The existing calculation receives only the shared remainder; existing area percentages and participation rules remain unchanged.
- A mandatory checkbox confirms reconciliation, including when no special tips exist. Changing inputs clears confirmation.
- The server saves the general distribution, closure, special allocations and audit in one transaction. An error rolls everything back.
- Double submission uses a request UUID. Reuse with different data fails; stale revision numbers fail. The restaurant lock serializes concurrent saves. Unique references and tip IDs prevent reuse in another date or shift.
- Corrections to **new-module closures** require a reason and expected revision; previous closure payloads are preserved in the private audit table. Existing classic settlement revision audit remains in place.
- Pre-module historical dates cannot be converted or recalculated using this module. No backfill, normalization, or historical UPDATE is performed.
- AM/PM retain existing per-shift and daily-unique rules. Special tips are deducted once from their specific shift, and assigned independently of general participation weights.
- Weekly, daily, personal summaries and exports label special allocations and add them once. Individual allocations use stored worker/area names.
- Worker access, including shared-view workers, exposes only their own special allocation rows. Restaurant managers retain management access. Closure JSON and receipts are manager-only; audit rows are private.
- Draft entries remain in memory until closure; unsaved drafts are not durable across page reloads.

## Verification

`npm ci && npm test`

The suite runs existing account, invitation, security, permissions, recovery, area, history and Excel tests, plus:

- Production JavaScript calculation tests and exact-peso conservation over variable amounts and beneficiary counts.
- PostgreSQL via PGlite, executing the actual prior calculation migration and the new migration. Tests check atomic closure, equal/custom allocations, bad totals, duplicate receipts/beneficiaries, beneficiaries absent from attendance, cross-restaurant denial, retry identity, stale revisions, correction reasons, audit, zero totals, full special deduction, DAY/AM/PM, daily-unique totals, historical protection and RLS as two workers and anonymous.
- jsdom functional flow: mandatory confirmation, adding beneficiaries, duplicate reference, invalidation on amount change, net preview, saving, gross restoration, weekly Excel and individual totals, correction reason and revision.

Database tests use synthetic local data. UI tests mock the API; they do not send emails, move money or change customer records. Real production user-account interaction is not simulated by these tests.

## Release

Migration: `20261013212424_special_tips_atomic_closure.sql`.

Apply only after tests pass. New frontend requires this schema. Older clients receive an explicit refresh/reconciliation error on legacy save RPCs, so they cannot bypass confirmation. Read paths remain available.

Capture hashes of `propina_days`, `propina_day_settlements` and `propina_flex_shifts` before and after migration. Confirm they match. Verify new RLS policies/privileges and Render deployment health.

Existing unrelated Supabase advisories are out of scope: pg_net in public, selected pre-existing privileged public RPCs, leaked-password protection disabled, and intentionally private RLS tables without policies. References: https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

If frontend deployment fails, keep schema and records intact and redeploy the tested frontend; do not drop closure/audit tables or revert calculations after new closures exist.
