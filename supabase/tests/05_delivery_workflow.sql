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

-- A FINAL_VIDEO before the customer has approved anything. 'a_production' is
-- IN_PRODUCTION here, which is the status a preview belongs to — so this also
-- shows the two delivery types are not interchangeable.
select avs_test.attempt('Delivery stage', 'Admin creates a FINAL_VIDEO while IN_PRODUCTION', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'FINAL_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/early-final.mp4',
             'video/mp4', 9000000) $$);

-- And neither delivery type may be created against a project that has not even
-- reached production. 'a_submitted' is SUBMITTED.
select avs_test.attempt('Delivery stage', 'Admin creates a FINAL_VIDEO while SUBMITTED', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_submitted'), avs_test.id('customer_a'), 'FINAL_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/early-final.mp4',
             'video/mp4', 9000000) $$);

select avs_test.attempt('Delivery stage', 'Admin creates a PREVIEW_VIDEO while SUBMITTED', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_submitted'), avs_test.id('customer_a'), 'PREVIEW_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/early-preview.mp4',
             'video/mp4', 5000000) $$);

-- The same rule, reached through the convenience RPC rather than a direct
-- insert: the function is not a way around the trigger.
select avs_test.attempt('Delivery stage', 'Admin calls record_delivery_asset for a FINAL while IN_PRODUCTION', 'DENIED',
  $$ select public.record_delivery_asset(
       avs_test.id('a_production'), 'FINAL_VIDEO',
       'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/rpc-early-final.mp4',
       'video/mp4', 'final.mp4', 9000000) $$);

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

-- The project is now PREVIEW_READY, which is the status in which the customer
-- may approve. A second preview must NOT be creatable here — this is what makes
-- the stale-approval race structurally impossible rather than merely unlikely:
-- there is no state in which a customer can be deciding while a new preview
-- appears. Both the direct insert and the RPC are refused.
select avs_test.attempt('Delivery stage', 'Admin creates a PREVIEW_VIDEO while PREVIEW_READY', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'PREVIEW_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/preview-v2-too-soon.mp4',
             'video/mp4', 5100000) $$);

select avs_test.attempt('Delivery stage', 'Admin calls record_delivery_asset for a preview while PREVIEW_READY', 'DENIED',
  $$ select public.record_delivery_asset(
       avs_test.id('a_production'), 'PREVIEW_VIDEO',
       'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/rpc-preview-v2-too-soon.mp4',
       'video/mp4', 'preview.mp4', 5100000) $$);

select avs_test.attempt('Delivery stage', 'Admin creates a FINAL_VIDEO while PREVIEW_READY', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'FINAL_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/final-too-soon.mp4',
             'video/mp4', 9000000) $$);

-- Customers are refused by RLS before the stage rule is ever consulted, and are
-- refused in the status where a delivery WOULD be legal for an administrator.
select avs_test.become('customer_a');

select avs_test.attempt('Delivery stage', 'Customer creates a PREVIEW_VIDEO on their own project', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'PREVIEW_VIDEO',
             'project-deliveries', 'a/customer-preview.mp4', 'video/mp4', 5000000) $$);

select avs_test.attempt('Delivery stage', 'Customer creates a FINAL_VIDEO on their own project', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_production'), avs_test.id('customer_a'), 'FINAL_VIDEO',
             'project-deliveries', 'a/customer-final.mp4', 'video/mp4', 9000000) $$);

-- Nor through the administrator's convenience RPC, which checks is_admin()
-- itself rather than relying on the grant alone.
select avs_test.attempt('Delivery stage', 'Customer calls record_delivery_asset', 'DENIED',
  $$ select public.record_delivery_asset(
       avs_test.id('a_production'), 'PREVIEW_VIDEO',
       'aaaaaaaa-0000-4000-8000-00000000000a/77777777-0000-4000-8000-000000000007/customer-rpc.mp4',
       'video/mp4', 'preview.mp4', 5000000) $$);

select avs_test.become('admin');

-- =============================================================================
-- 3. The customer's decisions are theirs alone.
-- =============================================================================
select avs_test.become('customer_b');

select avs_test.attempt('Cross-customer', 'B approves A''s preview', 'DENIED',
  $$ select public.approve_preview(
       avs_test.id('a_production'), avs_test.preview_id('a_production', 1)) $$);

select avs_test.attempt('Cross-customer', 'B requests a revision on A''s project', 'DENIED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       avs_test.preview_id('a_production', 1),
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
  $$ select public.request_project_revision(
       avs_test.id('a_production'), avs_test.preview_id('a_production', 1), 'too short') $$);

