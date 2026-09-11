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

| Variable                        | Where       | Required | Purpose                                                     |
| ------------------------------- | ----------- | -------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | client      | yes      | Supabase project URL                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client      | yes      | Publishable key; every request still goes through RLS       |
| `NEXT_PUBLIC_SITE_URL`          | client      | yes      | Absolute origin, used to build auth redirect URLs           |
| `SUPABASE_SERVICE_ROLE_KEY`     | server only | no       | Bypasses RLS. Unused by the MVP; kept as an extension point |
| `E2E_USER_EMAIL`                | test only   | no       | Enables the authenticated Playwright specs                  |
| `E2E_USER_PASSWORD`             | test only   | no       | Enables the authenticated Playwright specs                  |

The service-role key **must never** be given a `NEXT_PUBLIC_` prefix. It is read
in exactly one file, `lib/supabase/admin.ts`, which is marked `server-only` and
is additionally blocked from client modules by an ESLint rule.

The public marketing pages render without any Supabase configuration at all, so
`npm run build` and the public E2E specs work on a fresh clone.

---

## Supabase setup

### 1. Create the project

Create a Supabase project and copy the project URL and the publishable (anon) key
from **Project Settings → API** into `.env.local`.

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

Migration 4 is idempotent and safe to re-run. Migrations 1–3 are not.

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

| Command                    | What it does                                  |
| -------------------------- | --------------------------------------------- |
| `npm run dev`              | Development server                            |
| `npm run build`            | Production build                              |
| `npm run start`            | Serve a production build                      |
| `npm run lint`             | ESLint over the whole repository              |
| `npm run typecheck`        | `tsc --noEmit`                                |
| `npm test`                 | Vitest unit and component tests, once         |
| `npm run test:watch`       | Vitest in watch mode                          |
| `npm run test:e2e`         | Playwright end-to-end tests                   |
| `npm run test:e2e:install` | Install the Chromium build Playwright expects |
| `npm run format`           | Prettier, writing changes                     |
| `npm run format:check`     | Prettier, checking only                       |

---

## Testing

### Unit and component tests (Vitest)

```bash
npm test
```

Cover the parts where a mistake has consequences: storage path generation and
filename sanitisation, auth redirect safety, the brief/upload/consent schemas,
the admin status-transition table, and the consent gate on the review step
rendered through the real UI.

Most run in Node. Component tests opt into jsdom with a
`@vitest-environment jsdom` docblock.

### End-to-end tests (Playwright)

```bash
npm run test:e2e:install   # first time only
npm run test:e2e
```

The suite builds the app and serves it, so no dev server is needed.

- `e2e/public-journey.spec.ts` and `e2e/auth-protection.spec.ts` need **no**
  Supabase credentials. They cover the homepage, navigation into Create My Video,
  the portfolio and its filters, pricing being marked provisional, mobile layout,
  and unauthenticated visitors being redirected away from `/dashboard` and
  `/admin`.
- `e2e/authenticated-journey.spec.ts` covers sign-in, creating a project
  end to end, viewing your own project, and being refused a project that is not
  yours. It **skips with a printed reason** unless `E2E_USER_EMAIL` and
  `E2E_USER_PASSWORD` are set against a Supabase project with the migrations
  applied and a confirmed user.

If your environment ships a pinned Chromium rather than one Playwright
downloaded, point at it:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e
```

### Verifying Row Level Security

`docs/rls-verification.sql` contains runnable queries that assert the critical
cases directly against the database — cross-customer reads, privilege
escalation, and consent tampering. Run it in the SQL Editor after applying the
migrations. See [`docs/database.md`](docs/database.md).

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
- `SUPABASE_SERVICE_ROLE_KEY`, if set at all, must be a plain (non-public)
  environment variable.

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
lib/supabase/         browser / server / proxy / public / service-role clients
lib/validation/       Zod schemas — the server-side authority
lib/storage/          upload policy, generated object paths
lib/data/             read-side data access
lib/auth/             session and role helpers
lib/catalog/          experience, category and (placeholder) pricing catalogues
lib/consent/          versioned consent wording
lib/projects/         status metadata and transition rules
types/database.ts     typed mirror of the migrations
supabase/migrations/  schema, RLS, storage, seed
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
  policy and, independently, by a database trigger.
- **Admin routes are gated server-side** in the layout, not by hiding a link.

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
  magic bytes. See `docs/architecture.md` for why, and what would harden it.
