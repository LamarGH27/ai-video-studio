# Architecture

How AI Video Studio is put together, and why. Schema detail lives in
[`database.md`](database.md); setup lives in the [README](../README.md).

---

## 1. Shape of the system

```
Browser
  │
  ├── Next.js App Router on Vercel
  │     ├── Server Components  ── read  ──┐
  │     ├── Server Actions     ── write ──┤   user-scoped Supabase client
  │     ├── Route Handlers     ── auth  ──┤   (publishable key + session cookie)
  │     └── proxy.ts           ── session refresh + route gating
  │                                        │
  └── direct upload (signed URL) ──────────┼──► Supabase Storage (private)
                                           │
                                           └──► Supabase Postgres
                                                  Row Level Security
```

There is no separate API tier. Every read runs in a Server Component and every
write runs in a Server Action, both through a request-scoped Supabase client
carrying the caller's session. That means **RLS applies to every query the
application makes**, and the database is the last word on who can see what.

The one exception to "everything goes through the app" is file upload, which goes
browser → Storage directly. That is explained in §6.

---

## 2. Frontend architecture

### Route groups

| Group         | Routes                                                     | Chrome          | Auth              |
| ------------- | ---------------------------------------------------------- | --------------- | ----------------- |
| `(marketing)` | `/`, `/portfolio`, `/how-it-works`, `/pricing`             | header + footer | none              |
| `(auth)`      | `/login`, `/signup`, `/forgot-password`, `/reset-password` | minimal         | none              |
| `(app)`       | `/create`, `/dashboard`, `/admin`                          | header + footer | mixed (see below) |
| `app/auth/*`  | route handlers                                             | —               | —                 |

`/create` is in `(app)` but is **public**. A visitor can choose an experience and
write a brief before they have an account; the sign-up prompt appears at step 3,
where private images need an owner to be stored against. `/dashboard` and
`/admin` require a session.

### Layering

Business logic is kept out of page components:

- `app/**/page.tsx` — composition, layout, data hand-off. Nothing else.
- `features/<slice>/` — feature UI plus its server actions.
- `lib/data/` — read-side queries.
- `lib/validation/` — Zod schemas, the server-side authority.
- `lib/storage/`, `lib/consent/`, `lib/projects/`, `lib/catalog/` — domain rules
  with no I/O, which is why they are the easiest part of the system to test.
- `components/ui/` — presentational primitives with no knowledge of the domain.

### Rendering strategy

| Route                                 | Mode                     | Why                                  |
| ------------------------------------- | ------------------------ | ------------------------------------ |
| `/`                                   | static, `revalidate 300` | marketing content, no session needed |
| `/how-it-works`, `/pricing`           | static                   | fully static content                 |
| `/portfolio`                          | dynamic (searchParams)   | category filter is a real URL        |
| `/create`, `/dashboard/*`, `/admin/*` | `force-dynamic`          | per-user, must never be cached       |

Public reads use `lib/supabase/public.ts` — a sessionless publishable-key client
that does not touch cookies, so marketing pages can stay static. It sees exactly what an
anonymous visitor sees under RLS.

### Design

A dark cinematic surface: near-black grounds, a bone foreground, one brass accent.
Tokens are defined once in `app/globals.css` with Tailwind 4's `@theme`.
Animation is limited to a short entrance on the hero and is fully disabled under
`prefers-reduced-motion`.

### Accessibility

Semantic landmarks and a skip link; every control labelled; errors wired to their
control with `aria-describedby` + `aria-invalid` and announced via `role="alert"`
(`components/ui/field.tsx`); visible focus rings that are never removed; wizard
step changes move focus to the step heading; the portfolio filter is a list of
links that works without JavaScript, as does sign-out. Loading, empty and error
states exist for every asynchronous surface.

---

## 3. Authentication

Supabase Auth with `@supabase/ssr`, following the current recommended
architecture. Four clients, one per trust boundary:

