-- =============================================================================
-- Schema assertions — what the migrations are supposed to have created.
-- =============================================================================
-- Answers, mechanically: do the tables, enums, triggers, functions, RLS flags,
-- buckets, storage policies and seed rows actually exist after a clean apply?
-- =============================================================================

begin;

create or replace function avs_test.expect(
  p_area text, p_check text, p_expected text, p_actual text
) returns void language plpgsql as $$
begin
  insert into avs_test.results (area, attack, expected, actual, pass)
  values (p_area, p_check, p_expected, p_actual, p_expected = p_actual);
end;
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
select avs_test.expect('Schema', 'All 9 public tables exist', '9',
  (select count(*)::text from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r'
     and relname in ('profiles','video_experiences','projects','project_assets',
                     'project_consents','project_status_history','portfolio_items',
                     'project_revisions','project_preview_approvals')));

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
select avs_test.expect('Schema', 'All 7 enums exist', '7',
  (select count(*)::text from pg_type
   where typnamespace = 'public'::regnamespace and typtype = 'e'
     and typname in ('user_role','project_status','project_orientation',
                     'asset_type','consent_type','experience_category','revision_status')));

select avs_test.expect('Schema', 'project_status has all 9 values', '9',
  (select count(*)::text from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'project_status'));

select avs_test.expect('Schema', 'asset_type supports future delivery types', 'true',
  (select (array_agg(e.enumlabel::text order by e.enumsortorder)
           @> array['REFERENCE_IMAGE','PREVIEW_VIDEO','FINAL_VIDEO'])::text
   from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'asset_type'));

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
select avs_test.expect('RLS', 'RLS enabled on every customer-facing table', '0',
  (select count(*)::text from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r'
     and relrowsecurity = false));

-- The architecture promises no blanket permissive policy. Prove it rather than
-- asserting it: any policy whose USING clause is literally `true` and which is
-- granted to anon or authenticated would be exactly that.
select avs_test.expect('RLS', 'No blanket `using (true)` policy for anon/authenticated', '0',
  (select count(*)::text from pg_policies
   where schemaname = 'public'
     and coalesce(qual, '') = 'true'
     and (roles::text[] && array['anon','authenticated','public'])));

select avs_test.expect('RLS', 'project_status_history has no write policy', '0',
  (select count(*)::text from pg_policies
   where schemaname = 'public' and tablename = 'project_status_history'
     and cmd <> 'SELECT'));

select avs_test.expect('RLS', 'profiles has no INSERT or DELETE policy', '0',
  (select count(*)::text from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and cmd in ('INSERT','DELETE')));

select avs_test.expect('RLS', 'project_assets rows are immutable (no UPDATE policy)', '0',
  (select count(*)::text from pg_policies
   where schemaname = 'public' and tablename = 'project_assets' and cmd = 'UPDATE'));

-- -----------------------------------------------------------------------------
-- Functions and triggers
-- -----------------------------------------------------------------------------
select avs_test.expect('Functions', 'All expected functions exist', '17',
  (select count(*)::text from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('set_updated_at','request_jwt_role','is_admin','current_profile_role',
                     'handle_new_user','enforce_profile_role_immutable',
                     'enforce_project_owner_immutable','enforce_child_owner_matches_project',
                     'record_project_status_change','generate_project_reference',
                     'allowed_status_transitions','enforce_project_status_transition',
                     'assign_delivery_asset_version','enforce_delivery_asset_status',
                     'record_delivery_asset','approve_preview',
                     'request_project_revision')));

-- A SECURITY DEFINER function without a pinned search_path can be hijacked by a
-- schema on the caller's path. This is the Supabase linter's
-- `function_search_path_mutable` rule, asserted here so it cannot regress.
select avs_test.expect('Functions', 'Every SECURITY DEFINER function pins search_path', '0',
  (select count(*)::text from pg_proc
   where pronamespace = 'public'::regnamespace
     and prosecdef
     and (proconfig is null or not (proconfig::text like '%search_path%'))));

