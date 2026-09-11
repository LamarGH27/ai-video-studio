-- =============================================================================
-- AI Video Studio — Supabase Storage buckets and policies
-- =============================================================================
-- Both buckets are PRIVATE. Customer reference photographs must never be
-- reachable through a public object URL; the application reads them through
-- short-lived signed URLs minted server-side.
--
-- Path convention (enforced server-side in lib/storage/paths.ts):
--     {user_id}/{project_id}/{generated_filename}
-- The leading folder is the owner's auth uid, which is what the policies below
-- check. The path alone is NOT the security boundary — these policies are.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reference-images',
  'reference-images',
  false,
  15728640, -- 15 MiB hard ceiling at the storage layer; the app enforces a lower limit.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Created now so delivery can be switched on without a storage migration.
-- Nothing in the MVP writes to it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-deliveries',
  'project-deliveries',
  false,
  1073741824, -- 1 GiB
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- reference-images policies
-- -----------------------------------------------------------------------------

drop policy if exists "reference-images: owner can read own objects" on storage.objects;
create policy "reference-images: owner can read own objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "reference-images: owner can upload into own folder" on storage.objects;
create policy "reference-images: owner can upload into own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "reference-images: owner can replace own objects" on storage.objects;
create policy "reference-images: owner can replace own objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "reference-images: owner can delete own objects" on storage.objects;
create policy "reference-images: owner can delete own objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "reference-images: admin can read all objects" on storage.objects;
create policy "reference-images: admin can read all objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'reference-images'
    and public.is_admin()
  );

-- -----------------------------------------------------------------------------
-- project-deliveries policies
-- -----------------------------------------------------------------------------
-- Customers read finished work; only staff write it. Same {user_id}/... layout.

drop policy if exists "project-deliveries: owner can read own deliveries" on storage.objects;
create policy "project-deliveries: owner can read own deliveries"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-deliveries'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "project-deliveries: admin can manage deliveries" on storage.objects;
create policy "project-deliveries: admin can manage deliveries"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'project-deliveries'
    and public.is_admin()
  )
  with check (
    bucket_id = 'project-deliveries'
    and public.is_admin()
  );

-- No anon policy on either bucket: unauthenticated requests get nothing.
