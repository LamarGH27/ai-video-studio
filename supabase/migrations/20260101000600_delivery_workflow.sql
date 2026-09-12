-- =============================================================================
-- AI Video Studio — preview, revision and final delivery
-- =============================================================================
-- Additive. Nothing in migrations 000000–000500 is modified; the two functions
-- redefined here (allowed_status_transitions, enforce_project_status_transition)
-- are replaced in place with CREATE OR REPLACE, which is a forward change, not
-- an edit to applied history.
--
-- Production stays MANUAL: an administrator produces the video externally and
-- uploads it here. Nothing in this migration generates anything.
--
-- What it adds:
--   * versioned delivery assets (previews are never overwritten)
--   * project_revisions      — the customer's change requests
--   * project_preview_approvals — who approved which preview, and when
--   * workflow invariants enforced in the database, not in buttons
--   * two SECURITY DEFINER RPCs so the customer's two decisions are atomic
--
-- Requires 20260101000500_add_finalising_status.sql to have COMMITTED first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Versioned delivery assets
-- -----------------------------------------------------------------------------
-- A customer must be able to see that "Preview 2" replaced "Preview 1", and
-- support must be able to see what "Preview 1" actually was. So a new preview is
-- a new row and a new storage object; nothing is ever overwritten.

alter table public.project_assets
  add column if not exists version integer not null default 1;

comment on column public.project_assets.version is
  'Delivery sequence within (project_id, asset_type): Preview 1, Preview 2, … Always 1 for REFERENCE_IMAGE.';

-- Reference images are many-per-project and all share version 1, so the
-- uniqueness only applies to deliveries.
create unique index if not exists project_assets_delivery_version_uniq
  on public.project_assets (project_id, asset_type, version)
  where asset_type in ('PREVIEW_VIDEO', 'FINAL_VIDEO');

create index if not exists project_assets_delivery_idx
  on public.project_assets (project_id, asset_type, version desc)
  where asset_type in ('PREVIEW_VIDEO', 'FINAL_VIDEO');

-- -----------------------------------------------------------------------------
-- 1a. When a delivery may be created at all
-- -----------------------------------------------------------------------------
-- The workflow says a preview belongs to production and a final belongs to
-- finalising. That is a rule about the data, so it is enforced on the data.
-- The server action states the same rule, but it is a convenience, not the
-- boundary: this trigger is what makes it true for every caller, including one
-- writing straight to PostgREST with a valid administrator session.
--
-- It is also the concurrency interlock. `FOR UPDATE` takes the same exclusive
-- row lock on public.projects that approve_preview() and
-- request_project_revision() take, so a delivery insert and a customer decision
-- on the same project can never interleave — one waits for the other to commit,
-- and then re-reads. Because PREVIEW_VIDEO requires IN_PRODUCTION while both
-- customer decisions require PREVIEW_READY, and PREVIEW_READY -> IN_PRODUCTION
-- is not a legal transition at all, the dangerous overlap does not merely lose
-- the race: it has no state in which it could be attempted.
--
-- There is deliberately NO break-glass for direct connections here. This is a
-- statement about workflow correctness rather than about privilege, and an
-- operator with a psql prompt can always move the project first.
create or replace function public.enforce_delivery_asset_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.project_status;
begin
  if new.asset_type not in ('PREVIEW_VIDEO', 'FINAL_VIDEO') then
    return new;
  end if;

  -- SECURITY DEFINER so that the lock does not depend on the caller's ability
  -- to see the project row: the invariant must hold for every caller, and a
  -- caller RLS hides the project from must be refused, not waved through.
  select p.status into v_status
  from public.projects p
  where p.id = new.project_id
  for update;

  if v_status is null then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  if new.asset_type = 'PREVIEW_VIDEO' and v_status <> 'IN_PRODUCTION' then
    raise exception
      'A preview can only be created while the project is IN_PRODUCTION (it is %)', v_status
      using errcode = '42501';
  end if;

  if new.asset_type = 'FINAL_VIDEO' and v_status <> 'FINALISING' then
    raise exception
      'A final video can only be created while the project is FINALISING (it is %)', v_status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_delivery_asset_status() is
  'Delivery assets may only be created in the status their workflow stage allows. Locks the parent project row, which is also what serialises delivery inserts against the customer decision RPCs.';

