# Database

Every table, relationship and Row Level Security policy, and the intent behind
each. The migrations in `supabase/migrations/` are the source of truth; this
document explains them.

Apply in filename order:

| Migration                                    | Contents                                           | Re-runnable |
| -------------------------------------------- | -------------------------------------------------- | ----------- |
| `20260101000000_initial_schema.sql`          | enums, tables, indexes, triggers, helper functions | no          |
| `20260101000100_row_level_security.sql`      | RLS enabled plus explicit policies                 | no          |
| `20260101000200_storage.sql`                 | private buckets and storage policies               | yes         |
| `20260101000300_seed_reference_data.sql`     | experiences and placeholder portfolio              | yes         |
| `20260101000400_status_transition_guard.sql` | workflow enforcement + audit trail ordering        | no          |
| `20260101000500_add_finalising_status.sql`   | the `FINALISING` enum value, and nothing else      | yes         |
| `20260101000600_delivery_workflow.sql`       | previews, revisions, approvals, delivery RLS       | yes         |

> **Migrations 000000–000400 are applied history and must never be edited.**
> 000500 and 000600 are additive; `npx supabase db push` upgrades an existing
> project without a reset.
>
> **Why 000500 contains one statement.** PostgreSQL refuses to _use_ a new enum
> value in the transaction that added it, and each migration file is applied in
> its own transaction. `ALTER TYPE … ADD VALUE 'FINALISING'` therefore has to
> commit before 000600, which references it in function bodies and policies, can
> run at all. A unit test asserts that file still contains exactly one statement.

---

## Entity relationships

```
auth.users
    │ 1:1  (on_auth_user_created trigger)
    ▼
profiles ──────1:N──────► projects ──────1:N──────► project_assets
   id                        id                          project_id, user_id
   role                      public_reference   ──1:N──► project_consents
                             user_id            ──1:N──► project_status_history
                             experience_id
                                 │ N:1
                                 ▼
                         video_experiences ──1:N──► portfolio_items
```

| From                     | To                  | Column          | On delete | Notes                                    |
| ------------------------ | ------------------- | --------------- | --------- | ---------------------------------------- |
| `profiles`               | `auth.users`        | `id`            | cascade   | Profile is created by a trigger          |
| `projects`               | `profiles`          | `user_id`       | cascade   | Immutable after insert (trigger)         |
| `projects`               | `video_experiences` | `experience_id` | set null  | Nullable: Custom Concept has no template |
| `project_assets`         | `projects`          | `project_id`    | cascade   |                                          |
| `project_assets`         | `profiles`          | `user_id`       | cascade   | Denormalised; trigger keeps it == owner  |
| `project_consents`       | `projects`          | `project_id`    | cascade   |                                          |
| `project_consents`       | `profiles`          | `user_id`       | cascade   | Same ownership trigger                   |
| `project_status_history` | `projects`          | `project_id`    | cascade   |                                          |
| `project_status_history` | `profiles`          | `changed_by`    | set null  | History survives the actor's deletion    |
| `portfolio_items`        | `video_experiences` | `experience_id` | set null  | Powers "Create Your Version"             |

---

## Enums

| Enum                  | Values                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `user_role`           | `customer`, `admin`                                                                                                                   |
| `project_status`      | `DRAFT`, `SUBMITTED`, `ASSETS_REVIEW`, `IN_PRODUCTION`, `PREVIEW_READY`, `FINALISING`, `REVISION_REQUESTED`, `COMPLETED`, `CANCELLED` |
| `revision_status`     | `OPEN`, `RESOLVED`                                                                                                                    |
| `project_orientation` | `VERTICAL_9_16`, `LANDSCAPE_16_9`, `SQUARE_1_1`                                                                                       |
| `asset_type`          | `REFERENCE_IMAGE`, `PREVIEW_VIDEO`, `FINAL_VIDEO`                                                                                     |
| `consent_type`        | `HAS_LIKENESS_PERMISSION`, `AI_PROCESSING_CONSENT`, `PORTFOLIO_PERMISSION`                                                            |
| `experience_category` | `LUXURY_LIFESTYLE`, `FASHION`, `CINEMATIC`, `SOCIAL_MEDIA`, `CELEBRATION`, `TRAVEL`, `EXECUTIVE`, `BESPOKE`                           |

