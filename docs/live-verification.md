# Live verification

How to run the Milestone 1.5 verification suites against a real Supabase
project, and how to read the result.

The security model has two halves. The database half — RLS policies, triggers,
constraints, storage policy predicates — is provable offline with
`npm run verify:db`, which applies the migrations to a throwaway PostgreSQL
cluster and attacks it as real `anon` / `authenticated` roles. The half above
Postgres — **Supabase Auth, the PostgREST HTTP API and the Storage API** — can
only be proved against a live project.

`.github/workflows/live-supabase-verification.yml` runs that second half from a
GitHub-hosted runner.

---

## Contents

- [Before you start](#before-you-start)
- [1. Apply the migrations](#1-apply-the-migrations)
- [2. Create the three test accounts](#2-create-the-three-test-accounts)
- [3. Promote only the admin account](#3-promote-only-the-admin-account)
- [4. Configure the GitHub secrets](#4-configure-the-github-secrets)
- [5. Trigger the workflow](#5-trigger-the-workflow)
- [What a successful verification looks like](#what-a-successful-verification-looks-like)
- [How to interpret failures](#how-to-interpret-failures)
- [Housekeeping](#housekeeping)
- [Security notes](#security-notes)

---

## Before you start

> **Use a non-production Supabase project.**
>
> Both suites sign in as real accounts, create real rows and real storage
> objects, and delete them again. `scripts/verify-live.ts` cleans up after
> itself; the Playwright specs deliberately leave submitted projects behind so
> you can inspect them. Never point this at a project holding real customer
> photographs.

You will need:

- A Supabase project you are willing to write test data into.
- Permission to add repository secrets (**Settings → Secrets and variables →
  Actions**).
- Access to the project's SQL Editor, for the migrations and the one admin
  promotion.

---

## 1. Apply the migrations

**The workflow does not do this, on purpose.** Applying schema changes is a
deliberate act, not something a test run should perform as a side effect. Do it
once, by hand, before the first workflow run — and again whenever
`supabase/migrations/` changes.

First confirm they still apply cleanly from scratch, locally:

```bash
npm run verify:db
```

That drops and recreates a throwaway database, applies all five migrations in
order, and runs 129 security assertions. If it fails, fix the migration before
touching the Supabase project.

### With the Supabase CLI (recommended)

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

`<your-project-ref>` is the subdomain of your project URL — for
`https://abcdefghijklm.supabase.co` it is `abcdefghijklm`.

To see what would be applied first:

```bash
npx supabase db push --dry-run
```

### By hand

Open **SQL Editor** in the Supabase dashboard and run each file's contents in
this order, one at a time, checking each succeeds before the next:

1. `supabase/migrations/20260101000000_initial_schema.sql`
2. `supabase/migrations/20260101000100_row_level_security.sql`
3. `supabase/migrations/20260101000200_storage.sql`
4. `supabase/migrations/20260101000300_seed_reference_data.sql`
5. `supabase/migrations/20260101000400_status_transition_guard.sql`
6. `supabase/migrations/20260101000500_add_finalising_status.sql`
7. `supabase/migrations/20260101000600_delivery_workflow.sql`

Files 3, 4, 6 and 7 are idempotent and safe to re-run. 1, 2 and 5 are not.

**Run 6 and 7 as separate statements, in that order.** PostgreSQL refuses to use
a new enum value in the transaction that added it, so `FINALISING` must be
committed before migration 7 references it. `npx supabase db push` handles this
by applying each file in its own transaction; pasting both into one SQL Editor
tab would not.

### Then confirm the result

In the SQL Editor:

```sql
-- 7 tables, every one with RLS enabled.
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

-- Both buckets must exist and both must be PRIVATE.
select id, public, file_size_limit, allowed_mime_types from storage.buckets;

-- 8 experiences, 8 portfolio items.
select (select count(*) from public.video_experiences where active) as experiences,
       (select count(*) from public.portfolio_items where active)   as portfolio;

-- Milestone 2A: FINALISING exists, and the delivery objects are in place.
select exists (
  select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'project_status' and e.enumlabel = 'FINALISING'
) as has_finalising;

select count(*) as delivery_tables from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('project_revisions', 'project_preview_approvals');   -- expect 2

select count(*) as delivery_rpcs from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('approve_preview', 'request_project_revision');      -- expect 2
```

If `public` is `true` for either bucket, stop and fix it before uploading
anything — customer photographs must never have a public URL.

### Configure Auth

**Authentication → URL Configuration:**

- **Site URL** — your normal origin (e.g. `http://localhost:3000`).
- **Redirect URLs** — add `/auth/confirm` and `/auth/callback` for every origin
  you use.

The workflow signs in with email and password only, so it needs no redirect URL
of its own.

**Email confirmation** may be on or off. If it is **on**, you must confirm each
of the three test accounts before the workflow can sign in as them — see below.

---

## 2. Create the three test accounts

The suites need three principals so that isolation can be tested from both
sides. Use throwaway addresses on the non-production project. **Never use a
personal login, and never reuse a password you use anywhere else.**

| Principal      | Suggested address             | Role     |
| -------------- | ----------------------------- | -------- |
| **Customer A** | `avs-customer-a@example.test` | customer |
| **Customer B** | `avs-customer-b@example.test` | customer |
| **Admin**      | `avs-admin@example.test`      | admin    |

Sign each one up through the application's own `/signup` page (locally with
`npm run dev`, or on a deployed preview). Going through the real flow is
deliberate: it exercises the `on_auth_user_created` trigger, so you also confirm
each account got a `profiles` row.

If email confirmation is enabled, confirm all three before continuing. If you
would rather not receive three emails, you can either turn confirmation off
while you set up, or confirm them directly:

```sql
-- Only on a non-production project, and only for these three accounts.
update auth.users
set email_confirmed_at = now()
where email in (
  'avs-customer-a@example.test',
  'avs-customer-b@example.test',
  'avs-admin@example.test'
)
and email_confirmed_at is null;
```

Check all three exist and have profiles:

```sql
select u.email, p.role, u.email_confirmed_at is not null as confirmed
from auth.users u
join public.profiles p on p.id = u.id
where u.email like 'avs-%'
order by u.email;
```

You should see three rows, all `confirmed = true`, all `role = customer`.

---

## 3. Promote only the admin account

There is no application path that can grant a role. An RLS policy pins
`profiles.role`, and `profiles_enforce_role_immutable` raises `42501` on any
change from a non-service-role caller. Since this application holds no secret
key, **no request through the application can change a role at all** — not a
customer's own, and not an admin acting on someone else's. That is verified in
both the database suite and `scripts/verify-live.ts`.

Promotion is therefore a deliberate, out-of-band SQL action. Run this in the
**Supabase SQL Editor**, which connects as `postgres`:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where email = 'avs-admin@example.test'
);
```

Confirm exactly one account was promoted — and that it is the right one:

```sql
select u.email, p.role
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin';
```

> If that query returns more than one row, or an address you did not intend,
> demote the extras with the same statement and `set role = 'customer'`. An
> unintended admin can read every customer's brief and reference photographs.

---

## 4. Configure the GitHub secrets

**Settings → Secrets and variables → Actions → New repository secret.**

All eight are required. The workflow's first step fails immediately, before
checking out the code, if any is missing — and it reports only the missing
_names_, never a value.

| Secret                                 | Value                                     | Sensitive?            |
| -------------------------------------- | ----------------------------------------- | --------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://<project-ref>.supabase.co`       | No — public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable | No — public by design |
| `E2E_CUSTOMER_A_EMAIL`                 | Customer A's address                      | Low                   |
| `E2E_CUSTOMER_A_PASSWORD`              | Customer A's password                     | **Yes**               |
| `E2E_CUSTOMER_B_EMAIL`                 | Customer B's address                      | Low                   |
| `E2E_CUSTOMER_B_PASSWORD`              | Customer B's password                     | **Yes**               |
| `E2E_ADMIN_EMAIL`                      | Admin's address                           | Low                   |
| `E2E_ADMIN_PASSWORD`                   | Admin's password                          | **Yes**               |

Notes:

- On an older Supabase project the publishable key is labelled `anon` `public`
  and is a long JWT beginning `eyJ...`. Either form goes in the same secret.
- The first two are not confidential — every browser that loads the application
  receives both, and RLS is what protects the data. They are stored as secrets
  purely so all eight values are configured the same way.
- **Do not add these to `.env.example`.** That file documents variable _names_
  only and must never carry a value.
- There is **no Supabase secret/service-role key**, here or anywhere in this
  repository. No verification operation needs one: every check runs as a real
  principal precisely so that RLS is what is being tested. Adding one would
  weaken the suite, not strengthen it.

### Optional: require approval before each run

The job declares `environment: live-verification`. Under **Settings →
Environments → live-verification** you can add **Required reviewers**, after
which every run waits for a human before the secrets are exposed to it. Worth
doing if more than one person can trigger workflows.

---

## 5. Trigger the workflow

1. **Actions** tab → **Live Supabase verification** in the left sidebar.
2. **Run workflow**.
3. Pick the branch, optionally type a reason (it appears in the summary).
4. **Run workflow**.

It is `workflow_dispatch` only — nothing runs it on push, on a pull request, or
on a schedule. Runs are serialised by a concurrency group, so a second run
queues behind the first rather than colliding with it in the shared project.

Locally, the same suites are:

```bash
npm run verify:db     # no credentials needed
npm run verify:live   # needs the six E2E_* values in .env.local
npm run test:e2e      # authenticated specs skip without them
```

---

## What a successful verification looks like

Every row in the job summary reads `success`:

| Step                                   | Proves                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| Secret preflight                       | all eight secrets configured                                 |
| Format check / Lint / Typecheck        | the tree is clean                                            |
| Unit and integration tests             | 73 assertions over pure logic                                |
| Production build                       | it compiles against the real configuration                   |
| Live verification (auth, API, storage) | Auth, PostgREST and the Storage API enforce the model        |
| End-to-end tests                       | the customer, isolation and admin journeys work in a browser |

**And — this is the part that actually closes Milestone 1.5 — the end-to-end
step must report zero skipped tests.**

The authenticated specs skip themselves when credentials are absent. A run that
says `15 passed, 11 skipped` has proved nothing new: it means the secrets were
not reaching the specs. The target is:

```
28 passed (…)
```

(26 before Milestone 2A; the delivery lifecycle added two.)

Similarly, `npm run verify:live` must end with:

```
All live verification checks passed.
```

and a matrix in which every row reads `PASS`. Any `FAIL` row names the attack,
what was expected and what actually happened.

Milestone 1.5 is complete when a single run shows all of:

- every summary row `success`;
- `verify:live` all `PASS`, zero `FAIL`;
- Playwright **26 passed, 0 skipped**.

---

## How to interpret failures

### The run stops at the secret preflight

One or more secrets are missing. The summary lists exactly which names. Nothing
was checked out and nothing ran.

### `Could not sign in as Customer A`

`verify:live` exits with code `2`. Either the account does not exist, the
password secret is wrong, or email confirmation is enabled and that account was
never confirmed. Re-check [step 2](#2-create-the-three-test-accounts).

### `E2E_ADMIN_EMAIL is not an admin (role = customer)`

Also exit code `2`. The promotion in [step 3](#3-promote-only-the-admin-account)
did not run, or ran against a different address. Every admin assertion would
otherwise pass vacuously, so the script refuses to continue — a suite that
passes for the wrong reason is worse than no suite.

### A `FAIL` row in the `verify:live` matrix

Read the `Expected` and `Actual` columns. Two very different meanings:

- **Expected `DENIED`, actual `ALLOWED`** — a real security failure. Something
  that should be impossible is possible against the live project. Stop and
  investigate before anything else. Compare against `npm run verify:db`: if the
  database suite passes but the live one fails, the difference is above Postgres
  (a policy not applied to this project, a bucket left public, a migration not
  run) rather than in the migrations themselves.
- **Expected `ALLOWED`, actual `DENIED`** — usually configuration, not a breach:
  a migration not applied, a bucket missing, seed data absent. Re-run
  [step 1](#1-apply-the-migrations)'s confirmation queries.

### Playwright reports `11 skipped`

The credentials are not reaching the specs. The preflight passed, so the secrets
exist — check they are spelled exactly as in the table above, and that the run
used a branch containing this workflow file.

### A Playwright spec fails

The HTML report is attached to the failed run as an artifact
(`playwright-report-<run id>`, kept 7 days). It includes screenshots.

**Traces are deliberately disabled** — see [Security notes](#security-notes).
To debug with a trace, reproduce locally:

```bash
npm run test:e2e -- --trace on -g "name of the failing test"
npx playwright show-report
```

### A spec fails only on a re-run

Most likely leftover state — see [Housekeeping](#housekeeping).

---

## Housekeeping

### What each run leaves behind

The Playwright specs submit real projects and do not delete them. Cleanup would
need to read and delete across customers, which only a service-role key could
do — and introducing one purely to tidy test rows would put a
Row-Level-Security-bypassing credential into CI to solve a housekeeping problem.
That trade is not worth making, so the accumulation is deliberate and bounded:

| Spec                                            | Leaves behind                       |
| ----------------------------------------------- | ----------------------------------- |
| Customer A — briefs, uploads, consents, submits | 1 submitted project (A)             |
| Customer A — consent gate                       | 1 **draft** (A), reclaimed next run |
| Customer B — creates their own project          | 1 submitted project (B)             |
| Customer B — cannot open A's project            | 1 submitted project (A)             |
| Admin — status transition                       | **nothing** — it reuses the queue   |

So roughly **three submitted projects per full run**, each with one small
reference image, plus one draft that the next run picks up again rather than
duplicating.

Two things keep that from growing faster than it needs to:

- The admin spec **reuses** an existing project awaiting review instead of
  submitting its own. It used to create one, and because Playwright retries
  failed tests in CI, a single failing run left three projects behind
  (`AVS-000006`, `-000007`, `-000008`). Retries now act on the same row.
- `/create` resumes the most recent draft, so a spec that stops mid-flow
  contributes one draft in total, not one per run.

`scripts/verify-live.ts` is separate: it creates its own projects and storage
objects and deletes them again before it exits.

### Clearing it down

An abandoned **draft** can make a later run behave differently, because
reopening `/create` resumes the most recent draft.

Clear the test principals' data between runs when you want a clean slate:

```sql
-- Deletes every project belonging to the three test accounts.
-- Assets, consents and status history cascade. NON-PRODUCTION ONLY.
delete from public.projects
where user_id in (
  select id from auth.users
  where email in (
    'avs-customer-a@example.test',
    'avs-customer-b@example.test',
    'avs-admin@example.test'
  )
);
```

Storage objects do **not** cascade — `storage.objects` has no foreign key into
`public.projects`. After the delete above, sweep the orphans:

```sql
-- Inspect first. Covers both buckets.
select o.bucket_id, o.name, o.created_at, o.metadata->>'size' as bytes
from storage.objects o
left join public.project_assets a
  on a.storage_bucket = o.bucket_id and a.storage_path = o.name
where o.bucket_id in ('reference-images', 'project-deliveries')
  and a.id is null
order by o.created_at;
```

Revisions and approvals cascade away with their project, so the delete above
clears them too — there is no separate cleanup for either.

Delete them from **Storage** in the dashboard once you are satisfied the list is
only test data. (See `docs/architecture.md` §6 for why orphans exist and how the
application self-heals the common case.)

---

## Security notes

**Playwright traces are switched off in CI.** A trace records request bodies,
and sign-in is a Server Action — so the POST body carries the test account's
password in the clear. Uploading a trace would place those passwords in an
artifact downloadable by anyone with repository read access. Screenshots are
kept instead: password inputs render as dots. The cost is that remote debugging
is slightly harder; the alternative is publishing credentials.

**The report artifact is still sensitive.** It contains screenshots of
signed-in pages, including test account email addresses and brief content.
Retention is capped at 7 days and upload only happens on failure.

**Nothing echoes a secret.** The preflight reports missing _names_ only — not
values, not lengths, not prefixes, any of which would leak information. GitHub
also masks registered secret values in logs automatically, but this workflow
does not rely on that alone.

**Caller input is treated as data.** The `reason` input is passed to the summary
step through the environment rather than interpolated into the shell, so a
crafted value cannot execute.

**Least privilege.** The workflow declares `permissions: contents: read`. It
cannot push, comment, or alter the repository.

**No migrations, no schema changes.** The workflow never writes to the database
schema. If a migration has not been applied, the suites fail — which is the
correct outcome, and far better than a test run silently mutating a project.

---

## Notifications

`verify:live` checks notification **access** only: that a customer cannot read
the outbox, enqueue a notification, drain the queue, mark one sent, or requeue
one. Those probes need no email configuration and send nothing.

**It deliberately sends no email.** Verification runs on every change and can run
on a schedule; a security suite that mails real people each time it runs is a
suite people turn off, and it would spend provider quota proving something that
does not change between runs.

Proving that Resend actually delivers is a separate, deliberate act: submit a
project in a non-production environment and watch `/admin/notifications` — "Sent
(24h)" climbing is the confirmation. If you want a repeatable integration check,
keep it opt-in behind its own environment variable and its own command, so no
ordinary CI run triggers it.

The notification worker endpoint is not exercised here at all. It requires
`CRON_SECRET` and the worker's database credential, neither of which belongs in
a verification run whose whole purpose is to prove that ordinary sessions are
constrained. See [`notifications.md`](notifications.md).
