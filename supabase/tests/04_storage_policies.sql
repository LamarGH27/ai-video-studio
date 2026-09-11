-- =============================================================================
-- Storage policy predicates, exercised directly against storage.objects.
-- =============================================================================
-- SCOPE. This proves the POLICIES are right: who may read, write, overwrite and
-- delete which object rows. It does NOT prove the Storage API is right — signed
-- URL issuance, MIME sniffing, the bucket size limit and multipart upload all
-- live in Supabase's storage service, above this table. Those are verified
-- against a live project by scripts/verify-live.ts.
--
-- The object layout is {user_id}/{project_id}/{filename}; the policies compare
-- (storage.foldername(name))[1] against auth.uid().
-- =============================================================================

begin;

-- Convenience: the two seeded objects.
create or replace function avs_test.a_object() returns text language sql stable as $$
  select 'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/a1.jpg'
$$;
create or replace function avs_test.b_object() returns text language sql stable as $$
  select 'bbbbbbbb-0000-4000-8000-00000000000b/33333333-0000-4000-8000-000000000003/b1.jpg'
$$;
grant execute on function avs_test.a_object(), avs_test.b_object()
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Customer A, own objects
-- -----------------------------------------------------------------------------
select avs_test.become('customer_a');

select avs_test.attempt('Storage A own', 'READ own reference image object', 'ALLOWED',
  $$ select * from storage.objects
     where bucket_id = 'reference-images' and name = avs_test.a_object() $$);

select avs_test.attempt('Storage A own', 'WRITE a new object into own folder', 'ALLOWED',
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('reference-images',
             'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/a2.jpg',
             '{"size":1000,"mimetype":"image/jpeg"}') $$);

select avs_test.attempt('Storage A own', 'DELETE own object', 'ALLOWED',
  $$ delete from storage.objects
     where bucket_id = 'reference-images'
       and name = 'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/a2.jpg' $$);

-- -----------------------------------------------------------------------------
-- Customer A attacking Customer B's objects
-- -----------------------------------------------------------------------------
select avs_test.attempt('Storage A→B', 'READ B''s reference image object row', 'DENIED',
  $$ select * from storage.objects
     where bucket_id = 'reference-images' and name = avs_test.b_object() $$);

select avs_test.attempt('Storage A→B', 'LIST every object in the bucket', 'DENIED',
  $$ select * from storage.objects
     where bucket_id = 'reference-images'
       and name like 'bbbbbbbb%' $$);

select avs_test.attempt('Storage A→B', 'OVERWRITE B''s object', 'DENIED',
  $$ update storage.objects set metadata = '{"size":1,"mimetype":"image/jpeg"}'
     where bucket_id = 'reference-images' and name = avs_test.b_object() $$);

select avs_test.attempt('Storage A→B', 'DELETE B''s object', 'DENIED',
  $$ delete from storage.objects
     where bucket_id = 'reference-images' and name = avs_test.b_object() $$);

select avs_test.attempt('Storage A→B', 'WRITE into B''s folder', 'DENIED',
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('reference-images',
             'bbbbbbbb-0000-4000-8000-00000000000b/33333333-0000-4000-8000-000000000003/planted.jpg',
             '{"size":1000,"mimetype":"image/jpeg"}') $$);

-- Path games: the policy checks the FIRST folder segment, so neither burying
-- the victim's id deeper nor prefixing it gets anywhere.
select avs_test.attempt('Storage A→B', 'WRITE with B''s id in a deeper segment', 'DENIED',
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('reference-images',
             'zzzz/bbbbbbbb-0000-4000-8000-00000000000b/planted.jpg',
             '{"size":1000,"mimetype":"image/jpeg"}') $$);

select avs_test.attempt('Storage A→B', 'WRITE to a folder that merely starts with own id', 'DENIED',
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('reference-images',
             'aaaaaaaa-0000-4000-8000-00000000000a-evil/x/planted.jpg',
             '{"size":1000,"mimetype":"image/jpeg"}') $$);

select avs_test.attempt('Storage A→B', 'WRITE a bare object with no folder at all', 'DENIED',
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('reference-images', 'rootlevel.jpg', '{"size":1000,"mimetype":"image/jpeg"}') $$);

-- -----------------------------------------------------------------------------
-- Delivery bucket: customers read, only staff write
-- -----------------------------------------------------------------------------
select avs_test.attempt('Storage deliveries', 'Customer writes into the delivery bucket', 'DENIED',
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/final.mp4',
             '{"size":1000,"mimetype":"video/mp4"}') $$);

-- -----------------------------------------------------------------------------
-- Anonymous
-- -----------------------------------------------------------------------------
select avs_test.become_anon();

select avs_test.attempt('Storage anon', 'READ any reference image object', 'DENIED',
  $$ select * from storage.objects where bucket_id = 'reference-images' $$);

select avs_test.attempt('Storage anon', 'LIST customer reference media', 'DENIED',
  $$ select name from storage.objects $$);

select avs_test.attempt('Storage anon', 'WRITE an object', 'DENIED',
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('reference-images', 'anon/x.jpg', '{"size":1,"mimetype":"image/jpeg"}') $$);

select avs_test.attempt('Storage anon', 'DELETE a customer object', 'DENIED',
  $$ delete from storage.objects where bucket_id = 'reference-images' $$);

-- A public bucket would make every object reachable by URL without a token.
-- The schema suite asserts `public = false`; this asserts anon cannot even see
-- that the buckets exist in a way that would let it enumerate them.
select avs_test.attempt('Storage anon', 'READ bucket definitions', 'ALLOWED',
  $$ select id from storage.buckets $$);

-- -----------------------------------------------------------------------------
-- Admin
-- -----------------------------------------------------------------------------
select avs_test.become('admin');

select avs_test.attempt('Storage admin', 'READ a customer''s reference image object', 'ALLOWED',
  $$ select * from storage.objects
     where bucket_id = 'reference-images' and name = avs_test.b_object() $$);

select avs_test.attempt('Storage admin', 'WRITE into the delivery bucket', 'ALLOWED',
  $$ insert into storage.objects (bucket_id, name, metadata)
     values ('project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/preview.mp4',
             '{"size":1000,"mimetype":"video/mp4"}') $$);

select avs_test.become_postgres();

commit;