| File                         | Runs where             | Key         | Notes                                   |
| ---------------------------- | ---------------------- | ----------- | --------------------------------------- |
| `lib/supabase/client.ts`     | browser                | publishable | RLS applies                             |
| `lib/supabase/server.ts`     | RSC / actions / routes | publishable | reads session from cookies; RLS applies |
| `lib/supabase/middleware.ts` | proxy                  | publishable | refreshes the session cookie            |
| `lib/supabase/public.ts`     | server, sessionless    | publishable | public reads only, keeps pages static   |

**There is no fifth client.** This application holds no Supabase secret key
(`sb_secret_...`, formerly `service_role`). Every client above uses the
publishable key, so Row Level Security constrains every query the application
makes — including the admin ones. An earlier draft of this codebase carried a
service-role client "as an extension point"; it was removed, because an unused
credential is all risk and no benefit. §11 says where to reintroduce one if a
future milestone genuinely needs it.

Rules that are enforced, not just intended:

- **`getUser()`, never `getSession()`.** `getUser()` revalidates the JWT with the
  Auth server; `getSession()` trusts the cookie's contents.
- **Session refresh happens in `proxy.ts`.** Server Components cannot write
  cookies, so refresh has to happen there or sessions silently expire.
- **No code path bypasses RLS.** Admin reads and writes run as the signed-in
  admin, which is what makes `project_status_history.changed_by` meaningful.

### Flows

- **Sign up** — `signUpAction` → `auth.signUp` with `display_name` metadata and
  `emailRedirectTo=/auth/confirm`. A trigger on `auth.users` creates the profile.
  Handles both "email confirmation on" and "off" project settings.
- **Sign in** — `signInAction` → `signInWithPassword`, then redirect to a
  validated `next`.
- **Password reset** — `/forgot-password` → `resetPasswordForEmail` →
  `/auth/confirm?next=/reset-password` → `updateUser`.
- **Email links** — `/auth/confirm` verifies `token_hash` + `type` server-side, so
  the token never reaches client JavaScript or a URL fragment.
- **PKCE** — `/auth/callback` exchanges `?code=` for a session.
- **Sign out** — `POST /auth/sign-out` only. A GET would let a third-party page
  log the user out with an `<img>` tag.

**Open redirects.** Every `next` parameter passes through `safeRedirectPath()`,
which accepts only same-origin, path-only destinations — rejecting `https://…`,
`//host`, `/\host` and anything not starting with `/`. This is unit-tested.

**Enumeration.** Sign-in failures always say "That email or password is
incorrect." Password reset always says "If that address has an account, a reset
link is on its way." Neither reveals whether an account exists.

---

## 4. Database

Seven tables, all in `public`, all RLS-enabled. Full column and policy detail is
in [`database.md`](database.md).

```
auth.users ──1:1── profiles ──1:N── projects ──1:N── project_assets
                                        │                (REFERENCE_IMAGE now;
                                        │                 PREVIEW_VIDEO / FINAL_VIDEO later)
                                        ├──1:N── project_consents
                                        ├──1:N── project_status_history
                                        └──N:1── video_experiences ──1:N── portfolio_items
```

Decisions worth stating:

- **`public_reference` (`AVS-000123`) is separate from the primary key.** It comes
  from a sequence via a column default, so it is stable from the moment a draft is
  created and is never used as a foreign key. Customers quote it; nothing joins on it.
- **`projects.experience_id` is nullable** for a Custom Concept brief with no
  reusable template behind it.
- **`project_assets.user_id` is denormalised** so storage and RLS checks never
  need a join, and a trigger guarantees it always equals the parent project's
  owner. The same trigger protects `project_consents`.
- **Status history is written by a database trigger**, not by application code, so
  it cannot be skipped by a caller that forgets. `changed_by` is `auth.uid()`,
  which is why admin status changes run as the admin rather than as service role.
- **Consent wording is versioned.** `project_consents.wording_version` records the
  version in force when consent was given, so a copy edit can never rewrite what
  a customer actually agreed to. Superseded wording is kept in §9.
- **`projects.user_id` and `public_reference` are immutable** after insert,
  enforced by a trigger — a policy cannot reference `OLD`.
- **`portfolio_items` holds public marketing media only.** Customer uploads are
  never referenced from it.

---

## 5. RLS model