select avs_test.expect('Functions', 'Every public function pins search_path', '0',
  (select count(*)::text from pg_proc
   where pronamespace = 'public'::regnamespace
     and prokind = 'f'
     and (proconfig is null or not (proconfig::text like '%search_path%'))));

select avs_test.expect('Functions', 'is_admin() is not executable by PUBLIC', 'false',
  (select has_function_privilege('public', 'public.is_admin()', 'EXECUTE')::text));

select avs_test.expect('Triggers', 'All expected triggers exist', '17',
  (select count(*)::text from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and (c.relnamespace = 'public'::regnamespace or c.relname = 'users')
     and t.tgname in ('profiles_set_updated_at','profiles_enforce_role_immutable',
                      'on_auth_user_created','video_experiences_set_updated_at',
                      'projects_set_updated_at','projects_enforce_owner_immutable',
                      'project_assets_enforce_owner','project_consents_enforce_owner',
                      'projects_record_status_change','portfolio_items_set_updated_at',
                      'projects_enforce_status_transition',
                      'project_assets_01_delivery_status','project_assets_02_assign_version',
                      'projects_resolve_revisions',
                      'project_revisions_set_updated_at','project_revisions_enforce_owner',
                      'project_preview_approvals_enforce_owner')));

-- The guard takes the lock, so it has to fire before the version is computed.
-- BEFORE ROW triggers fire in name order, so this asserts the name order rather
-- than trusting a comment to stay true.
select avs_test.expect('Triggers', 'The delivery status guard fires before the version is assigned', 'true',
  (select (min(t.tgname) filter (where t.tgfoid = 'public.enforce_delivery_asset_status'::regproc)
           < min(t.tgname) filter (where t.tgfoid = 'public.assign_delivery_asset_version'::regproc))::text
   from pg_trigger t
   where t.tgrelid = 'public.project_assets'::regclass
     and not t.tgisinternal));