-- The version is assigned by the database, not by the caller. A client that
-- supplies one cannot use it to overwrite an earlier delivery.
create or replace function public.assign_delivery_asset_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_type in ('PREVIEW_VIDEO', 'FINAL_VIDEO') then
    select coalesce(max(a.version), 0) + 1
    into new.version
    from public.project_assets a
    where a.project_id = new.project_id
      and a.asset_type = new.asset_type;
  else
    new.version := 1;
  end if;
  return new;
end;
$$;

-- BEFORE ROW triggers fire in name order, hence the numeric prefixes: the guard
-- must run first so that the project row is locked BEFORE the version is
-- computed. Otherwise two concurrent previews could both read the same
-- max(version) and one would die on the unique index instead of simply queuing.
drop trigger if exists project_assets_assign_version on public.project_assets;
drop trigger if exists project_assets_01_delivery_status on public.project_assets;
create trigger project_assets_01_delivery_status
  before insert on public.project_assets
  for each row execute function public.enforce_delivery_asset_status();

drop trigger if exists project_assets_02_assign_version on public.project_assets;
create trigger project_assets_02_assign_version
  before insert on public.project_assets
  for each row execute function public.assign_delivery_asset_version();

-- -----------------------------------------------------------------------------
-- 2. Revisions
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'revision_status'
                 and typnamespace = 'public'::regnamespace) then
    create type public.revision_status as enum ('OPEN', 'RESOLVED');
  end if;
end;
$$;

create table if not exists public.project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Denormalised owner, same as project_assets: the ownership triggers and RLS
  -- policies then never need a join.
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Which preview the customer was looking at. Kept as audit even if the asset
  -- row is ever removed, hence nullable + ON DELETE SET NULL.
  preview_asset_id uuid references public.project_assets (id) on delete set null,
  message text not null check (char_length(btrim(message)) between 20 and 2000),
  status public.revision_status not null default 'OPEN',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_revisions_resolved_has_timestamp check (
    (status = 'RESOLVED' and resolved_at is not null)
    or (status = 'OPEN' and resolved_at is null)
  )
);

comment on table public.project_revisions is
  'Customer change requests against a preview. Append-only: revisions are resolved, never deleted.';

-- One open request at a time. A second would make "which revision is this
-- preview answering?" unanswerable, so the database refuses it outright.
create unique index if not exists project_revisions_one_open_per_project
  on public.project_revisions (project_id)
  where status = 'OPEN';

create index if not exists project_revisions_project_idx
  on public.project_revisions (project_id, requested_at desc);

drop trigger if exists project_revisions_set_updated_at on public.project_revisions;
create trigger project_revisions_set_updated_at
  before update on public.project_revisions
  for each row execute function public.set_updated_at();

-- Same guarantee as assets and consents: the row's owner is the project's owner.
drop trigger if exists project_revisions_enforce_owner on public.project_revisions;
create trigger project_revisions_enforce_owner
  before insert or update on public.project_revisions
  for each row execute function public.enforce_child_owner_matches_project();

-- -----------------------------------------------------------------------------
-- 3. Preview approvals
-- -----------------------------------------------------------------------------

create table if not exists public.project_preview_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  preview_asset_id uuid references public.project_assets (id) on delete set null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.project_preview_approvals is
  'Records that a customer approved a specific preview version. Evidence for the FINALISING transition.';

create index if not exists project_preview_approvals_project_idx
  on public.project_preview_approvals (project_id, approved_at desc);

drop trigger if exists project_preview_approvals_enforce_owner on public.project_preview_approvals;
create trigger project_preview_approvals_enforce_owner
  before insert or update on public.project_preview_approvals
  for each row execute function public.enforce_child_owner_matches_project();