Every customer-facing table has RLS enabled with explicit, per-operation policies.
There is no blanket `using (true)` policy anywhere in the codebase.

The shape of every ownership policy is `user_id = (select auth.uid())`. The
`(select …)` wrapper lets Postgres evaluate the function once per statement
instead of once per row.

| Actor     | Can                                                                                                                                                                                                                                                   | Cannot                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| anonymous | read active `portfolio_items` and `video_experiences`                                                                                                                                                                                                 | see any customer data at all                                                                                                    |
| customer  | read own profile; update safe profile fields; create projects for themselves; read own projects; edit own **DRAFT** projects; add/remove reference images on own drafts; record and revise consent on own drafts; read own consent and status history | read or write anyone else's row; change their own `role`; edit a submitted project; write delivery assets; alter status history |
| admin     | read every profile, project, asset, consent and history row; move a project's status                                                                                                                                                                  | reassign a project's owner; change a role through the app                                                                       |

Three things are worth calling out:

1. **Editability is tied to status.** The customer UPDATE policy has
   `status = 'DRAFT'` in its `USING` clause and allows only `DRAFT → SUBMITTED` in
   `WITH CHECK`. Submitting is therefore also what makes the brief read-only.
   The admin transition table deliberately contains no path back to `DRAFT`.
2. **Privilege escalation is blocked twice.** The profile UPDATE policy pins
   `role` to its current value (read through a `SECURITY DEFINER` helper to avoid
   recursing into the same policy), _and_ a `BEFORE UPDATE` trigger raises unless
   the caller is a service-role client. Either alone would do; both is the point.
3. **`is_admin()` is `SECURITY DEFINER` with a pinned empty `search_path`,** so it
   can read `profiles.role` without tripping the policies defined in terms of it,
   and cannot be hijacked by a schema on the caller's search path. `EXECUTE` is
   revoked from `PUBLIC`. Every function in `public` pins its `search_path`, and
   the database suite asserts that none regresses.
4. **The workflow itself is enforced in the database.** RLS decides _who_ may
   change a status; `20260101000400_status_transition_guard.sql` decides _which_
   changes are legal. Without it, anyone holding the admin role could drive a
   project from `SUBMITTED` straight to `COMPLETED` through the API, skipping
   asset review and production — the transition table in
   `lib/projects/status.ts` only ever governed which buttons were rendered.

`FORCE ROW LEVEL SECURITY` is deliberately **not** set. The application never
connects as a table owner — it uses the `anon` / `authenticated` / `service_role`
PostgREST roles — and the integrity triggers are `SECURITY DEFINER` functions
that must be able to read the parent project row.

Runnable assertions for the critical cases: `docs/rls-verification.sql`.

---

## 6. Storage model

Two buckets, **both private**:

| Bucket               | Contents                       | Status                            |
| -------------------- | ------------------------------ | --------------------------------- |
| `reference-images`   | customer reference photographs | in use                            |
| `project-deliveries` | preview and final films        | created, nothing writes to it yet |

Object layout in both: `{user_id}/{project_id}/{generated_filename}`. The bucket
name is the `reference-images/` prefix from the brief.

**The path is a convention, not the security boundary.** Policies on
`storage.objects` compare `(storage.foldername(name))[1]` against
`auth.uid()::text`, so a customer can only read, write or delete inside their own
folder; admins get a separate read policy. Neither bucket grants anything to
`anon`.

### The upload path, and why it is shaped this way

```
browser                      server action                    Supabase Storage
   │  file chosen                  │                                 │
   │  local checks (type/size)     │                                 │
   ├── requestUploadSlotAction ───►│ verify session                  │
   │                               │ verify project owned + DRAFT    │
   │                               │ re-count images server-side     │
   │                               │ generate {uid}/{pid}/{uuid}.ext │
   │                               ├── createSignedUploadUrl ───────►│
   │◄──────── path + one-shot token│                                 │
   ├── uploadToSignedUrl ──────────┼────────────────────────────────►│
   ├── confirmUploadAction ───────►│ re-check path ownership         │
   │                               ├── info(path) ──────────────────►│
   │                               │ verify REAL size + content type │
   │                               │ insert project_assets row       │
   │                               │ (delete the object if it fails) │
```