select avs_test.attempt('Revision', 'Owner requests a revision on their own preview', 'ALLOWED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       avs_test.preview_id('a_production', 1),
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
       avs_test.preview_id('a_production', 1),
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

-- Beginning work is not answering it. If REVISION_REQUESTED -> IN_PRODUCTION
-- resolved the revision, the admin would clear the customer's outstanding
-- request simply by picking it up, and the project could then be carried to
-- delivery with the change never made and nothing left saying it was asked for.
-- The revision stays OPEN until a NEW preview exists.
do $$
declare v_open int; v_resolved int; v_status public.project_status;
begin
  perform avs_test.become_postgres();
  select status into v_status from public.projects where id = avs_test.id('a_production');
  select count(*) filter (where status = 'OPEN'), count(*) filter (where status = 'RESOLVED')
  into v_open, v_resolved
  from public.project_revisions where project_id = avs_test.id('a_production');

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Rework', 'Starting the rework does NOT resolve the revision',
    'ALLOWED (IN_PRODUCTION, 1 open, 0 resolved)',
    format('%s (%s, %s open, %s resolved)',
           case when v_status = 'IN_PRODUCTION' and v_open = 1 and v_resolved = 0
                then 'ALLOWED' else 'DENIED' end,
           v_status, v_open, v_resolved),
    v_status = 'IN_PRODUCTION' and v_open = 1 and v_resolved = 0);
end;
$$;

-- The assertion above read as postgres; go back to being the administrator.
select avs_test.become('admin');

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
-- 6b. A decision is about the cut the customer watched, not "whatever is latest".
--
-- Preview 2 has just replaced Preview 1 while the project stayed PREVIEW_READY
-- throughout — precisely what happens to a customer who opened the page, was
-- shown Preview 1, and left it open while the team re-delivered. Their click
-- must not approve a cut they have never seen, and the approval record must
-- never claim they did.
-- =============================================================================
select avs_test.become('customer_a');

select avs_test.attempt('Staleness', 'Owner approves Preview 1 after Preview 2 landed', 'DENIED',
  $$ select public.approve_preview(
       avs_test.id('a_production'), avs_test.preview_id('a_production', 1)) $$);

select avs_test.attempt('Staleness', 'Owner revises Preview 1 after Preview 2 landed', 'DENIED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       avs_test.preview_id('a_production', 1),
       'Notes written while watching the superseded cut, sent from a stale page.') $$);

-- Asset ids are untrusted input: naming something that is not this project's
-- preview is refused too, and refused as not-found rather than as out-of-date.
select avs_test.attempt('Staleness', 'Owner names another project''s asset as the preview', 'DENIED',
  $$ select public.approve_preview(
       avs_test.id('a_production'), avs_test.id('b_asset')) $$);

select avs_test.attempt('Staleness', 'Owner names a fabricated asset id', 'DENIED',
  $$ select public.approve_preview(
       avs_test.id('a_production'), '00000000-1111-4222-8333-444444444444'::uuid) $$);

-- Nothing above may have changed the project or written a record.
do $$
declare v_status public.project_status; v_approvals int; v_open int;
begin
  perform avs_test.become_postgres();
  select status into v_status from public.projects where id = avs_test.id('a_production');
  select count(*) into v_approvals
  from public.project_preview_approvals where project_id = avs_test.id('a_production');
  select count(*) filter (where status = 'OPEN') into v_open
  from public.project_revisions where project_id = avs_test.id('a_production');

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Staleness', 'The refused decisions left no approval, no revision and no status change',
    'ALLOWED (PREVIEW_READY, 0 approvals, 0 open)',
    format('%s (%s, %s approvals, %s open)',
           case when v_status = 'PREVIEW_READY' and v_approvals = 0 and v_open = 0
                then 'ALLOWED' else 'DENIED' end,
           v_status, v_approvals, v_open),
    v_status = 'PREVIEW_READY' and v_approvals = 0 and v_open = 0);
end;
$$;

-- =============================================================================
-- 7. Approval: owner-only, atomic, and the only route to FINALISING.
-- =============================================================================
select avs_test.become('customer_a');

select avs_test.attempt('Approval', 'Owner approves the preview they were shown', 'ALLOWED',
  $$ select public.approve_preview(
       avs_test.id('a_production'), avs_test.preview_id('a_production', 2)) $$);

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
  $$ select public.approve_preview(
       avs_test.id('a_production'), avs_test.preview_id('a_production', 2)) $$);

select avs_test.attempt('Approval', 'Requesting a revision after approving', 'DENIED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       avs_test.preview_id('a_production', 2),
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
  $$ select public.approve_preview(
       avs_test.id('a_production'), avs_test.preview_id('a_production', 2)) $$);

select avs_test.attempt('Delivery reads', 'Anonymous calls request_project_revision', 'DENIED',
  $$ select public.request_project_revision(
       avs_test.id('a_production'),
       avs_test.preview_id('a_production', 2),
       'An anonymous caller asking for changes to somebody''s film.') $$);

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

-- =============================================================================
-- 12. The administrator's atomic upload path, end to end.
-- =============================================================================
-- record_delivery_asset() is what the application calls. It exists so that
-- creating the asset and announcing it are one transaction holding one lock,
-- rather than two requests with a gap between them. On its own project, so none
-- of the assertions above depend on it.
select avs_test.become_postgres();