`PREVIEW_VIDEO` and `FINAL_VIDEO` are unused by the MVP. They exist now so
delivery can be added without a destructive migration.

`experience_category` is shared by `video_experiences` and `portfolio_items`, so
a showcase piece is filterable by the same taxonomy a customer chooses from.

---

## Tables

### `profiles`

Application profile for an `auth.users` row.

| Column         | Type          | Notes                                   |
| -------------- | ------------- | --------------------------------------- |
| `id`           | `uuid` PK     | FK → `auth.users(id)`, cascade          |
| `display_name` | `text`        | 1–120 chars, nullable                   |
| `role`         | `user_role`   | default `customer`. **Privilege data.** |
| `created_at`   | `timestamptz` |                                         |
| `updated_at`   | `timestamptz` | maintained by `profiles_set_updated_at` |

**RLS intent** — a customer reads and updates only their own profile, and cannot
touch `role`. Admins read all profiles. There is no INSERT policy (the trigger
creates rows) and no DELETE policy (accounts go through `auth.users`).

| Policy                                   | Op     | Rule                                                                      |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `profiles: owner can read own profile`   | SELECT | `id = auth.uid()`                                                         |
| `profiles: admin can read all profiles`  | SELECT | `is_admin()`                                                              |
| `profiles: owner can update safe fields` | UPDATE | `id = auth.uid()`; `WITH CHECK` also pins `role = current_profile_role()` |

**Role immutability is enforced twice.** The `WITH CHECK` above pins the column,
and `profiles_enforce_role_immutable` (a `BEFORE UPDATE` trigger) raises `42501`
if `role` changes and the caller is not a service-role client. Since this
application holds no secret key, that means **no request through the application
can change a role at all** — not a customer's own, and not an admin acting on
someone else's. Promotion is a deliberate out-of-band SQL action; see the README.

---

### `video_experiences`

The reusable, commercially reusable templates offered in step 1 of `/create`.

| Column                      | Type                  | Notes                           |
| --------------------------- | --------------------- | ------------------------------- |
| `id`                        | `uuid` PK             |                                 |
| `slug`                      | `text` unique         | lowercase kebab-case, `CHECK`ed |
| `name`                      | `text`                | 1–120 chars                     |
| `description`               | `text`                | 1–1000 chars                    |
| `category`                  | `experience_category` |                                 |
| `active`                    | `boolean`             | default `true`                  |
| `sort_order`                | `integer`             | default `0`                     |
| `created_at` / `updated_at` | `timestamptz`         |                                 |

**RLS intent** — the catalogue is public reference data: anyone may read the
active rows. Writes are an operator task performed via the dashboard or a
service-role client; no policy grants them to `anon` or `authenticated`.

| Policy                                                  | Op     | Rule         |
| ------------------------------------------------------- | ------ | ------------ |
| `video_experiences: anyone can read active experiences` | SELECT | `active`     |
| `video_experiences: admin can read all experiences`     | SELECT | `is_admin()` |

Seeded with: Luxury Lifestyle, Fashion, Cinematic, Celebration, Travel,
Executive, Social Media, Custom Concept.

---

### `projects`

One customer brief.

| Column                      | Type                       | Notes                                                                           |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `id`                        | `uuid` PK                  |                                                                                 |
| `public_reference`          | `text` unique              | `AVS-000123`, from `project_reference_seq`. Immutable. **Never a foreign key.** |
| `user_id`                   | `uuid`                     | FK → `profiles`. Immutable after insert.                                        |
| `experience_id`             | `uuid` null                | FK → `video_experiences`. Null for Custom Concept.                              |
| `title`                     | `text` null                | ≤ 160 chars. Reserved for staff labelling.                                      |
| `status`                    | `project_status`           | default `DRAFT`                                                                 |
| `brief`                     | `text` null                | ≤ 4000 chars                                                                    |
| `mood`                      | `text` null                | ≤ 300                                                                           |
| `environment`               | `text` null                | ≤ 300                                                                           |
| `wardrobe_style`            | `text` null                | ≤ 300                                                                           |
| `orientation`               | `project_orientation` null |                                                                                 |
| `desired_duration_seconds`  | `integer` null             | 5–180                                                                           |
| `special_requirements`      | `text` null                | ≤ 2000                                                                          |
| `preserve_requirements`     | `text` null                | ≤ 2000. Things that must not be changed.                                        |
| `created_at` / `updated_at` | `timestamptz`              |                                                                                 |
| `submitted_at`              | `timestamptz` null         |                                                                                 |