Why direct-to-storage rather than through the app: a Vercel function's request
body is capped at 4.5 MB, well below a phone photograph. Routing uploads through
the app would either break on real files or force a lower limit than customers
expect.

Why that does not weaken anything:

- The client never chooses the path. The server generates it from the **session's**
  user id and a **verified** project id.
- The signed upload token is single-use and scoped to that one object.
- The storage INSERT policy applies at signing time _and_ at upload time.
- What the browser claims about the file at slot-request time is not what gets
  stored: `confirmUploadAction` reads the object's real size and content type back
  from Storage and rejects anything outside policy, deleting the object rather
  than leaving it orphaned.

### Orphaned objects

Because the browser uploads first and the server records second, an object can
outlive its bookkeeping. Two ways:

1. **The tab closes between the upload landing and `confirmUploadAction` running.**
   The object exists; no `project_assets` row points at it. (A _failed_
   confirmation is not one of these — that path deletes the object rather than
   leaving it orphaned.)
2. **A DRAFT project is deleted.** `project_assets` rows cascade away, but
   `storage.objects` has no foreign key into `public.projects`, so the bytes stay.

Case 1 is repaired at the natural moment: reopening a draft calls
`reconcileOrphanedReferenceImages()`, which lists that project's folder and
deletes anything with no asset row and older than a one-hour grace period. It
runs as the signed-in customer, so storage RLS confines it to their own folder,
and the grace period means an in-flight confirmation is never mistaken for an
orphan. No scheduler and no background worker.

Case 2 leaves nothing to reconcile against. Until there is a reason to build
more, sweep it periodically:

```sql
-- Reference-image objects no asset row points at. Inspect before deleting.
select o.name, o.created_at, o.metadata->>'size' as bytes
from storage.objects o
left join public.project_assets a
  on a.storage_bucket = o.bucket_id and a.storage_path = o.name
where o.bucket_id = 'reference-images'
  and a.id is null
  and o.created_at < now() - interval '24 hours'
order by o.created_at;
```

Run it from the SQL Editor, or schedule it with `pg_cron` once the volume
justifies it. A fuller design — an upload-intent row reconciled by a worker —
is only worth building if orphans turn out to be common, and this query is how
you would find that out.

### Displaying private media

Reference images are shown only through signed URLs minted per request with a
5-minute TTL (`SIGNED_URL_TTL_SECONDS`), generated as the signed-in user so
Storage RLS decides whether a URL is issued at all. `next/image` is deliberately
**not** used for them: it would proxy private media through the image optimiser
and cache it at the edge. Pages that render them are `force-dynamic`, so a signed
URL never outlives its TTL inside cached HTML.

### Upload policy

Configured in one place, `lib/storage/config.ts`, and enforced in three:

| Rule               | Value                                   |
| ------------------ | --------------------------------------- |
| Accepted types     | `image/jpeg`, `image/png`, `image/webp` |
| Max size per file  | 10 MB (bucket ceiling 15 MB)            |
| Images per project | 1–10                                    |

---

## 7. Customer workflow

```
/  →  /portfolio  →  Create My Video
      │
      ├─ 1. Experience      public, client state
      ├─ 2. Creative brief  public, client state, localStorage-backed
      │        └─ sign up / sign in if needed → draft project created (DRAFT)
      ├─ 3. Reference images  signed upload → private bucket
      └─ 4. Review + consent  → Submit Project → SUBMITTED
                                   └─► /dashboard/projects/{id}
```

Steps 1 and 2 are held in browser state and mirrored to `localStorage`
(`features/create-project/draft-storage.ts`) so the sign-up detour does not lose
the customer's work. Nothing sensitive goes in there: no identifiers, no tokens,
no image data. Entries are schema-versioned and expire after seven days.

**Why `localStorage` and not `sessionStorage`.** With email confirmation enabled
the journey is `/create → /signup → [email] → /auth/confirm?next=/create →
/create`, and that confirmation link is opened from a mail client — which opens a
**new tab**. `sessionStorage` is scoped to one tab, so a brief kept there is gone
at exactly the moment the customer has just committed to an account. This was a
real defect, caught in Milestone 1.5; `e2e/draft-persistence.spec.ts` reproduces
the new-tab journey and fails against the old implementation.

