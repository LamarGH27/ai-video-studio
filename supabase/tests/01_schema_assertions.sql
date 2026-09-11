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
select avs_test.expect('Schema', 'All 7 public tables exist', '7',
  (select count(*)::text from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r'
     and relname in ('profiles','video_experiences','projects','project_assets',
                     'project_consents','project_status_history','portfolio_items')));

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
select avs_test.expect('Schema', 'All 6 enums exist', '6',
  (select count(*)::text from pg_type
   where typnamespace = 'public'::regnamespace and typtype = 'e'
     and typname in ('user_role','project_status','project_orientation',
                     'asset_type','consent_type','experience_category')));

select avs_test.expect('Schema', 'project_status has all 8 values', '8',
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
select avs_test.expect('Functions', 'All expected functions exist', '10',
  (select count(*)::text from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('set_updated_at','request_jwt_role','is_admin','current_profile_role',
                     'handle_new_user','enforce_profile_role_immutable',
                     'enforce_project_owner_immutable','enforce_child_owner_matches_project',
                     'record_project_status_change','generate_project_reference')));

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

select avs_test.expect('Triggers', 'All expected triggers exist', '11',
  (select count(*)::text from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and (c.relnamespace = 'public'::regnamespace or c.relname = 'users')
     and t.tgname in ('profiles_set_updated_at','profiles_enforce_role_immutable',
                      'on_auth_user_created','video_experiences_set_updated_at',
                      'projects_set_updated_at','projects_enforce_owner_immutable',
                      'project_assets_enforce_owner','project_consents_enforce_owner',
                      'projects_record_status_change','portfolio_items_set_updated_at',
                      'projects_enforce_status_transition')));

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