**Constraint `projects_submitted_is_complete`** — anything past `DRAFT` must have
`submitted_at`, a brief of at least 40 characters, and an orientation. A project
cannot be half-submitted even by direct SQL.

**Triggers** — `set_updated_at`; `enforce_project_owner_immutable` (blocks any
change to `user_id` or `public_reference`, which a policy cannot express because
it cannot reference `OLD`); `enforce_project_status_transition` (rejects any
status change outside the workflow below, and runs _before_ history is written so
a rejected move leaves no trace); `record_project_status_change` (writes history
on insert and on every accepted status change).

**The workflow.** `allowed_status_transitions()` is the authority:

| From                 | May move to                                    |
| -------------------- | ---------------------------------------------- |
| `DRAFT`              | `SUBMITTED`, `CANCELLED`                       |
| `SUBMITTED`          | `ASSETS_REVIEW`, `IN_PRODUCTION`, `CANCELLED`  |
| `ASSETS_REVIEW`      | `IN_PRODUCTION`, `SUBMITTED`, `CANCELLED`      |
| `IN_PRODUCTION`      | `PREVIEW_READY`, `ASSETS_REVIEW`, `CANCELLED`  |
| `PREVIEW_READY`      | `REVISION_REQUESTED`, `COMPLETED`, `CANCELLED` |
| `REVISION_REQUESTED` | `IN_PRODUCTION`, `PREVIEW_READY`, `CANCELLED`  |
| `COMPLETED`          | — final                                        |
| `CANCELLED`          | — final                                        |

Nothing returns to `DRAFT`: that would hand edit rights back to the customer
under the "owner can update own draft projects" policy.
`ALLOWED_ADMIN_TRANSITIONS` in `lib/projects/status.ts` mirrors this table, but
only to decide which buttons to render — **keep the two in step**.

Two of the rules are not in the table at all, because they depend on other rows
rather than on the status you are leaving: `PREVIEW_READY` requires a preview to
exist, and `COMPLETED` requires a final video.
`enforce_project_status_transition()` refuses both. `allowedAdminTransitions()`
therefore takes what has been delivered as an argument and filters those two
moves out, so the interface never offers a control the database is certain to
reject.

**RLS intent** — a customer sees and creates only their own projects, and may
edit one only while it is a `DRAFT`. Submitting is the same act as making the
brief read-only. Admins read everything and move status, but cannot reassign a
project.

| Policy                                          | Op     | Rule                                                                                            |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `projects: owner can read own projects`         | SELECT | `user_id = auth.uid()`                                                                          |
| `projects: admin can read all projects`         | SELECT | `is_admin()`                                                                                    |
| `projects: owner can create own projects`       | INSERT | `WITH CHECK user_id = auth.uid() AND status = 'DRAFT'`                                          |
| `projects: owner can update own draft projects` | UPDATE | `USING user_id = auth.uid() AND status = 'DRAFT'`; `WITH CHECK` allows only `DRAFT`/`SUBMITTED` |
| `projects: owner can delete own draft projects` | DELETE | `user_id = auth.uid() AND status = 'DRAFT'`                                                     |
| `projects: admin can update project status`     | UPDATE | `is_admin()` both sides                                                                         |

A client-supplied `user_id` that is not the caller fails the INSERT `WITH CHECK`.
The application never sends one — there is no such field in any Zod schema — but
the database would refuse it regardless.

---

### `project_assets`

Files attached to a project.