-- -----------------------------------------------------------------------------
-- 4. The workflow, restated
-- -----------------------------------------------------------------------------
-- Changes from 20260101000400:
--   * PREVIEW_READY -> COMPLETED is REMOVED. Approval is now an explicit
--     customer decision that lands on FINALISING; jumping straight to COMPLETED
--     would skip it, which is exactly the kind of jump this table exists to stop.
--   * PREVIEW_READY -> FINALISING added (customer approval).
--   * FINALISING -> COMPLETED added (final uploaded).
--   * REVISION_REQUESTED -> PREVIEW_READY is REMOVED. Answering a revision means
--     producing a new preview, which means passing through IN_PRODUCTION. Without
--     this, a project could return to PREVIEW_READY on the same preview the
--     customer just rejected, and the revision would auto-resolve unanswered.
--
-- Kept: cancellation from any unfinished state; COMPLETED and CANCELLED final.
create or replace function public.allowed_status_transitions(from_status public.project_status)
returns public.project_status[]
language sql
immutable
set search_path = ''
as $$
  select case from_status
    when 'DRAFT'              then array['SUBMITTED', 'CANCELLED']
    when 'SUBMITTED'          then array['ASSETS_REVIEW', 'IN_PRODUCTION', 'CANCELLED']
    when 'ASSETS_REVIEW'      then array['IN_PRODUCTION', 'SUBMITTED', 'CANCELLED']
    when 'IN_PRODUCTION'      then array['PREVIEW_READY', 'ASSETS_REVIEW', 'CANCELLED']
    when 'PREVIEW_READY'      then array['REVISION_REQUESTED', 'FINALISING', 'CANCELLED']
    when 'REVISION_REQUESTED' then array['IN_PRODUCTION', 'CANCELLED']
    when 'FINALISING'         then array['COMPLETED', 'CANCELLED']
    -- COMPLETED and CANCELLED are final.
    else array[]::text[]
  end::public.project_status[];
$$;

comment on function public.allowed_status_transitions(public.project_status) is
  'The production workflow. Mirrored (for rendering only) by ALLOWED_ADMIN_TRANSITIONS in lib/projects/status.ts; tests/status-model-consistency.test.ts proves the two agree.';

-- -----------------------------------------------------------------------------
-- 5. Workflow invariants
-- -----------------------------------------------------------------------------
-- Replaces the 000400 guard, keeping its behaviour and adding four rules that
-- cannot be expressed as a transition table because they depend on other rows.
--
-- FINALISING and REVISION_REQUESTED are reachable ONLY through their RPCs. Each
-- RPC sets a transaction-local GUC that this trigger requires. A caller cannot
-- set it themselves in any way that matters: SET LOCAL only lives inside one
-- transaction, and the only statements that can run in the RPC's transaction are
-- the RPC's own. An admin updating status over PostgREST gets one statement per
-- transaction, so the flag is never set for them.
create or replace function public.enforce_project_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Break-glass: a direct connection has no PostgREST role claim.
  if coalesce(public.request_jwt_role(), 'service_role') = 'service_role' then
    return new;
  end if;

  if not (new.status = any (public.allowed_status_transitions(old.status))) then
    raise exception 'Project status cannot move from % to %', old.status, new.status
      using errcode = '42501';
  end if;

  -- A preview cannot be ready if there is no preview.
  if new.status = 'PREVIEW_READY' then
    select count(*) into v_count
    from public.project_assets a
    where a.project_id = new.id and a.asset_type = 'PREVIEW_VIDEO';

    if v_count = 0 then
      raise exception 'A project cannot become PREVIEW_READY without a preview video'
        using errcode = '42501';
    end if;
  end if;

  -- Nor completed without something to deliver.
  if new.status = 'COMPLETED' then
    select count(*) into v_count
    from public.project_assets a
    where a.project_id = new.id and a.asset_type = 'FINAL_VIDEO';

    if v_count = 0 then
      raise exception 'A project cannot become COMPLETED without a final video'
        using errcode = '42501';
    end if;
  end if;

  -- These two are customer decisions, and only their RPCs may make them.
  if new.status = 'FINALISING'
     and coalesce(current_setting('avs.preview_approval', true), '') <> 'on' then
    raise exception 'FINALISING is reachable only through public.approve_preview()'
      using errcode = '42501';
  end if;

  if new.status = 'REVISION_REQUESTED'
     and coalesce(current_setting('avs.revision_request', true), '') <> 'on' then
    raise exception 'REVISION_REQUESTED is reachable only through public.request_project_revision()'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. A new preview answers the open revision