The limit: a customer who signs up on a laptop and confirms on their phone will
not find the brief on the phone. No browser-side store crosses devices, and the
alternative — persisting an anonymous visitor's creative input server-side,
owned by nobody and deletable by nobody — is worse. The brief is still waiting on
the original device.

Once authenticated, the brief is promoted to a DRAFT row immediately and the
browser copy is cleared: from that point the server is the only source of truth.

The draft project row is created when the customer leaves step 2, because uploads
need something to be filed against. A customer who abandons the flow and returns
later picks up the same draft rather than starting a second one.

Submission (`submitProjectAction`) writes consent rows **first**, then flips the
status. If the consent write fails, the project stays a DRAFT — there is never a
submitted project without a consent record.

**Statuses:**

```
DRAFT ─(customer)→ SUBMITTED → ASSETS_REVIEW → IN_PRODUCTION → PREVIEW_READY
                                                    ▲               │
                                                    │               ├─(customer)→ FINALISING → COMPLETED
                                                    └───────────────┴─(customer)→ REVISION_REQUESTED
```

`CANCELLED` is reachable from anything unfinished. MVP submissions start at
`SUBMITTED`.

---

## 7b. Delivery: preview, revision, final

Production is **manual**. An administrator produces the film outside this system
and uploads it here; nothing in this codebase generates anything.

### The loop

1. **Admin uploads a preview** while the project is `IN_PRODUCTION`. Recording
   the upload also moves the project to `PREVIEW_READY` — a preview nobody is
   told about is not a delivery.
2. **The customer decides.** Two buttons, and only these two:
   - **Approve Preview** → records an approval against that exact version and
     moves to `FINALISING`.
   - **Request Revision** → records the request and moves to
     `REVISION_REQUESTED`.
3. **Rework**, if asked for: `REVISION_REQUESTED → IN_PRODUCTION`, a new preview,
   back to `PREVIEW_READY`. A trigger marks the open revision `RESOLVED` at that
   moment — resolution is a consequence of delivering, not a button someone
   might forget.
4. **Final delivery**: the admin uploads the final while `FINALISING`, then
   confirms `COMPLETED` explicitly. Uploading the final does _not_ auto-complete;
   deciding a film is finished is a judgement, not a file transfer.

### Why the customer's two decisions are database functions

Each decision is two writes — a row, and a status change. Done as two round
trips from a server action, the first could succeed and the second fail, leaving
a revision against a project that is not in revision: a state no screen can
render and no workflow can leave.

So each is a single `SECURITY DEFINER` RPC. One call is one statement is one
transaction: both halves land or neither does. Being `SECURITY DEFINER` they
bypass RLS, which is precisely why each re-derives `auth.uid()` and re-checks
ownership and the expected status inside the database. Neither is a general
status setter — each reaches exactly one status, from exactly one status, for
the owner alone.

`FINALISING` and `REVISION_REQUESTED` are additionally reachable _only_ through
those functions. Each sets a transaction-local setting that the status trigger
requires; `SET LOCAL` lives only inside one transaction, and the only statements
in an RPC's transaction are its own, so a bare `UPDATE` over PostgREST — from an
admin or anyone else — can never have it set.

### Versioning

A new preview is a **new row and a new object**. `project_assets.version` is
assigned by a trigger (Preview 1, Preview 2, …), the object name carries both
the version and a uuid, and there is no UPDATE policy on `project_assets`. The
customer sees the latest by default with earlier cuts kept below; support can
still see what "the second one" actually was.

### Reaching the media

Delivery media is never embedded as a signed URL. Both the player and the
download link point at `/api/deliveries/{assetId}`, which on **every request**:

1. requires an authenticated caller;
2. validates the id is well formed;
3. loads the asset (RLS has already removed other customers' rows);
4. loads the parent project;
5. confirms the caller owns it, or is an administrator;
6. confirms the asset belongs to that project;
7. confirms the asset's owner matches the project's owner.

Only then does it mint a signed URL and 302 to it. Steps 3–4 already pass
through RLS, so 5–7 are a second independent lock. Every failure returns the
same 404, so the route cannot be used to probe for other customers' assets, and
the response carries `Cache-Control: private, no-store` because a signed URL is
a bearer credential.

`?download=1` asks Storage to set `Content-Disposition`, which is what makes
"Download Final Video" a download rather than a navigation.

The bytes never pass through the function — it redirects — so a large video does
not touch the serverless request path in either direction.

### Size limit

`MAX_DELIVERY_VIDEO_MB` (`lib/storage/config.ts`) defaults to **50 MB** and is
overridable with `NEXT_PUBLIC_MAX_DELIVERY_VIDEO_MB`. 50 is not an arbitrary
commercial figure: it is Supabase's own default per-project upload limit, so a
larger default would produce uploads that fail at the storage layer for reasons
invisible in this codebase. To raise it, raise the project's global limit first,
then set the variable to match. The bucket's own 1 GiB limit is the backstop
above both.

---

## 8. Consent

Three consents, defined once in `lib/consent/definitions.ts` and rendered from
that definition so the stored record and the displayed text cannot drift:

| Type                      | Required | Default   |
| ------------------------- | -------- | --------- |
| `HAS_LIKENESS_PERMISSION` | yes      | false     |
| `AI_PROCESSING_CONSENT`   | yes      | false     |
| `PORTFOLIO_PERMISSION`    | **no**   | **false** |

The two required consents are `z.literal(true)` server-side: an unticked box is a
schema failure, not a falsy value that slips through. Portfolio permission is
never pre-selected — that is unit-tested _and_ asserted through the rendered UI.

`granted_at` is set only when granted, enforced by a `CHECK` constraint.
`wording_version` records the version in force at the time.

This service is for **consenting adults only**. There is deliberately no field,
workflow or code path anywhere in this repository for media of a minor.

---

## 9. Consent wording history

| Version      | Status  | Notes            |
| ------------ | ------- | ---------------- |
| `2026-01-01` | current | Initial wording. |

When wording changes in substance: add the new version here, mark the previous
one superseded with its exact text, and bump `CONSENT_WORDING_VERSION`. Existing
rows keep their old version and remain accurate.

---

## 10. Admin model

Deliberately minimal for the MVP: a production queue, a project detail view with
the brief, authorised reference images and consent record, and status changes.

Access control:

1. `proxy.ts` requires a session for `/admin/*`.
2. `app/(app)/admin/layout.tsx` calls `requireAdmin()`, which reads
   `profiles.role` **from the database**. Every `/admin` route renders inside this
   layout, so the check runs before any admin page does.
3. RLS grants the wider read through `is_admin()`.

A non-admin is **redirected**, not shown a 403 — they learn nothing about what is
there. Hiding the nav link is presentation and is not relied on anywhere.

Admin status changes run as the signed-in admin, not with the service-role key.
That keeps RLS in play and makes `project_status_history.changed_by` correct.
Transitions are restricted by `ALLOWED_ADMIN_TRANSITIONS` in
`lib/projects/status.ts`, checked in the UI and again server-side.

Roles are granted out-of-band, in the Supabase SQL Editor. There is no route,
action or form anywhere in this application that writes `profiles.role`.

---

## 11. Future integrations, and where they plug in

Nothing below is built. These are the seams that exist so it can be.

| Later               | Seam                                                                                                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video generation    | Status moves past `IN_PRODUCTION`; a worker reads the project and its reference assets                                                                                                                                                                                                         |
| Preview delivery    | `asset_type = 'PREVIEW_VIDEO'` into `project-deliveries`; customer read policy exists                                                                                                                                                                                                          |
| Final delivery      | `asset_type = 'FINAL_VIDEO'`, same path                                                                                                                                                                                                                                                        |
| Revision requests   | `REVISION_REQUESTED` status exists; needs a customer-facing notes table and action                                                                                                                                                                                                             |
| Payments            | A `project_payments` table keyed on `projects.id`; gate the `SUBMITTED` transition                                                                                                                                                                                                             |
| Transactional email | Triggered from status transitions, which are already recorded centrally                                                                                                                                                                                                                        |
| Real portfolio      | Populate `portfolio_items.media_url`; `PortfolioFrame` swaps for the real element                                                                                                                                                                                                              |
| Background jobs     | No secret key exists today. If one becomes necessary, add it as a server-only variable read from exactly one `server-only` module, re-add the ESLint `no-restricted-imports` guard against client imports, and authorise explicitly inside it — there is no RLS safety net behind a secret key |
| Orphan sweep        | The query in §6, scheduled with `pg_cron`, once volume justifies it                                                                                                                                                                                                                            |

---

## 11b. How the security model is verified

Claims in this document are asserted mechanically wherever that is possible.

| Layer                                      | Proven by                           | Needs a live project? |
| ------------------------------------------ | ----------------------------------- | --------------------- |
| Pure logic (paths, schemas, transitions)   | `npm test`                          | no                    |
| Schema, RLS, triggers, storage policies    | `npm run verify:db`                 | no                    |
| Sign-up detour and draft persistence       | `npm run test:e2e`                  | no                    |
| Supabase Auth, PostgREST HTTP, Storage API | `npm run verify:live`               | **yes**               |
| Full customer + admin journeys             | `npm run test:e2e` with `E2E_*` set | **yes**               |

The two rows that need a live project are run from CI by
`.github/workflows/live-supabase-verification.yml` — manual trigger only, no
migrations, secrets supplied by GitHub. Setup and how to read the results:
[`live-verification.md`](live-verification.md).

`npm run verify:db` applies the migrations to a clean throwaway PostgreSQL
cluster and attacks it as real `anon` / `authenticated` roles carrying a JWT
claim set — the same way PostgREST presents a request. It stands in for
everything below the API boundary, and nothing above it. What it cannot reach —
Auth, PostgREST itself, and the Storage service that issues signed URLs and
enforces MIME and size limits — is exactly what `npm run verify:live` covers.

Two guards exist because a security suite that passes for the wrong reason is
worse than none: the harness replicates the table GRANTs Supabase issues (so a
denial is RLS and not a missing grant), and `avs_test.attempt()` refuses to run
as a `BYPASSRLS` role at all.

---

## 12. Decisions taken where the brief left room

| Decision                                  | Choice                                           | Why                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/create` public or gated?                | Public through step 2                            | The brief says "prompted to sign up/login **if necessary**". Necessity begins at private uploads.                                                                                                                                                                                                                                                     |
| When is the draft project created?        | Leaving step 2                                   | Uploads need a `project_id`. Anything else means holding files in limbo.                                                                                                                                                                                                                                                                              |
| When is `public_reference` allocated?     | At insert, via a column default                  | Stable from the first save; a sequence default cannot race.                                                                                                                                                                                                                                                                                           |
| Upload route                              | Browser → Storage via signed URL                 | Vercel caps function bodies at 4.5 MB. The server still owns the path and the verification.                                                                                                                                                                                                                                                           |
| Do admin writes use the service-role key? | No                                               | Running as the admin keeps RLS in play and makes `changed_by` correct.                                                                                                                                                                                                                                                                                |
| Is `custom-concept` a row or a null?      | A seeded row; `experience_id` is nullable anyway | Keeps the catalogue uniform; the nullable column honours the brief.                                                                                                                                                                                                                                                                                   |
| Content-type verification                 | Storage metadata, not magic bytes                | Sniffing means downloading each object into a function. The bucket's `allowed_mime_types`, the generated extension and the private-bucket-plus-signed-URL model mean a mislabelled file cannot be served as active content. Magic-byte checks are a worthwhile hardening step when a processing worker exists — it will already be reading the bytes. |
| Portfolio placeholder media               | Designed duotone frames, no stock imagery        | Stock footage would misrepresent work that does not exist yet.                                                                                                                                                                                                                                                                                        |
| `types/database.ts`                       | Hand-maintained for now                          | There is no linked project to generate from. Regenerate with the CLI once there is.                                                                                                                                                                                                                                                                   |