| Column              | Type          | Notes                                                                                                                         |
| ------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `uuid` PK     |                                                                                                                               |
| `project_id`        | `uuid`        | FK → `projects`                                                                                                               |
| `user_id`           | `uuid`        | FK → `profiles`. Denormalised owner.                                                                                          |
| `asset_type`        | `asset_type`  | MVP writes `REFERENCE_IMAGE` only                                                                                             |
| `storage_bucket`    | `text`        | `reference-images`                                                                                                            |
| `storage_path`      | `text`        | `{user_id}/{project_id}/{uuid}.{ext}`                                                                                         |
| `mime_type`         | `text`        | Read back from Storage, not from the browser                                                                                  |
| `original_filename` | `text` null   | Sanitised, for support only. **Never used for a path.**                                                                       |
| `version`           | `integer`     | Delivery sequence per `(project_id, asset_type)`. Always 1 for a reference image. Assigned by a trigger, never by the caller. |
| `file_size`         | `bigint`      | > 0. Read back from Storage.                                                                                                  |
| `created_at`        | `timestamptz` |                                                                                                                               |

Unique on `(storage_bucket, storage_path)` — one row per object.

`project_assets_enforce_owner` guarantees `user_id` equals the parent project's
owner, so a row cannot be attached to someone else's project even if it passes
the policy on its own columns.

**RLS intent** — a customer reads their own assets and may attach or remove
**reference images only**, only on their own **draft**. Delivery assets are staff
output and have no customer write path. Asset rows are immutable once written
(no UPDATE policy), so a new preview is always a new row and a new object —
nothing is ever overwritten.

A partial unique index on `(project_id, asset_type, version)` covers the two
delivery types only; reference images are many-per-project and all carry
version 1.

| Policy                                          | Op     | Rule                                                                                                  |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `project_assets: admin can add delivery assets` | INSERT | `is_admin()` + type is a delivery + bucket is `project-deliveries` + `user_id` is the project's owner |

Note the last condition: a delivery row is owned by the **customer**, not by the
administrator who uploaded it. That is what the customer's read policy and the
storage path both key on.

| Policy                                                        | Op     | Rule                                                                      |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `project_assets: owner can read own assets`                   | SELECT | `user_id = auth.uid()`                                                    |
| `project_assets: admin can read all assets`                   | SELECT | `is_admin()`                                                              |
| `project_assets: owner can add reference images to own draft` | INSERT | own + `asset_type = 'REFERENCE_IMAGE'` + parent project owned and `DRAFT` |
| `project_assets: owner can remove own draft reference images` | DELETE | same conditions                                                           |

---

### `project_consents`

What the customer agreed to, and under which wording.

| Column            | Type               | Notes                       |
| ----------------- | ------------------ | --------------------------- |
| `id`              | `uuid` PK          |                             |
| `project_id`      | `uuid`             | FK → `projects`             |
| `user_id`         | `uuid`             | FK → `profiles`             |
| `consent_type`    | `consent_type`     |                             |
| `granted`         | `boolean`          |                             |
| `wording_version` | `text`             | Version in force when given |
| `granted_at`      | `timestamptz` null | Set only when granted       |
| `created_at`      | `timestamptz`      |                             |

Unique on `(project_id, consent_type)`. `CHECK` ties `granted_at` to `granted`:
granted implies a timestamp, not granted implies none.

**RLS intent** — a customer records and revises consent while the project is a
draft; once submitted the record is frozen as evidence. There is no DELETE
policy: this is an audit trail.

| Policy                                                    | Op     | Rule                                   |
| --------------------------------------------------------- | ------ | -------------------------------------- |
| `project_consents: owner can read own consents`           | SELECT | `user_id = auth.uid()`                 |
| `project_consents: admin can read all consents`           | SELECT | `is_admin()`                           |
| `project_consents: owner can record consent on own draft` | INSERT | own + parent project owned and `DRAFT` |
| `project_consents: owner can revise consent on own draft` | UPDATE | same conditions                        |

---

### `project_status_history`

Append-only audit trail of status changes.

| Column        | Type                  | Notes                                                  |
| ------------- | --------------------- | ------------------------------------------------------ |
| `id`          | `uuid` PK             |                                                        |
| `project_id`  | `uuid`                | FK → `projects`                                        |
| `from_status` | `project_status` null | Null for the creation row                              |
| `to_status`   | `project_status`      |                                                        |
| `changed_by`  | `uuid` null           | `auth.uid()` at the time; `set null` on actor deletion |
| `created_at`  | `timestamptz`         |                                                        |

