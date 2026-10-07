# Operator erasure verification

Verified against staging on 6 October 2026. Blocker 1 is closed for the tested operator capability. Production rollout and business/legal retention periods remain separate decisions.

## Evidence

- Linux application unit suite: 408 passing tests in 22 files.
- Operator unit suite: 11 passing tests.
- Full SQL suite passed. Native concurrency assertions: H2 56, H5 25, H6 31, operator erasure 43.
- Typecheck, lint and production build passed on Node 22.22.2.
- Hosted phase A: 12 passing checks covering real reference upload/confirmation replay/submission, customer and untargeted service denial, scoped operator freeze, stale upload-token rejection, Storage failure recovery, actual Storage deletion, old signed-download denial, completed-job replay and isolation of an unrelated submitted object.
- Hosted phase B: 8 passing checks covering real preview/final objects, H5 replacement identity, revision and approval history, committed receipt/lost-response retry, full relational cleanup, account freeze, actual Auth deletion and account replay.
- Hosted concurrency/recovery: confirmation-first and erasure-first were exercised using independent database sessions. Erasure-first confirmation hit a lock timeout while preparation held the lock, then was denied after commit. Physical deletion followed by an uncommitted receipt failure recovered safely in both orders.
- All synthetic fixtures were erased. Historical failed notifications were not retried or changed.
- Live private-schema and function privilege checks denied anon, authenticated (including application admins), and service_role access.
- Post-rotation smoke: authenticated worker HTTP 200, one synthetic notification claimed/sent with provider acknowledgement, representative submitted-project erasure and account cleanup successful. Final H7 sample: 24 scheduled HTTP 200 healthy results, watchdog healthy, no pending or overdue work.

The hosted race helper initially relied on a pooler startup timeout that did not take effect. It was corrected to SET LOCAL lock_timeout inside the transaction and rerun successfully. No application fix was required.

## Commands

~~~sh
npm run test
npm run test:erasure
AVS_KEEP_CLUSTER=1 npm run verify:db
npm run typecheck
npm run lint
npm run build
git diff --check
~~~

Hosted scripts ran outside the repository with strict TLS and the official Supabase CA. They created disposable fixtures only. No credentials, signed URLs, fixture passwords or environment files are included here. The delivery smoke used the provider's documented test sink, not a customer recipient.

## Scope and limits

H1-H7 remain closed on the existing verification baseline; this change introduces no scheduler, notification-lease or delivery redesign. Native tests cover submission, revision, final delivery, cleanup and status-change contention; live two-session tests specifically cover confirmation versus erasure. Hosted verification used actual Storage/Auth requests and authenticated RPC transactions, not a new browser UI E2E run.

One observed signed-download denial does not prove immediate invalidation of every cache or previously downloaded copy. Backups, provider records, retention periods and legal holds require their own approved policy. Unknown bucket/orphan scope fails closed for operator investigation. See [operator runbook](operator-erasure.md).

No production deployment or merge was performed as part of verification. Preserve the H6 rollout requirement: old notification workers must be drained before the new H6 migration/application combination becomes active.
