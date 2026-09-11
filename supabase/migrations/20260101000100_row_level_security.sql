-- =============================================================================
-- AI Video Studio — Row Level Security
-- =============================================================================
-- Every customer-facing table is RLS-enabled with explicit, per-operation
-- policies. There is deliberately no blanket `using (true)` policy anywhere.
--
-- Principles:
--   * Ownership is always derived from auth.uid(), never from a client value.
--   * Admin read access flows through public.is_admin(), which reads the
--     trigger-protected profiles.role column.
--   * Customers may only mutate a project while it is still a DRAFT.
--
-- Verification queries for the critical cases live in docs/rls-verification.sql.
-- =============================================================================

alter table public.profiles              enable row level security;
alter table public.video_experiences     enable row level security;
alter table public.projects              enable row level security;
alter table public.project_assets        enable row level security;
alter table public.project_consents      enable row level security;
alter table public.project_status_history enable row level security;
alter table public.portfolio_items       enable row level security;

-- FORCE ROW LEVEL SECURITY is deliberately NOT set. The application never
-- connects as a table owner (it uses the anon / authenticated / service_role
-- PostgREST roles), and the integrity triggers in the schema migration are
-- SECURITY DEFINER functions that must be able to read the parent project row.

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

create policy "profiles: owner can read own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: admin can read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

-- Safe fields only: `role` is pinned to the value already stored, so a customer
-- cannot promote themselves. The profiles_enforce_role_immutable trigger backs
-- this up independently.
create policy "profiles: owner can update safe fields"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = public.current_profile_role()
  );

-- No INSERT policy: profiles are created by the on_auth_user_created trigger.
-- No DELETE policy: accounts are removed through auth.users.

-- -----------------------------------------------------------------------------
-- video_experiences — public catalogue, read-only to everyone
-- -----------------------------------------------------------------------------

create policy "video_experiences: anyone can read active experiences"
  on public.video_experiences for select
  to anon, authenticated
  using (active);

create policy "video_experiences: admin can read all experiences"
  on public.video_experiences for select
  to authenticated
  using (public.is_admin());

-- Writes are an operator task performed with a service-role client or the
-- Supabase dashboard; no policy is granted to anon/authenticated.

-- -----------------------------------------------------------------------------
-- portfolio_items — public marketing content
-- -----------------------------------------------------------------------------

create policy "portfolio_items: anyone can read active items"
  on public.portfolio_items for select
  to anon, authenticated
  using (active);

create policy "portfolio_items: admin can read all items"
  on public.portfolio_items for select
  to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------

create policy "projects: owner can read own projects"
  on public.projects for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "projects: admin can read all projects"
  on public.projects for select
  to authenticated
  using (public.is_admin());

-- A client-supplied user_id that is not the caller fails this WITH CHECK.
create policy "projects: owner can create own projects"
  on public.projects for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'DRAFT'
  );

-- Customers edit their brief only while it is a DRAFT, and may only move it to
-- SUBMITTED. Every later status transition belongs to an admin.
create policy "projects: owner can update own draft projects"
  on public.projects for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and status = 'DRAFT'
  )
  with check (
    user_id = (select auth.uid())
    and status in ('DRAFT', 'SUBMITTED')
  );

create policy "projects: owner can delete own draft projects"
  on public.projects for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and status = 'DRAFT'
  );

-- Admins drive production status. A policy cannot reference OLD, so ownership is
-- pinned by the projects_enforce_owner_immutable trigger instead.
create policy "projects: admin can update project status"
  on public.projects for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- project_assets
-- -----------------------------------------------------------------------------

create policy "project_assets: owner can read own assets"
  on public.project_assets for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "project_assets: admin can read all assets"
  on public.project_assets for select
  to authenticated
  using (public.is_admin());

-- Customers may only attach REFERENCE_IMAGE rows, only to their own project,
-- and only while that project is still a DRAFT. Delivery assets
-- (PREVIEW_VIDEO / FINAL_VIDEO) are written by staff, never by a customer.
create policy "project_assets: owner can add reference images to own draft"
  on public.project_assets for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and asset_type = 'REFERENCE_IMAGE'
    and exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.user_id = (select auth.uid())
        and p.status = 'DRAFT'
    )
  );

create policy "project_assets: owner can remove own draft reference images"
  on public.project_assets for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and asset_type = 'REFERENCE_IMAGE'
    and exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.user_id = (select auth.uid())
        and p.status = 'DRAFT'
    )
  );

-- No UPDATE policy: an asset row is immutable once written.

-- -----------------------------------------------------------------------------
-- project_consents
-- -----------------------------------------------------------------------------

create policy "project_consents: owner can read own consents"
  on public.project_consents for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "project_consents: admin can read all consents"
  on public.project_consents for select
  to authenticated
  using (public.is_admin());

create policy "project_consents: owner can record consent on own draft"
  on public.project_consents for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.user_id = (select auth.uid())
        and p.status = 'DRAFT'
    )
  );

-- A customer may revise consent while the project is still a DRAFT. Once
-- submitted, the record is frozen as evidence of what was agreed.
create policy "project_consents: owner can revise consent on own draft"
  on public.project_consents for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.user_id = (select auth.uid())
        and p.status = 'DRAFT'
    )
  )
  with check (user_id = (select auth.uid()));

-- No DELETE policy: consent records are an audit trail.

-- -----------------------------------------------------------------------------
-- project_status_history — read-only audit trail
-- -----------------------------------------------------------------------------

create policy "project_status_history: owner can read own project history"
  on public.project_status_history for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "project_status_history: admin can read all history"
  on public.project_status_history for select
  to authenticated
  using (public.is_admin());

-- No INSERT/UPDATE/DELETE policies. Rows are written exclusively by the
-- SECURITY DEFINER trigger public.record_project_status_change().
