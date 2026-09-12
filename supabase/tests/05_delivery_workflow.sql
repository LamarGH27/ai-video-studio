-- =============================================================================
-- Preview, revision and final delivery — adversarial and workflow tests.
-- =============================================================================
-- Runs as real `anon` / `authenticated` roles carrying a JWT claim set, the way
-- PostgREST presents a request. Nothing here goes through application code, so
-- nothing here can be protected by it.
--
-- Covers the Milestone 2A requirements:
--   customers cannot create or reach delivery media; PREVIEW_READY needs a
--   preview and COMPLETED needs a final; approval and revision are atomic,
--   owner-only, and reachable only through their RPCs.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fixtures: A and B each get a project sitting in production.
-- -----------------------------------------------------------------------------
insert into avs_test.ids (k, v) values
  ('a_production', '77777777-0000-4000-8000-000000000007'),
  ('b_production', '88888888-0000-4000-8000-000000000008')
on conflict (k) do nothing;

insert into public.projects
  (id, user_id, status, brief, orientation, desired_duration_seconds, submitted_at)
values
  (avs_test.id('a_production'), avs_test.id('customer_a'), 'IN_PRODUCTION',
   'Customer A project in production, with a brief long enough to satisfy the constraint.',
   'VERTICAL_9_16', 15, now()),
  (avs_test.id('b_production'), avs_test.id('customer_b'), 'IN_PRODUCTION',
   'Customer B project in production, with a brief long enough to satisfy the constraint.',
   'LANDSCAPE_16_9', 30, now());

-- =============================================================================
-- 1. Customers cannot create delivery assets. At all. Ever.
-- =============================================================================
select avs_test.become('customer_a');

select avs_test.attempt('Delivery writes', 'Customer creates a PREVIEW_VIDEO on own project', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'PREVIEW_VIDEO',
             'project-deliveries', 'a/self-preview.mp4', 'video/mp4', 1000) $$);

select avs_test.attempt('Delivery writes', 'Customer creates a FINAL_VIDEO on own project', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'FINAL_VIDEO',
             'project-deliveries', 'a/self-final.mp4', 'video/mp4', 1000) $$);

select avs_test.attempt('Delivery writes', 'Customer creates a delivery on B''s project', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('b_production'), avs_test.id('customer_b'), 'PREVIEW_VIDEO',
             'project-deliveries', 'b/forged.mp4', 'video/mp4', 1000) $$);

-- =============================================================================
-- 2. Workflow invariants: a preview cannot be "ready" without a preview.
-- =============================================================================
select avs_test.become('admin');

select avs_test.attempt('Invariants', 'PREVIEW_READY without any preview video', 'DENIED',
  $$ update public.projects set status = 'PREVIEW_READY'
     where id = avs_test.id('a_production') $$);

-- The admin uploads Preview 1 (the row; the object lives in storage).
select avs_test.attempt('Delivery writes', 'Admin creates a PREVIEW_VIDEO', 'ALLOWED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'PREVIEW_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/preview-v1.mp4',
             'video/mp4', 5000000) $$);

-- The database, not the caller, assigns the version.
do $$
declare v int;
begin
  select version into v from public.project_assets
  where project_id = avs_test.id('a_production') and asset_type = 'PREVIEW_VIDEO';

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Versioning', 'First preview is assigned version 1 by the database',
    'ALLOWED (version 1)',
    case when v = 1 then 'ALLOWED (version 1)' else format('DENIED (version %s)', v) end,
    v = 1);
end;
$$;

select avs_test.attempt('Invariants', 'PREVIEW_READY once a preview exists', 'ALLOWED',
  $$ update public.projects set status = 'PREVIEW_READY'
     where id = avs_test.id('a_production') $$);

-- =============================================================================
-- 3. The customer's decisions are theirs alone.
-- =============================================================================
select avs_test.become('customer_b');

select avs_test.attempt('Cross-customer', 'B approves A''s preview', 'DENIED',
  $$ select public.approve_preview(avs_test.id('a_production')) $$);

select avs_test.attempt('Cross-customer', 'B requests a revision on A''s project', 'DENIED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       'I would like this changed even though it is not my project at all.') $$);

select avs_test.attempt('Cross-customer', 'B reads A''s preview asset row', 'DENIED',
  $$ select * from public.project_assets
     where project_id = avs_test.id('a_production') and asset_type = 'PREVIEW_VIDEO' $$);

-- Nothing B attempted may have changed A's project.
do $$
declare s public.project_status;
begin
  perform avs_test.become_postgres();
  select status into s from public.projects where id = avs_test.id('a_production');

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Cross-customer', 'A''s project is untouched by B''s attempts',
    'ALLOWED (PREVIEW_READY)',
    case when s = 'PREVIEW_READY' then 'ALLOWED (PREVIEW_READY)' else format('DENIED (%s)', s) end,
    s = 'PREVIEW_READY');
