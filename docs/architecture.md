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
  │     ├── Route Handlers     ── auth  ──┤   (anon key + session cookie)
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

Public reads use `lib/supabase/public.ts` — a sessionless anon client that does
not touch cookies, so marketing pages can stay static. It sees exactly what an
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

| File                         | Runs where             | Key          | Notes                                   |
| ---------------------------- | ---------------------- | ------------ | --------------------------------------- |
| `lib/supabase/client.ts`     | browser                | anon         | RLS applies                             |
| `lib/supabase/server.ts`     | RSC / actions / routes | anon         | reads session from cookies; RLS applies |
| `lib/supabase/middleware.ts` | proxy                  | anon         | refreshes the session cookie            |
| `lib/supabase/public.ts`     | server, sessionless    | anon         | public reads only, keeps pages static   |
| `lib/supabase/admin.ts`      | server only            | service role | **bypasses RLS**; unused by the MVP     |

Rules that are enforced, not just intended:

- **`getUser()`, never `getSession()`.** `getUser()` revalidates the JWT with the
  Auth server; `getSession()` trusts the cookie's contents.
- **Session refresh happens in `proxy.ts`.** Server Components cannot write
  cookies, so refresh has to happen there or sessions silently expire.
- **The service-role key is imported in exactly one file**, which is marked
  `server-only` (a client import becomes a build error) and is additionally
  blocked from client modules by an ESLint `no-restricted-imports` rule.

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
   revoked from `PUBLIC`.

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
      ├─ 2. Creative brief  public, client state, sessionStorage-backed
      │        └─ sign up / sign in if needed → draft project created (DRAFT)
      ├─ 3. Reference images  signed upload → private bucket
      └─ 4. Review + consent  → Submit Project → SUBMITTED
                                   └─► /dashboard/projects/{id}
```

Steps 1 and 2 are held in browser state and mirrored to `sessionStorage`
(`features/create-project/draft-storage.ts`) so the sign-up detour does not lose
the customer's work. Nothing sensitive goes in there: no identifiers, no tokens,
no image data, and it does not outlive the tab.

The draft project row is created when the customer leaves step 2, because uploads
need something to be filed against. A customer who abandons the flow and returns
later picks up the same draft rather than starting a second one.

Submission (`submitProjectAction`) writes consent rows **first**, then flips the
status. If the consent write fails, the project stays a DRAFT — there is never a
submitted project without a consent record.

**Statuses:** `DRAFT → SUBMITTED → ASSETS_REVIEW → IN_PRODUCTION → PREVIEW_READY
→ COMPLETED`, with `REVISION_REQUESTED` branching from `PREVIEW_READY` and
`CANCELLED` reachable from anything unfinished. MVP submissions start at
`SUBMITTED`.

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

| Later               | Seam                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| Video generation    | Status moves past `IN_PRODUCTION`; a worker reads the project and its reference assets |
| Preview delivery    | `asset_type = 'PREVIEW_VIDEO'` into `project-deliveries`; customer read policy exists  |
| Final delivery      | `asset_type = 'FINAL_VIDEO'`, same path                                                |
| Revision requests   | `REVISION_REQUESTED` status exists; needs a customer-facing notes table and action     |
| Payments            | A `project_payments` table keyed on `projects.id`; gate the `SUBMITTED` transition     |
| Transactional email | Triggered from status transitions, which are already recorded centrally                |
| Real portfolio      | Populate `portfolio_items.media_url`; `PortfolioFrame` swaps for the real element      |
| Background jobs     | `lib/supabase/admin.ts` is the single audited place the service-role key is read       |

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
