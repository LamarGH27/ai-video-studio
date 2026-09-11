-- =============================================================================
-- AI Video Studio — project status transition guard
-- =============================================================================
-- Until this migration, the workflow was enforced only in application code
-- (ALLOWED_ADMIN_TRANSITIONS in lib/projects/status.ts). RLS decided *who* could
-- change a status but not *which* changes were legal, so anyone holding the
-- admin role could drive a project straight from SUBMITTED to COMPLETED through
-- the API, skipping asset review and production.
--
-- This makes the database the authority on the workflow. lib/projects/status.ts
-- still carries the same table, but only to decide which buttons to render — the
-- table below is what actually enforces it. The two must be kept in step; see
-- docs/database.md.
--
-- Deliberately NOT blocked here: a direct database connection (migrations, psql,
-- data repair) and a service-role client, matching how role changes are handled.
-- Both are already fully privileged; a trigger is not a meaningful barrier to
-- either, and pretending otherwise would only make legitimate repair awkward.
-- =============================================================================

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
    when 'PREVIEW_READY'      then array['REVISION_REQUESTED', 'COMPLETED', 'CANCELLED']
    when 'REVISION_REQUESTED' then array['IN_PRODUCTION', 'PREVIEW_READY', 'CANCELLED']
    -- COMPLETED and CANCELLED are final.
    else array[]::text[]
  end::public.project_status[];
$$;

comment on function public.allowed_status_transitions(public.project_status) is
  'The production workflow. Mirrored (for rendering only) by ALLOWED_ADMIN_TRANSITIONS in lib/projects/status.ts.';

create or replace function public.enforce_project_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
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

  return new;
end;
$$;

-- Runs BEFORE the AFTER-trigger that records history, so a rejected transition
-- never reaches project_status_history.
create trigger projects_enforce_status_transition
  before update of status on public.projects
  for each row execute function public.enforce_project_status_transition();

-- -----------------------------------------------------------------------------
-- Audit trail ordering
-- -----------------------------------------------------------------------------
-- project_status_history.created_at defaults to now(), which is TRANSACTION
-- start time. Two transitions applied in one transaction therefore land with
-- identical timestamps and the trail has no deterministic order — and its id is
-- a random UUID, so there is no tiebreaker either. In normal operation each
-- transition is its own request, so this is latent rather than active; it stops
-- being latent the moment any batch or repair script moves a project more than
-- one step. clock_timestamp() is the real wall clock and advances within a
-- transaction, which is what an append-only trail needs.
create or replace function public.record_project_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_status_history (project_id, from_status, to_status, changed_by, created_at)
    values (new.id, null, new.status, (select auth.uid()), clock_timestamp());
  elsif new.status is distinct from old.status then
    insert into public.project_status_history (project_id, from_status, to_status, changed_by, created_at)
    values (new.id, old.status, new.status, (select auth.uid()), clock_timestamp());
  end if;
  return null;
end;
$$;