end;
$$;

-- =============================================================================
-- 4. Neither FINALISING nor REVISION_REQUESTED is reachable by hand.
-- =============================================================================
select avs_test.become('admin');

select avs_test.attempt('Invariants', 'Admin sets FINALISING directly, bypassing approval', 'DENIED',
  $$ update public.projects set status = 'FINALISING'
     where id = avs_test.id('a_production') $$);

select avs_test.attempt('Invariants', 'Admin sets REVISION_REQUESTED directly', 'DENIED',
  $$ update public.projects set status = 'REVISION_REQUESTED'
     where id = avs_test.id('a_production') $$);

select avs_test.become('customer_a');

select avs_test.attempt('Invariants', 'Customer sets FINALISING directly', 'DENIED',
  $$ update public.projects set status = 'FINALISING'
     where id = avs_test.id('a_production') $$);

-- =============================================================================
-- 5. Revision: owner-only, one at a time, atomic.
-- =============================================================================
select avs_test.attempt('Revision', 'Message shorter than the minimum is rejected', 'DENIED',
  $$ select public.request_project_revision(avs_test.id('a_production'), 'too short') $$);

select avs_test.attempt('Revision', 'Owner requests a revision on their own preview', 'ALLOWED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       'The walk along the deck is too quick. Please hold a beat longer at the railing.') $$);

do $$
declare
  v_status public.project_status;
  v_open   int;
  v_total  int;
  v_asset  uuid;
  ok boolean;
begin
  perform avs_test.become_postgres();

  select status into v_status from public.projects where id = avs_test.id('a_production');
  select count(*) filter (where status = 'OPEN'), count(*)
  into v_open, v_total
  from public.project_revisions where project_id = avs_test.id('a_production');

  select preview_asset_id into v_asset
  from public.project_revisions where project_id = avs_test.id('a_production');

  -- Atomicity: the revision row and the status change are one transaction, so
  -- there is no state in which one exists without the other.
  ok := v_status = 'REVISION_REQUESTED' and v_open = 1 and v_total = 1 and v_asset is not null;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Revision', 'Creates exactly one OPEN revision, moves to REVISION_REQUESTED, links the preview',
    'ALLOWED',
    format('%s (status=%s open=%s total=%s preview_linked=%s)',
           case when ok then 'ALLOWED' else 'DENIED' end,
           v_status, v_open, v_total, v_asset is not null),
    ok);
end;
$$;

select avs_test.become('customer_a');

select avs_test.attempt('Revision', 'A second simultaneous revision request', 'DENIED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       'Actually I would also like the colour grade to be noticeably warmer throughout.') $$);

select avs_test.attempt('Revision', 'Customer edits their own revision text', 'DENIED',
  $$ update public.project_revisions set message = 'rewritten after the fact'
     where project_id = avs_test.id('a_production') $$);

select avs_test.attempt('Revision', 'Customer deletes their revision', 'DENIED',
  $$ delete from public.project_revisions where project_id = avs_test.id('a_production') $$);

select avs_test.attempt('Revision', 'Customer inserts a revision row directly', 'DENIED',
  $$ insert into public.project_revisions (project_id, user_id, message)
     values (avs_test.id('a_production'), avs_test.id('customer_a'),
             'Bypassing the RPC entirely to see whether the table accepts it.') $$);

-- =============================================================================
-- 6. Rework: a new preview answers the revision.
-- =============================================================================
select avs_test.become('admin');

select avs_test.attempt('Rework', 'Admin moves REVISION_REQUESTED to IN_PRODUCTION', 'ALLOWED',
  $$ update public.projects set status = 'IN_PRODUCTION'
     where id = avs_test.id('a_production') $$);

select avs_test.attempt('Rework', 'Admin uploads Preview 2', 'ALLOWED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'PREVIEW_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/preview-v2.mp4',
             'video/mp4', 5100000) $$);

do $$
declare v int;
begin
  select version into v from public.project_assets
  where project_id = avs_test.id('a_production')
    and asset_type = 'PREVIEW_VIDEO'
  order by version desc limit 1;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Versioning', 'Second preview is version 2, and the first still exists',
    'ALLOWED (version 2)',
    case when v = 2 then 'ALLOWED (version 2)' else format('DENIED (version %s)', v) end,
    v = 2);