**RLS intent** — read-only to everyone through the API. There are no INSERT,
UPDATE or DELETE policies at all: rows are written exclusively by the
`SECURITY DEFINER` trigger `record_project_status_change()`. Application code
cannot forge, amend or skip an entry — not a customer's, and not an admin's.

`created_at` is written as `clock_timestamp()`, not left to the `now()` default.
`now()` is _transaction_ time, so two transitions applied in one transaction
would land with identical timestamps and, since `id` is a random UUID, the trail
would have no deterministic order.

| Policy                                                       | Op     | Rule                                 |
| ------------------------------------------------------------ | ------ | ------------------------------------ |
| `project_status_history: owner can read own project history` | SELECT | parent project owned by `auth.uid()` |
| `project_status_history: admin can read all history`         | SELECT | `is_admin()`                         |

---

### `project_revisions`

A customer's request for changes to a preview.

| Column                      | Type               | Notes                                                                   |
| --------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `id`                        | `uuid` PK          |                                                                         |
| `project_id`                | `uuid`             | FK → `projects`, cascade                                                |
| `user_id`                   | `uuid`             | FK → `profiles`. Denormalised owner.                                    |
| `preview_asset_id`          | `uuid` null        | Which preview it concerns. `ON DELETE SET NULL` so the record survives. |
| `message`                   | `text`             | 20–2000 chars after trimming, `CHECK`ed                                 |
| `status`                    | `revision_status`  | `OPEN` or `RESOLVED`                                                    |
| `requested_at`              | `timestamptz`      |                                                                         |
| `resolved_at`               | `timestamptz` null | Tied to `status` by a `CHECK`                                           |
| `created_at` / `updated_at` | `timestamptz`      |                                                                         |

A partial unique index on `(project_id) WHERE status = 'OPEN'` allows **one open
request at a time** — a second would make "which revision does this preview
answer?" unanswerable.

**RLS intent** — readable by its owner and by staff. **There is no INSERT,
UPDATE or DELETE policy at all.** The only way to create one is
`request_project_revision()`, and the only way to resolve one is the
`projects_resolve_revisions` trigger. Neither a customer nor an admin can edit
or erase this history through the API.

---

### `project_preview_approvals`

Evidence that a customer approved a specific preview.

| Column             | Type          | Notes                      |
| ------------------ | ------------- | -------------------------- |
| `id`               | `uuid` PK     |                            |
| `project_id`       | `uuid`        | FK → `projects`, cascade   |
| `user_id`          | `uuid`        | FK → `profiles`            |
| `preview_asset_id` | `uuid` null   | The exact version approved |
| `approved_at`      | `timestamptz` |                            |
| `created_at`       | `timestamptz` |                            |

**RLS intent** — identical to revisions: owner and admin may read, nobody may
write. Rows come only from `approve_preview()`.

---

### When a delivery may be created, and what serialises it

`enforce_delivery_asset_status()` is a `BEFORE INSERT` trigger on
`project_assets`. For the two delivery types it does exactly two things, in
this order:

1. `SELECT … FOR UPDATE` on the parent `public.projects` row.
2. Refuses the insert unless the status is the one that stage belongs to —
   `PREVIEW_VIDEO` requires `IN_PRODUCTION`, `FINAL_VIDEO` requires
   `FINALISING` (`42501` otherwise).

It fires as `project_assets_01_delivery_status`, before
`project_assets_02_assign_version`, because the lock has to be held before the
next version is computed. `BEFORE ROW` triggers fire in name order, which is
what the numeric prefixes are for; a schema assertion checks that ordering
rather than trusting the comment.

There is no break-glass for direct connections here, unlike the status
transition guard. This is a statement about workflow correctness rather than
about privilege, and an operator with a `psql` prompt can always move the
project first.

**Why this closes the stale-approval race.** Both customer decisions require
`PREVIEW_READY`. Creating a preview requires `IN_PRODUCTION`. And
`PREVIEW_READY → IN_PRODUCTION` is not a legal transition — the only way back
into production is `PREVIEW_READY → REVISION_REQUESTED → IN_PRODUCTION`, whose
first step is itself an RPC that locks the project row. So there is no state in
which a customer can be deciding while a new preview is created: the write is
not merely unlikely to win the race, it is illegal in that status.