-- -----------------------------------------------------------------------------
-- Constraints that carry security or integrity weight
-- -----------------------------------------------------------------------------
select avs_test.expect('Constraints', 'Submitted projects must be complete', 'true',
  (select exists (select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_submitted_is_complete')::text));

select avs_test.expect('Constraints', 'public_reference is unique', 'true',
  (select exists (select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%public_reference%')::text));

select avs_test.expect('Constraints', 'One consent row per project per type', 'true',
  (select exists (select 1 from pg_constraint
    where conrelid = 'public.project_consents'::regclass
      and conname = 'project_consents_unique_per_project')::text));

-- -----------------------------------------------------------------------------
-- Delivery workflow (Milestone 2A)
-- -----------------------------------------------------------------------------

-- Revisions and approvals are created only by their SECURITY DEFINER RPCs and
-- resolved only by a trigger, so neither table may expose ANY write policy.
select avs_test.expect('Delivery RLS', 'project_revisions has no write policy', '0',
  (select count(*)::text from pg_policies
   where schemaname = 'public' and tablename = 'project_revisions' and cmd <> 'SELECT'));

select avs_test.expect('Delivery RLS', 'project_preview_approvals has no write policy', '0',
  (select count(*)::text from pg_policies
   where schemaname = 'public' and tablename = 'project_preview_approvals' and cmd <> 'SELECT'));

select avs_test.expect('Delivery RLS', 'Delivery assets have exactly one admin-only insert policy', '1',
  (select count(*)::text from pg_policies
   where schemaname = 'public' and tablename = 'project_assets' and cmd = 'INSERT'
     and qual is null and with_check like '%is_admin%'));

select avs_test.expect('Delivery RLS', 'RLS is enabled on both new tables', '2',
  (select count(*)::text from pg_class
   where relnamespace = 'public'::regnamespace
     and relname in ('project_revisions','project_preview_approvals')
     and relrowsecurity));

select avs_test.expect('Delivery', 'Only one OPEN revision per project is possible', 'true',
  (select exists (select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'project_revisions'
      and indexdef like '%WHERE (status = ''OPEN''::revision_status)%')::text));

select avs_test.expect('Delivery', 'Delivery versions are unique per project and type', 'true',
  (select exists (select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'project_assets'
      and indexname = 'project_assets_delivery_version_uniq')::text));

-- The RPCs are the only route to FINALISING and REVISION_REQUESTED, so they must
-- be SECURITY DEFINER, pinned, and not executable by anonymous callers.
select avs_test.expect('Delivery', 'Both customer RPCs are SECURITY DEFINER with a pinned search_path', '2',
  (select count(*)::text from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('approve_preview','request_project_revision')
     and prosecdef
     and proconfig::text like '%search_path%'));

select avs_test.expect('Delivery', 'approve_preview is not executable by PUBLIC', 'false',
  (select has_function_privilege('public', 'public.approve_preview(uuid, uuid)', 'EXECUTE')::text));

select avs_test.expect('Delivery', 'request_project_revision is not executable by PUBLIC', 'false',
  (select has_function_privilege('public', 'public.request_project_revision(uuid, uuid, text)', 'EXECUTE')::text));

-- The earlier signatures took no preview id and acted on whatever was latest.
-- They must be gone, not merely superseded: an overload left in place would be
-- resolvable by a stale client and would bypass the staleness check entirely.
select avs_test.expect('Delivery', 'No unguarded approve_preview(uuid) overload survives', '0',
  (select count(*)::text from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'approve_preview'
     and pg_get_function_identity_arguments(oid) = 'p_project_id uuid'));

select avs_test.expect('Delivery', 'No unguarded request_project_revision(uuid, text) overload survives', '0',
  (select count(*)::text from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'request_project_revision'
     and pg_get_function_identity_arguments(oid) = 'p_project_id uuid, p_message text'));

select avs_test.expect('Delivery', 'record_delivery_asset is not executable by PUBLIC', 'false',
  (select has_function_privilege('public',
    'public.record_delivery_asset(uuid, public.asset_type, text, text, text, bigint)',
    'EXECUTE')::text));

-- Exactly one of each, so there is only ever one way in.
select avs_test.expect('Delivery', 'Each customer RPC exists exactly once', '2',
  (select count(*)::text from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('approve_preview','request_project_revision')));

-- -----------------------------------------------------------------------------
-- Storage
-- -----------------------------------------------------------------------------
select avs_test.expect('Storage', 'Both buckets exist', '2',
  (select count(*)::text from storage.buckets
   where id in ('reference-images','project-deliveries')));

select avs_test.expect('Storage', 'No bucket is public', '0',
  (select count(*)::text from storage.buckets where public));

select avs_test.expect('Storage', 'reference-images restricts MIME types to images', 'true',
  (select (allowed_mime_types @> array['image/jpeg','image/png','image/webp']
           and array_length(allowed_mime_types, 1) = 3)::text
   from storage.buckets where id = 'reference-images'));

select avs_test.expect('Storage', 'reference-images has a file size limit', 'true',
  (select (file_size_limit is not null and file_size_limit > 0)::text
   from storage.buckets where id = 'reference-images'));

select avs_test.expect('Storage', 'reference-images has owner-scoped policies for all 4 verbs', '4',
  (select count(distinct cmd)::text from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'reference-images:%'));

select avs_test.expect('Storage', 'No storage policy grants anything to anon', '0',
  (select count(*)::text from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and roles::text[] && array['anon','public']));

-- -----------------------------------------------------------------------------
-- Seed data
-- -----------------------------------------------------------------------------
select avs_test.expect('Seed', 'All 8 video experiences seeded and active', '8',
  (select count(*)::text from public.video_experiences where active));

select avs_test.expect('Seed', 'Custom Concept experience exists', 'true',
  (select exists (select 1 from public.video_experiences where slug = 'custom-concept')::text));

select avs_test.expect('Seed', 'Every portfolio item links to an experience', '0',
  (select count(*)::text from public.portfolio_items
   where active and experience_id is null));

select avs_test.expect('Seed', 'public_reference is formatted AVS-000000', 'true',
  (select (public.generate_project_reference() ~ '^AVS-\d{6}$')::text));

commit;
