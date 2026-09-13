# Transactional notifications

Customers and administrators should not have to refresh a page to find out that
something happened. This is how they are told.

It is transactional email only: eight messages, each caused by one thing the
customer or the studio actually did. There is no marketing list, no newsletter,
no digest and no preference centre, because there is nothing here a person would
want to unsubscribe from and still use the product.

---

## 1. The architecture, and the one rule behind it

**Email is never part of a business transaction.**

A customer approves a preview. Resend is down. The approval must still have
happened — and when Resend comes back, the email must still arrive.

So the flow is:

```
business transaction commits
  └─ a durable outbox row is written in the SAME transaction
       └─ a scheduled worker sends it, later
            └─ failure is recorded and retried, bounded
```

Nothing in the project workflow ever calls an email provider. `approve_preview()`
does not know Resend exists. If the provider is unreachable, DNS is broken, the
API returns 500, we are rate limited, or the request times out, the only
consequence is a row in `notification_outbox` with a `last_error` and a retry
time.

```
                 ┌──────────────────────────────────────────┐
  customer or    │  projects / project_revisions /          │
  admin action ─▶│  project_preview_approvals               │
                 └───────────────┬──────────────────────────┘
                                 │ AFTER trigger, same transaction
                                 ▼
                 ┌──────────────────────────────────────────┐
                 │  notification_outbox   (dedupe_key UNIQUE)│
                 └───────────────┬──────────────────────────┘
                                 │ claim_notifications() — FOR UPDATE SKIP LOCKED
     Vercel Cron ───────────────▶│ /api/internal/notifications/process
     every 5 min  (CRON_SECRET)  │
                                 ▼
                 ┌──────────────────────────────────────────┐
                 │  EmailProvider  →  Resend REST API       │
                 └──────────────────────────────────────────┘
```

---

## 2. Where events come from

**From the database, not from the page that caused them.**

A status change is a fact once it is committed, whoever caused it — the
create-project action, the admin panel, a customer RPC, or somebody in psql.
Enqueuing from a server action instead would mean every future caller has to
remember to, and two callers doing the same thing would send two emails.

So there is exactly one authoritative enqueue path per event, and it is a
trigger:

| Trigger on                  | Fires when               | Enqueues                                                                             |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `projects`                  | `DRAFT → SUBMITTED`      | `PROJECT_SUBMITTED_CUSTOMER`, `PROJECT_SUBMITTED_ADMIN`                              |
| `projects`                  | `→ PREVIEW_READY`        | `PREVIEW_READY_CUSTOMER` (first preview) or `PREVIEW_REVISED_CUSTOMER` (version > 1) |
| `projects`                  | `FINALISING → COMPLETED` | `FINAL_VIDEO_READY_CUSTOMER`                                                         |
| `project_revisions`         | INSERT                   | `REVISION_REQUESTED_ADMIN`                                                           |
| `project_preview_approvals` | INSERT                   | `PREVIEW_APPROVED_CUSTOMER`, `PREVIEW_APPROVED_ADMIN`                                |

**What deliberately sends nothing:** `ASSETS_REVIEW` and `IN_PRODUCTION`. They
are internal production stages. Telling a customer their project has moved
between two of our own queues is noise, and noise is what makes people stop
reading the messages that matter.

`PREVIEW_REVISED_CUSTOMER` is chosen on the preview's version rather than on
whether a revision row is currently open, so it does not depend on the firing
order of two triggers on the same table. Version 2 only exists after a revision:
`PREVIEW_READY → IN_PRODUCTION` is not a legal transition, so the only route
back into production is through `REVISION_REQUESTED`.

---

## 3. The outbox

`notification_outbox`, created by `20260101000700_notification_outbox.sql`.

| Column                                                       | Purpose                                          |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `event_type`                                                 | Which of the eight                               |
| `recipient`                                                  | `CUSTOMER` or `ADMIN` — a role, not an address   |
| `recipient_user_id` / `recipient_email`                      | Customer rows only, from `auth.users`            |
| `project_id`                                                 | FK, cascade                                      |
| `payload`                                                    | Rendering data. No URL, ever — enforced by CHECK |
| `status`                                                     | `PENDING` / `PROCESSING` / `SENT` / `FAILED`     |
| `attempt_count`                                              | Incremented by the claim, not by the result      |
| `next_attempt_at`                                            | When it is next due. **NULL is terminal**        |
| `claimed_at`, `sent_at`, `last_error`, `provider_message_id` | Operations                                       |
| `dedupe_key`                                                 | **UNIQUE.** The identity of the business event   |