-- -----------------------------------------------------------------------------
-- Resolution is a consequence of delivering a new preview, not a separate button
-- an administrator might forget. History is preserved: the row is marked
-- RESOLVED, never deleted.
create or replace function public.resolve_revisions_on_new_preview()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.project_revisions
  set status = 'RESOLVED', resolved_at = now()
  where project_id = new.id and status = 'OPEN';
  return null;
end;
$$;

drop trigger if exists projects_resolve_revisions on public.projects;
create trigger projects_resolve_revisions
  after update of status on public.projects
  for each row
  when (new.status = 'PREVIEW_READY' and old.status is distinct from new.status)
  execute function public.resolve_revisions_on_new_preview();

-- -----------------------------------------------------------------------------
-- 7. The customer's two decisions, as atomic operations
-- -----------------------------------------------------------------------------
-- Both are SECURITY DEFINER, so both bypass RLS — which is precisely why each
-- one re-derives the caller from auth.uid() and verifies ownership and status
-- itself. Neither is a general-purpose status setter: each can reach exactly one
-- status, from exactly one status, for exactly one caller.
--
-- Being a single function call, each is one statement and therefore one
-- transaction: the insert and the status change either both land or neither
-- does. There is no window in which a revision exists against a project that is
-- not REVISION_REQUESTED.