end;
$$;

select avs_test.attempt('Rework', 'Admin moves back to PREVIEW_READY', 'ALLOWED',
  $$ update public.projects set status = 'PREVIEW_READY'
     where id = avs_test.id('a_production') $$);

do $$
declare v_open int; v_resolved int;
begin
  perform avs_test.become_postgres();
  select count(*) filter (where status = 'OPEN'), count(*) filter (where status = 'RESOLVED')
  into v_open, v_resolved
  from public.project_revisions where project_id = avs_test.id('a_production');

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Rework', 'The new preview resolves the open revision, keeping its history',
    'ALLOWED (0 open, 1 resolved)',
    format('%s (%s open, %s resolved)',
           case when v_open = 0 and v_resolved = 1 then 'ALLOWED' else 'DENIED' end,
           v_open, v_resolved),
    v_open = 0 and v_resolved = 1);
end;
$$;

-- =============================================================================
-- 7. Approval: owner-only, atomic, and the only route to FINALISING.
-- =============================================================================
select avs_test.become('customer_a');

select avs_test.attempt('Approval', 'Owner approves their own latest preview', 'ALLOWED',
  $$ select public.approve_preview(avs_test.id('a_production')) $$);

do $$
declare
  v_status public.project_status;
  v_approvals int;
  v_version int;
  ok boolean;
begin
  perform avs_test.become_postgres();

  select status into v_status from public.projects where id = avs_test.id('a_production');
  select count(*) into v_approvals
  from public.project_preview_approvals where project_id = avs_test.id('a_production');

  -- The approval must point at the preview the customer actually saw: the latest.
  select a.version into v_version
  from public.project_preview_approvals ap
  join public.project_assets a on a.id = ap.preview_asset_id
  where ap.project_id = avs_test.id('a_production');

  ok := v_status = 'FINALISING' and v_approvals = 1 and v_version = 2;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Approval', 'Records one approval against the latest preview and moves to FINALISING',
    'ALLOWED',
    format('%s (status=%s approvals=%s approved_version=%s)',
           case when ok then 'ALLOWED' else 'DENIED' end, v_status, v_approvals, v_version),
    ok);
end;
$$;

select avs_test.become('customer_a');

select avs_test.attempt('Approval', 'Approving twice', 'DENIED',
  $$ select public.approve_preview(avs_test.id('a_production')) $$);

select avs_test.attempt('Approval', 'Requesting a revision after approving', 'DENIED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       'Having approved it I have changed my mind about the ending entirely.') $$);

select avs_test.attempt('Approval', 'Customer inserts an approval row directly', 'DENIED',
  $$ insert into public.project_preview_approvals (project_id, user_id)
     values (avs_test.id('a_production'), avs_test.id('customer_a')) $$);

-- =============================================================================
-- 8. Completion requires something to deliver.
-- =============================================================================
select avs_test.become('admin');

select avs_test.attempt('Invariants', 'COMPLETED without a final video', 'DENIED',
  $$ update public.projects set status = 'COMPLETED'
     where id = avs_test.id('a_production') $$);

select avs_test.attempt('Delivery writes', 'Admin creates a FINAL_VIDEO', 'ALLOWED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'FINAL_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/final-v1.mp4',
             'video/mp4', 9000000) $$);

select avs_test.attempt('Invariants', 'COMPLETED once a final exists', 'ALLOWED',
  $$ update public.projects set status = 'COMPLETED'
     where id = avs_test.id('a_production') $$);

select avs_test.attempt('Invariants', 'Reopening a COMPLETED project', 'DENIED',
  $$ update public.projects set status = 'IN_PRODUCTION'
     where id = avs_test.id('a_production') $$);

-- =============================================================================
-- 9. The customer can read their own delivery media; nobody else can.
-- =============================================================================
select avs_test.become('customer_a');

select avs_test.attempt('Delivery reads', 'Owner reads their own delivery assets', 'ALLOWED',
  $$ select * from public.project_assets
     where project_id = avs_test.id('a_production')
       and asset_type in ('PREVIEW_VIDEO', 'FINAL_VIDEO') $$);

select avs_test.attempt('Delivery reads', 'Owner reads their own revisions', 'ALLOWED',
  $$ select * from public.project_revisions where project_id = avs_test.id('a_production') $$);