### Two design choices worth explaining

**`next_attempt_at IS NULL` is the terminal marker, rather than a fifth status.**
A row is finished when there is no next attempt: either it was sent, or the
budget is spent. Adding a `DEAD` status would mean two fields encoding one fact
and the possibility of them disagreeing. One nullable timestamp answers both
"when next?" and "ever again?".

**An admin row carries no email address at all.** The database does not know,
and should not learn, who the studio's staff are. The worker resolves
`ADMIN_NOTIFICATION_EMAIL` at send time, which is why adding a second operator
is a comma in an environment variable rather than a migration and a backfill of
rows already queued.

### No signed URLs, enforced rather than intended

```sql
constraint notification_outbox_payload_has_no_urls check (
  payload::text !~* '(https?://|/storage/v1/|token=|[?&]signature=)'
)
```

A signed media URL is a bearer credential with an expiry. An outbox row may be
read minutes or days after it is written and then emailed — which would turn a
short-lived credential into a durable one sitting in an inbox forever. Emails
link to authenticated pages instead, so no payload ever needs a URL, and the
constraint refuses if a future change forgets.

---

## 4. Idempotency

Duplicate transactional email is unacceptable, and the same business event
genuinely does get retried — by a server action, a double-clicked button, a
browser retry, a replayed E2E run, a redeployed worker.

Every notification has a deterministic dedupe key:

```
project:{projectId}:submitted:customer
project:{projectId}:submitted:admin
project:{projectId}:preview:{assetId}:ready
project:{projectId}:revision:{revisionId}:admin
project:{projectId}:approval:{approvalId}:customer
project:{projectId}:approval:{approvalId}:admin
project:{projectId}:completed:customer
```

The column is `UNIQUE` and `enqueue_notification()` uses
`ON CONFLICT (dedupe_key) DO NOTHING`, so **idempotency is a database property,
not a code convention**. A second enqueue is silently discarded and returns null.

A preview key names the **asset**, not the project. Keying on the project would
make the second preview reuse the first preview's key, and the customer would
never be told their revision was answered — a missing email, which is the
failure nobody notices.

There is a second layer at the provider: the dedupe key is sent as Resend's
`Idempotency-Key`. The database stops a duplicate **row**; that stops a
duplicate **delivery** of one row after an ambiguous timeout.

---

## 5. The worker

`lib/notifications/processor.ts`, reached through
`/api/internal/notifications/process`.

1. `claim_notifications(limit, leaseSeconds)` takes a bounded batch in **one
   short transaction** using `FOR UPDATE SKIP LOCKED`, marks them `PROCESSING`,
   increments `attempt_count`, and sets `next_attempt_at` to a lease expiry.
2. That transaction **commits**. Only then does anything call the provider.
3. Each result is reported individually with `mark_notification_sent()` or
   `mark_notification_failed()`.

**Why the lease rather than holding the transaction open.** An open transaction
that waits on somebody else's HTTP endpoint holds locks for as long as their
slowest response, and a provider timeout becomes a database incident. With a
lease, a claimed row is invisible to other workers until it expires, and a
worker that dies mid-send releases its rows by doing nothing at all.

**Concurrency.** `SKIP LOCKED` is what lets two runners overlap — which they
will, because a cron tick can land while a manual run is in flight. Each takes
rows the other has not locked, rather than queueing behind them or duplicating
them. The attempt count is incremented by the _claim_, not by the result, so a
row that kills the process still counts as attempted and cannot spin forever.

### Retry

Bounded, and defined in SQL so the attempt count and the schedule always move
together:

| After attempt | Next try                               |
| ------------- | -------------------------------------- |
| 1             | 1 minute                               |
| 2             | 5 minutes                              |
| 3             | 30 minutes                             |
| 4             | 2 hours                                |
| 5             | never — `next_attempt_at` becomes NULL |

