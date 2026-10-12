# H6: notification claim acknowledgement and recovery

## Contract

`claim_notifications` commits one live claim with a fresh UUID token, increments
`attempt_count`, and stores lease expiry in `next_attempt_at`. The worker claims
one row at a time. Only service-role callers may claim or acknowledge.

Both acknowledgement RPCs require the row ID and current claim token. They lock
the row before testing wall-clock expiry, require PROCESSING and a live lease,
and return true only when the state change commits. A stale/duplicate call
returns false. RPC errors, false responses and acknowledgement timeouts are
reported as acknowledgementErrors; the endpoint returns HTTP 500. They do not
increment sent/failed/skipped or trigger a compensating failure write.

Attempts 1–4 can be reclaimed after lease expiry. Each claim rotates the token.
An expired fifth claim is swept to FAILED with no next attempt, a cleared token,
and an explicit unknown-provider-outcome error. This is the existing operator
UI's dead-letter state. Each claim invocation sweeps up to 100 exhausted rows
using SKIP LOCKED, even when there are no deliveries to claim. Recovery therefore
requires another worker invocation; scheduling remains outside H6.

Admin retry preserves the row and event key, resets the attempt budget and clears
the token. It cannot interrupt a live lease or requeue SENT. A late worker cannot
acknowledge after manual retry.

## Execution limits

The worker has a 50-second budget inside the route's 60-second maximum. It starts
a row only with at least 20 seconds remaining: 5 for claiming, 10 for all provider
calls/recipients, 5 for acknowledgement. Resend bounds fetch and response-body
consumption and aborts its transport. Unknown providers that ignore cancellation
cannot hold the worker indefinitely, but their underlying operation may continue.
Database RPC transports receive cancellation signals. An ambiguous timeout never
proves that a provider or database operation did not commit.

Provider timeouts and unexpected exceptions are transient failures and use the
existing retry schedule. Exhausted/permanent failures stop for operator review.
Successful earlier acknowledgements survive a later failure; unclaimed work
remains queued. No secrets or recipient content are logged for acknowledgement
failures.

## Rollout

Migration 20260101001200 replaces tokenless acknowledgement signatures. Pause and
drain existing notification workers before applying it; deploy the matching
worker before resuming invocations. Do not run the old worker against the new
RPC contract: old code ignores its RPC errors. Existing PROCESSING claims acquire
tokens only when reclaimed, or dead-letter after final expiry. Do not reset them
while an old provider request may still be active. Apply through the normal
migration transaction/history mechanism. Do not roll back to tokenless RPCs.

No scheduler configuration, business-event generator, asset workflow or H1–H5
migration is changed. A production rollout is a separate action.

## Verification and limits

`tests/notification-acknowledgement.test.ts` covers the actual Supabase adapter's
error/false acknowledgements. Processor/provider tests cover success, transient
and permanent failure, mid-batch errors, stable event keys and bounded calls.
`supabase/tests/06_notification_outbox.sql` exercises the token-bearing contract.
`supabase/tests/concurrency/04_notification_claims.mjs` uses independent native
connections, simultaneous claims/acknowledgements and an explicitly held row lock.
It can also run against selected staging using a test admin ID; unrelated queue
rows are locked and skipped, and only its own fixtures are removed.

Queue/event deduplication is not exactly-once inbox delivery. A provider may have
accepted a timed-out send. Provider key retention is finite; delayed/manual
retries and a changed operator recipient list can still duplicate delivery. The
separate per-recipient idempotency finding and H7 scheduler remain out of scope.