select avs_test.attempt('Delivery reads', 'Owner reads their own approval', 'ALLOWED',
  $$ select * from public.project_preview_approvals
     where project_id = avs_test.id('a_production') $$);

select avs_test.become('customer_b');

select avs_test.attempt('Delivery reads', 'B reads A''s preview and final rows', 'DENIED',
  $$ select * from public.project_assets
     where project_id = avs_test.id('a_production')
       and asset_type in ('PREVIEW_VIDEO', 'FINAL_VIDEO') $$);

select avs_test.attempt('Delivery reads', 'B reads A''s revisions', 'DENIED',
  $$ select * from public.project_revisions where project_id = avs_test.id('a_production') $$);

select avs_test.attempt('Delivery reads', 'B reads A''s approvals', 'DENIED',
  $$ select * from public.project_preview_approvals
     where project_id = avs_test.id('a_production') $$);

select avs_test.become_anon();

select avs_test.attempt('Delivery reads', 'Anonymous reads any delivery asset', 'DENIED',
  $$ select * from public.project_assets
     where asset_type in ('PREVIEW_VIDEO', 'FINAL_VIDEO') $$);

select avs_test.attempt('Delivery reads', 'Anonymous reads any revision', 'DENIED',
  $$ select * from public.project_revisions $$);

select avs_test.attempt('Delivery reads', 'Anonymous calls approve_preview', 'DENIED',
  $$ select public.approve_preview(avs_test.id('a_production')) $$);

select avs_test.attempt('Delivery reads', 'Anonymous calls request_project_revision', 'DENIED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'), 'An anonymous caller asking for changes to somebody''s film.') $$);

-- =============================================================================
-- 10. Delivery storage objects follow the same ownership rules.
-- =============================================================================
select avs_test.become_postgres();

insert into storage.objects (bucket_id, name, metadata)
values
  ('project-deliveries',
   'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/final-v1.mp4',
   '{"size":9000000,"mimetype":"video/mp4"}')
on conflict (bucket_id, name) do nothing;

select avs_test.become('customer_a');
select avs_test.attempt('Delivery storage', 'Owner reads their own delivery object', 'ALLOWED',
  $$ select * from storage.objects
     where bucket_id = 'project-deliveries'
       and name like 'aaaaaaaa-0000-4000-8000-00000000000a/%' $$);

select avs_test.become('customer_b');
select avs_test.attempt('Delivery storage', 'B reads A''s delivery object', 'DENIED',
  $$ select * from storage.objects
     where bucket_id = 'project-deliveries'
       and name like 'aaaaaaaa-0000-4000-8000-00000000000a/%' $$);

select avs_test.attempt('Delivery storage', 'B overwrites A''s delivery object', 'DENIED',
  $$ update storage.objects set metadata = '{"size":1,"mimetype":"video/mp4"}'
     where bucket_id = 'project-deliveries'
       and name like 'aaaaaaaa-0000-4000-8000-00000000000a/%' $$);

select avs_test.attempt('Delivery storage', 'B deletes A''s delivery object', 'DENIED',
  $$ delete from storage.objects
     where bucket_id = 'project-deliveries'
       and name like 'aaaaaaaa-0000-4000-8000-00000000000a/%' $$);

select avs_test.become_anon();
select avs_test.attempt('Delivery storage', 'Anonymous reads any delivery object', 'DENIED',
  $$ select * from storage.objects where bucket_id = 'project-deliveries' $$);

-- =============================================================================
-- 11. The audit trail survived all of it.
-- =============================================================================
do $$
declare
  path text;
  expected text := 'NULL>IN_PRODUCTION, IN_PRODUCTION>PREVIEW_READY, '
                || 'PREVIEW_READY>REVISION_REQUESTED, REVISION_REQUESTED>IN_PRODUCTION, '
                || 'IN_PRODUCTION>PREVIEW_READY, PREVIEW_READY>FINALISING, '
                || 'FINALISING>COMPLETED';
  ok boolean;
begin
  perform avs_test.become_postgres();

  select string_agg(
           coalesce(from_status::text, 'NULL') || '>' || to_status::text,
           ', ' order by created_at)
  into path
  from public.project_status_history
  where project_id = avs_test.id('a_production');

  ok := path is not distinct from expected;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Audit trail', 'Every accepted transition of the full delivery lifecycle is recorded, in order',
    'ALLOWED (' || expected || ')',
    case when ok then 'ALLOWED' else 'DENIED' end || ' (' || coalesce(path, 'no rows') || ')',
    ok);
end;
$$;

select avs_test.become_postgres();

commit;