A failure classified **permanent** (any 4xx other than 408/429 — a rejected
address, an unverified sender, a malformed request) skips straight to the end.
Retrying it four more times would ask a question already answered and would
spend the provider's goodwill doing it.

`last_error` is redacted before it is stored: credential-shaped text (`re_…`,
`sb_secret_…`, JWTs, `Bearer …`) is replaced with `[redacted]`, because
providers do echo requests back in error bodies and that column is read on
screen and pasted into support conversations.

---

## 6. Email content and privacy

One layout, `lib/notifications/templates/layout.ts`, and eight sets of words.
Single-column table, inline styles, no external stylesheet, no `<style>` block,
no images — email clients are the least forgiving rendering target in use.

Every message has a subject, a preheader, an HTML part, a plain-text part, the
public project reference, and one call to action.

**What no email contains:** an internal UUID in visible copy, a storage path, a
signed URL, an attachment, a reference image, the creative brief, the consent
record, admin-only data, a secret, or a stack trace. The revision request in
particular stays in the authenticated portal — it is the customer's own words
about their own film, and a forwarded operations email is not the place for it.

The project is named `AVS-000123`. A link may carry the project id because that
is what a route is, but **possessing the URL grants nothing**: the page is
behind authentication and RLS, and the delivery route re-authorises on every
request.

### Customer address, and what happens if it changes

The address is captured from `auth.users` **at enqueue time**, inside a
`SECURITY DEFINER` trigger. Nothing the browser sends can influence it —
`notification_outbox` has no INSERT policy for any role.

If a customer changes their email between an event being queued and the worker
sending it (a window of minutes), **that one notification goes to the address
they held when the event happened.** This is deliberate. Re-resolving at send
time would mean that an attacker who briefly controlled an account could change
the address and have already-queued messages follow them. Later notifications
use the new address, because they are enqueued later.

---

## 7. Access control

| Who                     | Can                                                    |
| ----------------------- | ------------------------------------------------------ |
| Customer                | **Nothing.** No read, no write, no RPC                 |
| Admin                   | Read the outbox; requeue a dead-lettered row           |
| Worker (`service_role`) | Claim, mark sent, mark failed                          |
| Anyone                  | No INSERT, UPDATE or DELETE policy exists for any role |

A customer cannot read even their own notification rows. An outbox row says
which address we hold, what failed and how many times; that is operational data
with no use to them and several reasons not to expose it.

> **A trap worth knowing about.** Supabase projects ship with
> `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,
authenticated, service_role`. A new function is therefore executable by every
> API role the moment it is created, and `REVOKE … FROM PUBLIC` does **not**
> remove a grant held by a named role. Every internal function here revokes from
> `anon` and `authenticated` explicitly, and
> `supabase/tests/01_schema_assertions.sql` asserts it. Without that,
> `enqueue_notification()` is callable by any signed-in customer — who could
> then take a dedupe key before the workflow does, and the notification that
> event should have produced would never be created. Suppressing somebody's
> email is a quieter attack than forging one.

---

## 8. Setting it up

### 8.1 Resend