The lock is the second line rather than the first. Every path that writes a
delivery or changes a project's stage — the insert trigger,
`record_delivery_asset()`, `approve_preview()`, `request_project_revision()` —
takes the same exclusive lock on the same `projects` row, always before reading
anything the decision depends on, and holds it to commit. Two of them on one
project therefore serialise: the second waits, then re-reads. Lock order is
`projects` first in every path, so they cannot deadlock against each other.
`supabase/tests/concurrency/` drives two live connections to observe this
directly.

---

### The customer's two decisions

`approve_preview(project_id, preview_asset_id)` and
`request_project_revision(project_id, preview_asset_id, message)` are the only
routes to `FINALISING` and `REVISION_REQUESTED`. Both are `SECURITY DEFINER`
with a pinned `search_path`, both are revoked from `PUBLIC` and granted only to
`authenticated`, and both re-derive the caller from `auth.uid()` rather than
trusting an argument. A project that does not exist and a project belonging to
someone else produce the same message, so neither can be used to discover
whether another customer's id is real.

**Both take the preview id, and it is not decoration.** An administrator may
upload a replacement preview while the project is already `PREVIEW_READY`, and
the status does not change when they do — so a customer with the page open is
looking at a cut that is no longer current. If the functions acted on "whatever
is latest", that customer's click would approve a film they had never watched,
and `project_preview_approvals` would record that they had. Instead the named
asset is checked twice: it must belong to this project and be a
`PREVIEW_VIDEO` (otherwise `Preview not found`, `42501` — asset ids are
untrusted input), and it must still be the highest version (otherwise
`A newer preview has been delivered since this page was loaded`, `40001`, which
the UI turns into an instruction to refresh). The read that determines the
latest version happens after `SELECT … FOR UPDATE` on the project row, so a
preview landing concurrently cannot slip past the check.

A revision is likewise recorded against the preview the notes describe, never
against a newer one the customer has not seen.

---

### `portfolio_items`

Public marketing showcase.

| Column                      | Type                  | Notes                           |
| --------------------------- | --------------------- | ------------------------------- |
| `id`                        | `uuid` PK             |                                 |
| `experience_id`             | `uuid` null           | FK → `video_experiences`        |
| `title`                     | `text`                | 1–160 chars                     |
| `slug`                      | `text` unique         | kebab-case, `CHECK`ed           |
| `description`               | `text` null           | ≤ 1000                          |
| `category`                  | `experience_category` |                                 |
| `media_url`                 | `text` null           | **Public marketing asset only** |
| `thumbnail_url`             | `text` null           | **Public marketing asset only** |
| `featured`                  | `boolean`             | default `false`                 |
| `active`                    | `boolean`             | default `true`                  |
| `sort_order`                | `integer`             | default `0`                     |
| `created_at` / `updated_at` | `timestamptz`         |                                 |

`experience_id` is what makes "Create Your Version" work: the link carries the
matching experience slug into `/create`.

**RLS intent** — active rows are readable by anyone, including `anon`. There is
no customer or public write path.

| Policy                                          | Op     | Rule         |
| ----------------------------------------------- | ------ | ------------ |
| `portfolio_items: anyone can read active items` | SELECT | `active`     |
| `portfolio_items: admin can read all items`     | SELECT | `is_admin()` |

> **Customer reference photographs must never be referenced from this table.**
> It is publicly readable by design. Customer media lives in a private bucket and
> is only ever served through short-lived signed URLs.

---

## Helper functions