-- -----------------------------------------------------------------------------
-- 7a. Recording a delivery, atomically
-- -----------------------------------------------------------------------------
-- Uploading a preview both creates an asset and announces it. Done as two
-- requests those are two transactions, and a preview can exist for a moment
-- against a project that has not been moved. Done here they are one: the
-- project row is locked first, the status is checked against that locked row,
-- the asset is inserted, and the project moves — or none of it happens.
--
-- SECURITY DEFINER, so it says who may call it: an administrator, and only for
-- the two delivery types. It is not a general asset writer. The RLS policy
-- "project_assets: admin can add delivery assets" still governs direct inserts,
-- and the trigger above governs both paths, so this function is the convenient
-- route rather than the trusted one.
--
-- It deliberately does NOT trust the caller for user_id, bucket or version:
-- the owner is read from the project, the bucket is fixed, and the version is
-- assigned by trigger.
create or replace function public.record_delivery_asset(
  p_project_id uuid,
  p_asset_type public.asset_type,
  p_storage_path text,
  p_mime_type text,
  p_original_filename text,
  p_file_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid;
  v_status   public.project_status;
  v_asset_id uuid;
  v_version  integer;
begin
  if not public.is_admin() then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  if p_asset_type not in ('PREVIEW_VIDEO', 'FINAL_VIDEO') then
    raise exception 'Only delivery assets are recorded through this function'
      using errcode = '42501';
  end if;

  -- The lock, before anything is read that the decision depends on.
  select p.user_id, p.status into v_owner, v_status
  from public.projects p
  where p.id = p_project_id
  for update;

  if v_owner is null then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  if p_asset_type = 'PREVIEW_VIDEO' and v_status <> 'IN_PRODUCTION' then
    raise exception
      'A preview can only be uploaded while the project is in production'
      using errcode = '42501';
  end if;

  if p_asset_type = 'FINAL_VIDEO' and v_status <> 'FINALISING' then
    raise exception
      'A final video can only be uploaded once the customer has approved a preview'
      using errcode = '42501';
  end if;

  -- The path is treated as untrusted even though this application generated it:
  -- it must address the customer's own folder for this project, which is the
  -- only place their storage read policy can reach.
  if p_storage_path is null
     or p_storage_path not like (v_owner::text || '/' || p_project_id::text || '/%') then
    raise exception 'That upload does not belong to this project' using errcode = '42501';
  end if;

  if p_mime_type not in ('video/mp4', 'video/webm') then
    raise exception 'Delivery videos must be MP4 or WebM' using errcode = '22023';
  end if;

  if p_file_size is null or p_file_size <= 0 then
    raise exception 'That upload is empty' using errcode = '22023';
  end if;

  insert into public.project_assets
    (project_id, user_id, asset_type, storage_bucket, storage_path,
     mime_type, original_filename, file_size)
  values
    (p_project_id, v_owner, p_asset_type, 'project-deliveries', p_storage_path,
     p_mime_type, nullif(btrim(coalesce(p_original_filename, '')), ''), p_file_size)
  returning id, version into v_asset_id, v_version;

  -- A preview nobody is told about is not a delivery, so the announcement is
  -- part of the same transaction rather than a follow-up request that might not
  -- happen. The final video does NOT auto-complete: an administrator confirms.
  if p_asset_type = 'PREVIEW_VIDEO' then
    update public.projects set status = 'PREVIEW_READY' where id = p_project_id;
    v_status := 'PREVIEW_READY';
  end if;

  return jsonb_build_object(
    'assetId', v_asset_id, 'version', v_version, 'status', v_status);
end;
$$;

revoke execute on function
  public.record_delivery_asset(uuid, public.asset_type, text, text, text, bigint) from public;
grant execute on function
  public.record_delivery_asset(uuid, public.asset_type, text, text, text, bigint) to authenticated;

comment on function public.record_delivery_asset(uuid, public.asset_type, text, text, text, bigint) is
  'Administrator delivery upload: locks the project, checks the status against that locked row, inserts the asset and (for a preview) moves the project to PREVIEW_READY — atomically.';

-- The customer names the preview they are approving. Approving "whatever is
-- latest" would be wrong: an administrator may upload a replacement while the
-- customer is still watching, and the project stays PREVIEW_READY throughout, so
-- the click would silently approve a cut they never saw — and the approval
-- record would then claim otherwise. The id is checked against the project AND
-- against the current latest version at transaction time, so a stale page
-- cannot approve, it is told to refresh.
drop function if exists public.approve_preview(uuid);

create or replace function public.approve_preview(
  p_project_id uuid,
  p_preview_asset_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_owner        uuid;
  v_status       public.project_status;
  v_latest_id    uuid;
  v_approval_id  uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- FOR UPDATE: two clicks in flight at once must not both pass the checks
  -- below, and it also serialises against a concurrent preview upload.
  select p.user_id, p.status into v_owner, v_status
  from public.projects p
  where p.id = p_project_id
  for update;

  -- Same answer for "does not exist" and "is not yours", so this cannot be used
  -- to discover whether another customer's project id is real.
  if v_owner is null or v_owner <> v_uid then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  if v_status <> 'PREVIEW_READY' then
    raise exception 'Only a project awaiting your approval can be approved'
      using errcode = '42501';
  end if;

  select a.id into v_latest_id
  from public.project_assets a
  where a.project_id = p_project_id and a.asset_type = 'PREVIEW_VIDEO'
  order by a.version desc
  limit 1;

  if v_latest_id is null then
    raise exception 'There is no preview to approve' using errcode = '42501';
  end if;

  -- The named asset must belong to THIS project and be a preview. Checked
  -- separately from the staleness test so that a foreign or fabricated id is
  -- refused as not-found rather than reported as "out of date".
  if not exists (
    select 1 from public.project_assets a
    where a.id = p_preview_asset_id
      and a.project_id = p_project_id
      and a.asset_type = 'PREVIEW_VIDEO'
  ) then
    raise exception 'Preview not found' using errcode = '42501';
  end if;

  if p_preview_asset_id <> v_latest_id then
    raise exception 'A newer preview has been delivered since this page was loaded'
      using errcode = '40001';
  end if;

  insert into public.project_preview_approvals (project_id, user_id, preview_asset_id)
  values (p_project_id, v_uid, p_preview_asset_id)
  returning id into v_approval_id;

  perform set_config('avs.preview_approval', 'on', true);
  update public.projects set status = 'FINALISING' where id = p_project_id;

  return v_approval_id;
end;
$$;

revoke execute on function public.approve_preview(uuid, uuid) from public;
grant execute on function public.approve_preview(uuid, uuid) to authenticated;

comment on function public.approve_preview(uuid, uuid) is
  'Customer approval of a NAMED preview. Refuses a superseded one. Records the approval and moves the project to FINALISING, atomically.';

-- A revision is a rejection of a SPECIFIC cut, and the message describes that
-- cut. Recording it against "whatever is latest" would attach the customer's
-- notes to a preview they never watched, and would silently discard the newer
-- one. Same staleness rule as approval: name the preview, or be told to refresh.
drop function if exists public.request_project_revision(uuid, text);

create or replace function public.request_project_revision(
  p_project_id uuid,
  p_preview_asset_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_owner       uuid;
  v_status      public.project_status;
  v_latest_id   uuid;
  v_revision_id uuid;
  v_message     text := btrim(coalesce(p_message, ''));
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if char_length(v_message) < 20 or char_length(v_message) > 2000 then
    raise exception 'Tell us what to change, in between 20 and 2000 characters'
      using errcode = '22023';
  end if;

  select p.user_id, p.status into v_owner, v_status
  from public.projects p
  where p.id = p_project_id
  for update;

  if v_owner is null or v_owner <> v_uid then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  if v_status <> 'PREVIEW_READY' then
    raise exception 'A revision can only be requested against a preview'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.project_revisions r
    where r.project_id = p_project_id and r.status = 'OPEN'
  ) then
    raise exception 'There is already an open revision request on this project'
      using errcode = '23505';
  end if;

  select a.id into v_latest_id
  from public.project_assets a
  where a.project_id = p_project_id and a.asset_type = 'PREVIEW_VIDEO'
  order by a.version desc
  limit 1;

  if v_latest_id is null then
    raise exception 'There is no preview to revise' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.project_assets a
    where a.id = p_preview_asset_id
      and a.project_id = p_project_id
      and a.asset_type = 'PREVIEW_VIDEO'
  ) then
    raise exception 'Preview not found' using errcode = '42501';
  end if;

  if p_preview_asset_id <> v_latest_id then
    raise exception 'A newer preview has been delivered since this page was loaded'
      using errcode = '40001';
  end if;

  insert into public.project_revisions (project_id, user_id, preview_asset_id, message)
  values (p_project_id, v_uid, p_preview_asset_id, v_message)
  returning id into v_revision_id;

  perform set_config('avs.revision_request', 'on', true);
  update public.projects set status = 'REVISION_REQUESTED' where id = p_project_id;

  return v_revision_id;
end;
$$;

revoke execute on function public.request_project_revision(uuid, uuid, text) from public;
grant execute on function public.request_project_revision(uuid, uuid, text) to authenticated;

comment on function public.request_project_revision(uuid, uuid, text) is
  'Customer revision request against a NAMED preview. Refuses a superseded one. Creates the revision and moves the project to REVISION_REQUESTED, atomically.';

-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.project_revisions         enable row level security;
alter table public.project_preview_approvals enable row level security;

-- Read-only to their owner and to staff. There is deliberately NO insert,
-- update or delete policy on either table: the only way to create a revision or
-- an approval is through the RPCs above, which validate before they write.
-- Resolution is likewise trigger-driven, so nobody — customer or admin — can
-- edit or erase this history through the API.

drop policy if exists "project_revisions: owner can read own revisions" on public.project_revisions;
create policy "project_revisions: owner can read own revisions"
  on public.project_revisions for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "project_revisions: admin can read all revisions" on public.project_revisions;
create policy "project_revisions: admin can read all revisions"
  on public.project_revisions for select
  to authenticated
  using (public.is_admin());

drop policy if exists "project_preview_approvals: owner can read own approvals" on public.project_preview_approvals;
create policy "project_preview_approvals: owner can read own approvals"
  on public.project_preview_approvals for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "project_preview_approvals: admin can read all approvals" on public.project_preview_approvals;
create policy "project_preview_approvals: admin can read all approvals"
  on public.project_preview_approvals for select
  to authenticated
  using (public.is_admin());

-- Delivery assets are staff output. The existing customer INSERT policy already
-- restricts customers to REFERENCE_IMAGE on their own draft; this adds the only
-- path by which PREVIEW_VIDEO and FINAL_VIDEO rows can ever be created.
drop policy if exists "project_assets: admin can add delivery assets" on public.project_assets;
create policy "project_assets: admin can add delivery assets"
  on public.project_assets for insert
  to authenticated
  with check (
    public.is_admin()
    and asset_type in ('PREVIEW_VIDEO', 'FINAL_VIDEO')
    and storage_bucket = 'project-deliveries'
    -- user_id must be the CUSTOMER who owns the project, not the admin: it is
    -- what the customer's read policy and the storage path both key on.
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = project_assets.user_id
    )
  );

-- Still no UPDATE policy on project_assets: a delivery row, once written, is
-- immutable. A new preview is a new row.