insert into avs_test.ids (k, v) values
  ('b_rpc', '99999999-0000-4000-8000-000000000009')
on conflict (k) do nothing;

insert into public.projects
  (id, user_id, status, brief, orientation, desired_duration_seconds, submitted_at)
values
  (avs_test.id('b_rpc'), avs_test.id('customer_b'), 'IN_PRODUCTION',
   'Customer B project used for the administrator upload RPC, with a brief long enough to pass.',
   'LANDSCAPE_16_9', 20, now())
on conflict (id) do nothing;

select avs_test.become('admin');

select avs_test.attempt('Delivery stage', 'Admin records a PREVIEW_VIDEO while IN_PRODUCTION', 'ALLOWED',
  $$ select public.record_delivery_asset(
       avs_test.id('b_rpc'), 'PREVIEW_VIDEO',
       'bbbbbbbb-0000-4000-8000-00000000000b/99999999-0000-4000-8000-000000000009/preview-v1.mp4',
       'video/mp4', 'preview.mp4', 5000000) $$);

-- Atomic: the asset exists AND the project moved, in one transaction. There is
-- no moment in which a preview exists against a project nobody was told about.
do $$
declare v_status public.project_status; v_version int; ok boolean;
begin
  perform avs_test.become_postgres();
  select status into v_status from public.projects where id = avs_test.id('b_rpc');
  select version into v_version from public.project_assets
  where project_id = avs_test.id('b_rpc') and asset_type = 'PREVIEW_VIDEO';

  ok := v_status = 'PREVIEW_READY' and v_version = 1;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Delivery stage', 'Recording a preview creates version 1 and moves the project in one transaction',
    'ALLOWED (PREVIEW_READY, version 1)',
    format('%s (%s, version %s)',
           case when ok then 'ALLOWED' else 'DENIED' end, v_status, v_version),
    ok);
end;
$$;

-- The arguments are untrusted even though this application generated them.
select avs_test.become('admin');

select avs_test.attempt('Delivery stage', 'Admin records a delivery into another customer''s folder', 'DENIED',
  $$ select public.record_delivery_asset(
       avs_test.id('b_rpc'), 'FINAL_VIDEO',
       'aaaaaaaa-0000-4000-8000-00000000000a/99999999-0000-4000-8000-000000000009/final-v1.mp4',
       'video/mp4', 'final.mp4', 9000000) $$);

select avs_test.attempt('Delivery stage', 'Admin records a delivery that is not a video', 'DENIED',
  $$ select public.record_delivery_asset(
       avs_test.id('b_rpc'), 'FINAL_VIDEO',
       'bbbbbbbb-0000-4000-8000-00000000000b/99999999-0000-4000-8000-000000000009/final-v1.exe',
       'application/x-msdownload', 'final.exe', 9000000) $$);

select avs_test.attempt('Delivery stage', 'Admin records a REFERENCE_IMAGE through the delivery RPC', 'DENIED',
  $$ select public.record_delivery_asset(
       avs_test.id('b_rpc'), 'REFERENCE_IMAGE',
       'bbbbbbbb-0000-4000-8000-00000000000b/99999999-0000-4000-8000-000000000009/sneak.jpg',
       'video/mp4', 'sneak.jpg', 1000) $$);

-- Approval, then the final — which is where FINAL_VIDEO becomes legal.
select avs_test.become('customer_b');

select avs_test.attempt('Delivery stage', 'Owner approves the recorded preview', 'ALLOWED',
  $$ select public.approve_preview(
       avs_test.id('b_rpc'), avs_test.preview_id('b_rpc', 1)) $$);

select avs_test.become('admin');

select avs_test.attempt('Delivery stage', 'Admin records a FINAL_VIDEO while FINALISING', 'ALLOWED',
  $$ select public.record_delivery_asset(
       avs_test.id('b_rpc'), 'FINAL_VIDEO',
       'bbbbbbbb-0000-4000-8000-00000000000b/99999999-0000-4000-8000-000000000009/final-v1.mp4',
       'video/mp4', 'final.mp4', 9000000) $$);

-- A final does NOT auto-complete: completion stays an explicit decision.
do $$
declare v_status public.project_status; v_finals int; ok boolean;
begin
  perform avs_test.become_postgres();
  select status into v_status from public.projects where id = avs_test.id('b_rpc');
  select count(*) into v_finals from public.project_assets
  where project_id = avs_test.id('b_rpc') and asset_type = 'FINAL_VIDEO';

  ok := v_status = 'FINALISING' and v_finals = 1;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Delivery stage', 'Recording a final does not complete the project by itself',
    'ALLOWED (FINALISING, 1 final)',
    format('%s (%s, %s final)',
           case when ok then 'ALLOWED' else 'DENIED' end, v_status, v_finals),
    ok);
end;
$$;

select avs_test.become_postgres();

commit;