| Function                                | Kind                      | Purpose                                                                               |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `set_updated_at()`                      | trigger                   | Maintains `updated_at`                                                                |
| `request_jwt_role()`                    | stable                    | PostgREST role of the current request, or null for a direct connection                |
| `is_admin()`                            | stable, SECURITY DEFINER  | Whether the caller is an admin; `EXECUTE` revoked from `PUBLIC`                       |
| `current_profile_role()`                | stable, SECURITY DEFINER  | Caller's stored role, without recursing through RLS                                   |
| `handle_new_user()`                     | trigger, SECURITY DEFINER | Creates a profile for each new `auth.users` row                                       |
| `enforce_profile_role_immutable()`      | trigger, SECURITY DEFINER | Blocks role changes from non-service-role callers                                     |
| `enforce_project_owner_immutable()`     | trigger                   | Blocks changes to `user_id` and `public_reference`                                    |
| `enforce_child_owner_matches_project()` | trigger, SECURITY DEFINER | Keeps asset/consent `user_id` equal to the project owner                              |
| `record_project_status_change()`        | trigger, SECURITY DEFINER | Writes `project_status_history`                                                       |
| `generate_project_reference()`          | volatile                  | `AVS-` + 6-digit sequence value                                                       |
| `enforce_delivery_asset_status()`       | trigger, SECURITY DEFINER | Locks the parent project and refuses a delivery created at the wrong stage            |
| `record_delivery_asset()`               | SECURITY DEFINER          | Administrator delivery upload: lock, validate, insert and announce, atomically        |
| `approve_preview()`                     | SECURITY DEFINER          | The customer's approval of a named preview; `EXECUTE` granted only to `authenticated` |
| `request_project_revision()`            | SECURITY DEFINER          | The customer's revision request against a named preview; same grant                   |

**Every** function in `public` pins `search_path`, not only the `SECURITY
DEFINER` ones, so none can be hijacked by a schema on the caller's path. This is
Supabase's `function_search_path_mutable` lint rule; the database suite asserts
it mechanically so it cannot regress.

`is_admin()` and `current_profile_role()` are defined _after_ `public.profiles`
in the initial migration. Both are `language sql`, whose body is parsed and
validated at `CREATE` time, so neither can be declared before the table it reads.

---

## Storage

| Bucket               | Public | Size limit | Allowed types                                | Status           |
| -------------------- | ------ | ---------- | -------------------------------------------- | ---------------- |
| `reference-images`   | **no** | 15 MiB     | `image/jpeg`, `image/png`, `image/webp`      | in use           |
| `project-deliveries` | **no** | 1 GiB      | `video/mp4`, `video/quicktime`, `video/webm` | reserved, unused |

The application enforces a lower 10 MB per-file limit; the bucket ceiling is the
backstop.

Object layout in both buckets: `{user_id}/{project_id}/{generated_filename}`.

For deliveries the generated name is `{preview|final}-v{n}-{uuid}.{ext}`. The
leading folder is the **customer's** uid even though an administrator uploads
it, because that is what the customer's read policy checks. The uuid — not the
version — is what guarantees a new preview can never overwrite an earlier one.

### Storage policies on `storage.objects`

| Policy                                               | Op     | Rule                                       |
| ---------------------------------------------------- | ------ | ------------------------------------------ |
| `reference-images: owner can read own objects`       | SELECT | bucket + first path segment = `auth.uid()` |
| `reference-images: owner can upload into own folder` | INSERT | same                                       |
| `reference-images: owner can replace own objects`    | UPDATE | same, both sides                           |
| `reference-images: owner can delete own objects`     | DELETE | same                                       |
| `reference-images: admin can read all objects`       | SELECT | bucket + `is_admin()`                      |
| `project-deliveries: owner can read own deliveries`  | SELECT | bucket + first path segment = `auth.uid()` |
| `project-deliveries: admin can manage deliveries`    | ALL    | bucket + `is_admin()`                      |

No policy grants `anon` anything in either bucket.

**The path is not the security boundary — these policies are.** The layout exists
so the policies have something simple to check, and so objects are easy to reason
about operationally. Application code independently verifies that a path belongs
to the caller before acting on it (`isPathOwnedBy`, and the prefix check in
`confirmUploadAction`).

---

## Verifying RLS

`docs/rls-verification.sql` contains runnable assertions for the cases that
matter most:

1. A customer cannot read another customer's project, assets or consent.
2. A customer cannot change their own `role` — both policy and trigger.
3. A customer cannot insert a project owned by someone else.
4. A customer cannot edit a project once it is submitted.
5. A customer cannot attach an asset to a project they do not own.
6. Anonymous visitors read only active portfolio and experience rows.
7. `project_status_history` rejects direct writes.

Run it in the Supabase SQL Editor after applying the migrations. Each block
raises an exception if the expectation fails, and rolls back at the end.

---

## Regenerating types

`types/database.ts` mirrors this schema by hand. Once a project is linked:

```bash
npx supabase gen types typescript --linked > types/database.ts
```

Until then, any schema change must be reflected in that file in the same commit.