1. Create an account at [resend.com](https://resend.com).
2. **Add and verify a domain.** This is not optional: Resend refuses to send
   from an unverified domain, and every attempt fails _permanently_, so the
   queue fills with dead-lettered rows rather than retrying. Add the DKIM and
   SPF records it gives you and wait for verification.
3. Create an API key with **send** permission only.
4. Set `EMAIL_FROM` to an address on that verified domain, e.g.
   `AI Video Studio <studio@your-domain.com>`.

### 8.2 Environment variables

All server-only. **None may be prefixed `NEXT_PUBLIC_`** — that inlines the
value into the browser bundle. `tests/notification-config.test.ts` fails if one
ever is.

| Variable                   | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `RESEND_API_KEY`           | Provider credential                                  |
| `EMAIL_FROM`               | Verified sender                                      |
| `ADMIN_NOTIFICATION_EMAIL` | Operational recipient; comma-separate for several    |
| `CRON_SECRET`              | Protects the worker endpoint. `openssl rand -hex 32` |
| `SUPABASE_SECRET_KEY`      | The worker's database credential — see below         |

`NEXT_PUBLIC_SITE_URL` is still used, for the links in the emails.

### 8.3 Why there is now a Supabase secret key

Every other Supabase client in this application acts as the signed-in user and
is subject to RLS. The notification worker has **no user**: it is woken by a
scheduler, and the rows it drains belong to whoever happened to trigger them.
There is no session to borrow, so it needs a credential of its own.

The alternative considered and rejected was a shared token verified inside a
`SECURITY DEFINER` function, so that no RLS-bypassing key exists anywhere. It
does not remove the secret, it relocates it into the database and adds a manual
SQL step — and it reimplements API-key verification in PL/pgSQL, which is not a
thing to hand-roll.

Containment instead:

- Read by one module, `lib/notifications/config.ts`.
- Used by one client, `lib/supabase/worker.ts`.
- Imported by one consumer, `lib/notifications/processor.ts` — asserted by test.
- Reachable from one route, which verifies `CRON_SECRET` in constant time
  **before** the client is constructed.
- The worker only ever calls three functions, each granted to `service_role`
  alone.

### 8.4 Scheduling the worker

The worker endpoint does not care what calls it. It is the same protected route
whether that is Vercel Cron, a GitHub Actions schedule, or an operator with
curl: `CRON_SECRET`, compared in constant time, is the only thing it checks.
Changing the scheduler therefore changes nothing about the notification
architecture.

**Today, on Vercel Hobby: GitHub Actions.**

Vercel Cron on Hobby cannot run more often than **once a day**, and a queue
drained daily is not a notification system. So `.github/workflows/
notification-worker.yml` calls the endpoint on a five-minute schedule instead.
`vercel.json` has been removed; there is no Vercel cron entry to conflict with.

Two repository secrets, under **Settings → Secrets and variables → Actions**:

| Secret                     | Value                                                          |
| -------------------------- | -------------------------------------------------------------- |
| `NOTIFICATIONS_WORKER_URL` | `https://<your-deployment>/api/internal/notifications/process` |
| `CRON_SECRET`              | The same value as `CRON_SECRET` in Vercel                      |

Neither the URL nor the secret appears anywhere in the repository. The workflow
fails fast, naming the missing secret and nothing about its value, if either is
unset.

The token is written to a `curl` config file rather than passed as an argument,
so it never reaches the process's argv, and the workflow uses no `set -x`
anywhere — GitHub's log masking is a safety net, not a reason to hand it the
secret. A non-2xx response fails the run, with the worker's own message (which
names configuration variables, never their values). There is no `--retry`: a
5xx is something to see rather than paper over, and the next scheduled run is
the retry.

`workflow_dispatch` runs it on demand, from the Actions tab.

> **This is an MVP arrangement.** GitHub's scheduler is explicitly best-effort.
> Runs are queued on shared infrastructure, are frequently five to fifteen
> minutes late, are dropped entirely under load, and are **disabled
> automatically on a repository with no activity for 60 days**. Nothing is lost
> when a run is skipped — the outbox is durable and a due row stays due until
> something claims it — but "within five minutes" is a hope, not a guarantee. A
> customer may occasionally wait twenty minutes for a preview-ready email.

**Confirming it is running.** Actions tab → _Notification worker_ → the latest
run's job summary shows the HTTP status and the worker's JSON result. In the
application, `/admin/notifications` shows "Sent (24h)" climbing and "Queued"
staying near zero.

#### Moving to production: back to Vercel Cron

Do it in this order. The overlap is safe — the worker claims with
`FOR UPDATE SKIP LOCKED` and every claim takes a lease, so two schedulers cannot
process the same row — but running both wastes invocations on an empty queue.

