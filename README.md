# AI Video Studio

Bespoke cinematic AI-generated video, commissioned from photographs the customer
already has.

This repository is the technical foundation and first MVP: a premium public site,
accounts, a multi-step creative brief with private reference-image upload,
explicit consent capture, a customer dashboard, and a minimal admin queue.

**The MVP does not generate video, take payment or send email.** Those are
deliberate omissions with clean extension points, not oversights — see
[Known limitations](#known-limitations).

---

## Contents

- [Stack](#stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Local development](#local-development)
- [Commands](#commands)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Security model in brief](#security-model-in-brief)
- [Known limitations](#known-limitations)

---

## Stack

| Concern         | Choice                                       |
| --------------- | -------------------------------------------- |
| Framework       | Next.js 16 (App Router, Turbopack)           |
| UI              | React 19, Tailwind CSS 4, shadcn/ui patterns |
| Language        | TypeScript 5.9, `strict` mode                |
| Database        | Supabase Postgres, Row Level Security        |
| Auth            | Supabase Auth (`@supabase/ssr`)              |
| Storage         | Supabase Storage, private buckets            |
| Validation      | Zod 4 (server) + React Hook Form (client)    |
| Unit tests      | Vitest 5                                     |
| E2E tests       | Playwright                                   |
| Lint / format   | ESLint 9 (`eslint-config-next`), Prettier    |
| Deployment      | Vercel                                       |
| Package manager | npm                                          |

Full reasoning: [`docs/architecture.md`](docs/architecture.md).

---

## Prerequisites

- **Node.js 20.9+** (22 LTS recommended) and npm 10+
- A **Supabase** project (free tier is enough)
- Optionally the [Supabase CLI](https://supabase.com/docs/guides/cli) for
  applying migrations from the command line

---

## Installation

```bash
git clone <this-repository>
cd ai-video-studio
npm install
cp .env.example .env.local   # then fill it in — see below
```

---

## Environment variables

Copy `.env.example` to `.env.local`. **Never commit `.env.local`, and never put a
real key in `.env.example`.**

| Variable                               | Where     | Required | Purpose                                               |
| -------------------------------------- | --------- | -------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | client    | yes      | Supabase project URL                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client    | yes      | Publishable key; every request still goes through RLS |
| `NEXT_PUBLIC_SITE_URL`                 | client    | yes      | Absolute origin, used to build auth redirect URLs     |
| `E2E_CUSTOMER_A_EMAIL` / `_PASSWORD`   | test only | no       | Enables the authenticated Playwright specs            |
| `E2E_CUSTOMER_B_EMAIL` / `_PASSWORD`   | test only | no       | Enables the cross-customer isolation specs            |
| `E2E_ADMIN_EMAIL` / `_PASSWORD`        | test only | no       | Enables the admin specs                               |

### There is no secret key

This application **never uses a Supabase secret key** (`sb_secret_...`, formerly
the `service_role` key). Nothing in it needs to bypass Row Level Security:
customer requests run as the customer and admin requests run as the admin, so
RLS applies to every query the application makes. There is therefore no elevated
credential to leak, misconfigure, or accidentally prefix with `NEXT_PUBLIC_`.

If a future milestone genuinely needs one — a scheduled job or a webhook with no
user session — add it as a server-only variable read from a single `server-only`
module. See `docs/architecture.md` §11.

### A note on key naming

Supabase renamed its public key. On a current project the value is labelled
**publishable** and looks like `sb_publishable_...`; on an older project the
equivalent is the key labelled `anon` `public`, a long JWT beginning `eyJ...`.
Either works here and both behave identically — they are public by design and
constrained by RLS. The variable is named for the current model.

The public marketing pages render without any Supabase configuration at all, so
`npm run build` and the public E2E specs work on a fresh clone.

---

## Supabase setup

### 1. Create the project

Create a Supabase project, then from **Project Settings → API Keys** copy the
project URL and the **publishable** key into `.env.local`. (On an older project
that key is labelled `anon` `public` — see the note above.)

### 2. Apply the migrations

Migrations live in `supabase/migrations/` and must be applied **in filename
order**. They are the source of truth for schema, RLS and storage policies.

**With the Supabase CLI (recommended):**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Or by hand:** open the SQL Editor in the Supabase dashboard and run each file
in order:

1. `20260101000000_initial_schema.sql` — enums, tables, triggers, helper functions
2. `20260101000100_row_level_security.sql` — RLS enabled, explicit policies
3. `20260101000200_storage.sql` — private buckets and their storage policies
4. `20260101000300_seed_reference_data.sql` — experience catalogue and placeholder portfolio
5. `20260101000400_status_transition_guard.sql` — database-level workflow enforcement

Migrations 3 and 4 are idempotent and safe to re-run. 1, 2 and 5 are not.

To confirm they still apply cleanly from scratch before you touch a real project:

```bash
npm run verify:db
```

### 3. Configure Auth

In **Authentication → Providers**, keep **Email** enabled. Email confirmation may
be on or off — the sign-up action handles both.

In **Authentication → URL Configuration** set:

- **Site URL** — `http://localhost:3000` locally, your production origin in prod
- **Redirect URLs** — add both:
  - `http://localhost:3000/auth/confirm`
  - `http://localhost:3000/auth/callback`

  and the same two paths on every deployed origin (production and preview).

### 4. Verify the buckets

Migration 3 creates `reference-images` and `project-deliveries`. Confirm in
**Storage** that **both show as Private**. If either is public, stop and fix it
before uploading anything: customer photographs must never have a public URL.

### 5. Make yourself an admin

Roles cannot be self-granted — that is enforced by an RLS policy _and_ a database
trigger. Promote an account from the SQL Editor (which runs as `postgres`):

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

### 6. Create the test principals (optional, for the live suites)

The authenticated Playwright specs and `npm run verify:live` need three
confirmed accounts on a **non-production** project. Sign each one up through
`/signup`, confirm the email if confirmation is enabled, then promote the third:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'avs-admin@example.test');
```

Put the six credentials in `.env.local` (`E2E_CUSTOMER_A_*`, `E2E_CUSTOMER_B_*`,
`E2E_ADMIN_*`). Never commit them, and never use personal logins.

---

## Local development

```bash
npm run dev
```

Then open <http://localhost:3000>.

Typical first run-through: `/` → `/portfolio` → **Create My Video** → choose an
experience → write a brief → sign up → upload a reference image → consent →
**Submit Project** → land on the project page in your dashboard.

---

## Commands

| Command                    | What it does                                      |
| -------------------------- | ------------------------------------------------- |
| `npm run dev`              | Development server                                |
| `npm run build`            | Production build                                  |
| `npm run start`            | Serve a production build                          |
| `npm run lint`             | ESLint over the whole repository                  |
| `npm run typecheck`        | `tsc --noEmit`                                    |
| `npm test`                 | Vitest unit and component tests, once             |
| `npm run test:watch`       | Vitest in watch mode                              |
| `npm run test:e2e`         | Playwright end-to-end tests                       |
| `npm run test:e2e:install` | Install the Chromium build Playwright expects     |
| `npm run format`           | Prettier, writing changes                         |
| `npm run format:check`     | Prettier, checking only                           |
| `npm run verify:db`        | Database security suite on a throwaway Postgres   |
| `npm run verify:live`      | Auth / API / Storage suite against a live project |

---

## Testing

Four suites, each proving something the others cannot.

### 1. Unit and component tests — `npm test`

Pure logic and one component: storage path generation and filename sanitisation,
auth redirect safety, the brief/upload/consent schemas, the admin transition
table, draft persistence, and the consent gate rendered through the real UI.
No database, no network.

### 2. Database security suite — `npm run verify:db`

Applies `supabase/migrations/` to a **clean throwaway PostgreSQL cluster**, then
runs an adversarial matrix as real `anon` / `authenticated` roles with a JWT
claim set — which is exactly how PostgREST presents a request to Postgres.

It covers schema assertions, the cross-customer attack matrix, privilege
escalation, immutability, the status-history trigger, the workflow guard, and
the storage policy predicates. Because it starts from an empty database, it also
proves the migrations still apply cleanly from scratch.

`supabase/tests/harness/` contains a small stand-in for the objects Supabase
manages (the `auth` and `storage` schemas, the API roles, and — importantly —
the table GRANTs Supabase issues, without which every statement would fail with
"permission denied" and appear to pass while testing nothing). `attempt()`
additionally refuses to run as a `BYPASSRLS` role for the same reason.

Requires PostgreSQL 16 server binaries (`initdb`, `pg_ctl`, `psql`).

### 3. Live verification — `npm run verify:live`

Everything the local suite cannot reach, against a real project: Supabase Auth
sign-in, the policies over the real PostgREST HTTP API with a real JWT, and the
Storage API — signed upload URLs, signed read URLs, MIME and size enforcement,
and whether one customer can reach another's object.

Point it at a non-production project; it creates and deletes data. Needs the six
`E2E_*` credentials.

### 4. End-to-end tests — `npm run test:e2e`

```bash
npm run test:e2e:install   # first time only
npm run test:e2e
```

Builds the app and serves it, so no dev server is needed.

- `public-journey`, `auth-protection` and `draft-persistence` need **no**
  Supabase credentials. They cover the homepage, navigation into Create My Video,
  the portfolio and its filters, provisional pricing, mobile layout,
  unauthenticated redirects away from `/dashboard` and `/admin`, and the brief
  surviving the sign-up detour into a new tab.
- `authenticated-journey` covers Customer A's full journey, Customer B's
  isolation from it, and the admin queue and status transitions. These **skip
  with a printed reason** unless the `E2E_*` credentials are set.

If your environment ships a pinned Chromium rather than one Playwright
downloaded, point at it:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e
```

### Verifying RLS by hand

`docs/rls-verification.sql` contains the same critical assertions as a single
script you can paste into the Supabase SQL Editor against a live project. See
[`docs/database.md`](docs/database.md).

---

## Deployment

Target platform is **Vercel**.

1. Import the repository. The framework preset is detected automatically; no
   build overrides are needed.
2. Add the environment variables above to **Production** _and_ **Preview**.
   `NEXT_PUBLIC_SITE_URL` must be the origin of that deployment.
3. Add each deployment origin's `/auth/confirm` and `/auth/callback` to the
   Supabase **Redirect URLs** list.
4. Apply migrations to the production Supabase project before the first deploy.

Notes:

- Reference images are uploaded **directly from the browser to Supabase Storage**
  using a server-issued signed upload URL. They never pass through a Vercel
  function, so Vercel's 4.5 MB request-body limit does not apply.
- There is no secret key to configure. Every variable this application reads is
  a `NEXT_PUBLIC_` one, because nothing it does bypasses Row Level Security.

---

## Project structure

```
app/
  (marketing)/        public pages: /, /portfolio, /how-it-works, /pricing
  (auth)/             /login, /signup, /forgot-password, /reset-password
  (app)/              /create, /dashboard, /admin  (site chrome + auth)
  auth/               route handlers: /auth/callback, /auth/confirm, /auth/sign-out
components/ui/        shadcn-style primitives (button, input, field, checkbox…)
components/site/      header, footer, container, wordmark
features/             feature slices: auth, create-project, dashboard, admin, portfolio
lib/supabase/         browser / server / proxy / public clients (publishable key only)
lib/validation/       Zod schemas — the server-side authority
lib/storage/          upload policy, generated object paths
lib/data/             read-side data access
lib/auth/             session and role helpers
lib/catalog/          experience, category and (placeholder) pricing catalogues
lib/consent/          versioned consent wording
lib/projects/         status metadata and transition rules
types/database.ts     typed mirror of the migrations
supabase/migrations/  schema, RLS, storage, seed, workflow guard
supabase/tests/       database security suite + local Supabase harness
scripts/verify-live.ts  auth / API / storage verification against a live project
tests/                Vitest
e2e/                  Playwright
docs/                 architecture, database, RLS verification
proxy.ts              session refresh + route gating (Next 16 proxy convention)
```

Business logic does not live in page components. Pages compose; `lib/` and
`features/*/actions.ts` do the work.

---

## Security model in brief

The full model is in [`docs/architecture.md`](docs/architecture.md). The short
version:

- **Ownership is derived from the session, never from the request.** No server
  action accepts a `user_id`, and no validation schema has a field for one.
- **Row Level Security is on for every customer-facing table**, with explicit
  per-operation policies. There is no blanket `using (true)` anywhere.
- **A customer cannot read another customer's project, assets or consent**, and
  that is enforced in the database, not only in application code. Changing the id
  in a `/dashboard/projects/[id]` URL returns 404.
- **Reference photographs live in a private bucket** and are shown only through
  short-lived signed URLs generated per request. There is no public URL for them.
- **Uploaded media is untrusted.** MIME type and size are checked before an
  upload slot is issued and re-checked against Storage's own metadata afterwards;
  anything that fails is deleted rather than orphaned.
- **Object names are generated, never taken from the upload.** The uploaded
  filename is sanitised and kept for support only.
- **A customer cannot grant themselves the admin role** — blocked by an RLS
  policy and, independently, by a database trigger. Not even an admin can grant
  a role through the API; promotion is a deliberate, out-of-band SQL action.
- **Admin routes are gated server-side** in the layout, not by hiding a link.
- **The production workflow is enforced by the database**, not only by the
  buttons the admin UI renders: a trigger rejects any status transition outside
  the documented table, so no one can drive a project straight from `SUBMITTED`
  to `COMPLETED`.
- **There is no secret Supabase key** anywhere in the application.

All of the above is asserted mechanically, not just described — see
[Testing](#testing).

---

## Known limitations

Deliberate, and documented so nobody mistakes them for finished work:

- No AI video generation. No provider is integrated or referenced.
- No payments. `/pricing` is clearly marked placeholder content.
- No transactional email beyond Supabase Auth's own messages.
- No preview or final delivery yet. The schema (`asset_type`, the
  `project-deliveries` bucket) is shaped for it; nothing writes to it.
- No revision request workflow. `REVISION_REQUESTED` exists as a status only.
- The admin area is intentionally minimal: queue, project detail, status changes.
- `types/database.ts` is hand-maintained. Once a project is linked, regenerate it
  with `npx supabase gen types typescript --linked > types/database.ts`.
- Upload content type is verified against Storage metadata, not by inspecting
  magic bytes. See `docs/architecture.md` §12 for why, and what would harden it.
- A brief written before signing up is kept in `localStorage`, so it survives a
  new tab but not a different device. See `docs/architecture.md` §7.
- Orphaned storage objects are reconciled when a draft is reopened; objects left
  by a deleted draft need the periodic sweep in `docs/architecture.md` §7.