1. Upgrade the Vercel project to **Pro**.
2. Recreate `vercel.json` at the repository root:

   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "crons": [
       {
         "path": "/api/internal/notifications/process",
         "schedule": "*/5 * * * *"
       }
     ]
   }
   ```

3. Deploy, and confirm the schedule in the Vercel dashboard → the project →
   Settings → Cron Jobs. It lists the last run and its status code; the
   invocation also appears in the project's function logs.
4. **Only then** delete `.github/workflows/notification-worker.yml`, and remove
   the `NOTIFICATIONS_WORKER_URL` repository secret. Leave `CRON_SECRET` in
   Vercel — that is what the endpoint checks, and Vercel Cron sends it as
   `Authorization: Bearer $CRON_SECRET` automatically once the variable is set
   on the project. There is nothing to configure in `vercel.json` for it.

Deleting the workflow first, before the Vercel schedule is confirmed working,
leaves the queue with no scheduler at all — which is silent, because a queue
that nobody drains looks exactly like a queue with nothing in it until a
customer asks why they were never emailed.

Five minutes either way, not tighter: the queue is small, the messages are not
time-critical to the second, and a tighter schedule spends invocations and
provider goodwill to save a customer four minutes.

### 8.5 Running it by hand

```bash
# Locally, against your dev server:
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/internal/notifications/process

# Against a deployment:
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/internal/notifications/process
```

It answers with `{ "claimed": n, "sent": n, "failed": n, "skipped": n,
"provider": "resend" }`.

### 8.6 Development without Resend

If `RESEND_API_KEY` and `EMAIL_FROM` are unset **and** `NODE_ENV=development`,
the worker uses a console provider that prints:

```
[notifications] NOT SENT — no email provider configured. Would send "…" to …
```

Anywhere else, an unconfigured provider is an **error**, recorded against the
row and visible in `/admin/notifications`. It never silently reports success: a
deployment that marks everything `SENT` while sending nothing is worse than one
that is visibly broken, because nobody goes looking for it.

Tests use a fake provider and never reach the network.

---

## 9. Operations

`/admin/notifications` answers: what was supposed to send, to whom, for which
project, when, how many attempts, did it succeed, and what did the provider say.

**Queued** climbing and **Sent (24h)** flat → the worker is not running. Check
the cron job and `CRON_SECRET`.

**Needs attention** above zero → rows that used their whole budget. Read
`last_error`, fix the cause, then **Retry** — which updates the same row, so the
dedupe key survives and nobody receives a duplicate.

| `last_error`                                        | Usually means                                               |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `Provider responded 403` / `domain is not verified` | §8.1 step 2 is incomplete                                   |
| `Provider responded 422: Invalid 'to' field`        | The address on file is not deliverable                      |
| `Provider responded 429`                            | Rate limited; it will retry by itself                       |
| `Network error: …`                                  | DNS or egress; it will retry by itself                      |
| `ADMIN_NOTIFICATION_EMAIL is not configured`        | Set the variable and retry                                  |
| `Email is not configured`                           | `RESEND_API_KEY` / `EMAIL_FROM` missing in this environment |

Nothing here logs an API key or an email body. The console provider logs the
subject and recipient only — a development log is still a record.

---

## 10. Testing

| Layer    | Where                                       | Covers                                                                       |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Database | `supabase/tests/06_notification_outbox.sql` | Events, idempotency, RLS, the worker's claim/retry cycle, the URL constraint |
| Schema   | `supabase/tests/01_schema_assertions.sql`   | Objects, grants, the absence of write policies                               |
| Unit     | `tests/notification-events.test.ts`         | Dedupe keys and the retry schedule, compared against the migration           |
| Unit     | `tests/notification-templates.test.ts`      | Subjects, both bodies, and what must not appear                              |
| Unit     | `tests/notification-provider.test.ts`       | Error classification, idempotency header, redaction                          |
| Unit     | `tests/notification-processor.test.ts`      | Addressing, failure handling, batch isolation                                |
| Unit     | `tests/notification-config.test.ts`         | No `NEXT_PUBLIC_` leak; the secret key stays contained                       |
| E2E      | `e2e/delivery-lifecycle.spec.ts`            | Every lifecycle event is enqueued                                            |
| Live     | `scripts/verify-live.ts`                    | Customers cannot read, enqueue, drain or suppress                            |

**No test sends a real email, and `verify:live` deliberately does not either.**
A security suite that mails real people every time it runs is a suite people
turn off. Whether Resend delivers is proved once, deliberately, by submitting a
project in a staging environment and watching `/admin/notifications`.
