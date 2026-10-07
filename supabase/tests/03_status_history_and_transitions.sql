-- =============================================================================
-- Status history trigger + transition guard, under RLS.
-- =============================================================================
-- The architecture claims project_status_history has no client write policy and
-- is populated exclusively by a SECURITY DEFINER trigger. That is only credible
-- if the trigger actually succeeds while running as an ordinary `authenticated`
-- user whose role has no INSERT grant on that table. This proves both halves.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A customer submitting their own draft: DRAFT -> SUBMITTED
-- -----------------------------------------------------------------------------
select avs_test.become('customer_a');

select avs_test.attempt('Transition', 'Customer submits own draft (DRAFT→SUBMITTED)', 'ALLOWED',
  $$ select public.submit_project(avs_test.id('a_draft'),true,true,false) $$);

-- The history row must exist even though `authenticated` cannot insert into that
-- table itself — that is the whole point of the SECURITY DEFINER trigger.
do $$
declare
  n int;
  actual text;
begin
  select count(*) into n
  from public.project_status_history
  where project_id = avs_test.id('a_draft')
    and from_status = 'DRAFT' and to_status = 'SUBMITTED'
    and changed_by = avs_test.id('customer_a');

  actual := case when n = 1 then 'ALLOWED (1 row)' else format('DENIED (%s rows)', n) end;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Trigger', 'History row auto-created for DRAFT→SUBMITTED, attributed to the customer',
    'ALLOWED', actual, n = 1);
end;
$$;

-- -----------------------------------------------------------------------------
-- Customers cannot drive the production workflow
-- -----------------------------------------------------------------------------
select avs_test.attempt('Transition', 'Customer moves own project SUBMITTED→ASSETS_REVIEW', 'DENIED',
  $$ update public.projects set status = 'ASSETS_REVIEW' where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Transition', 'Customer moves own project SUBMITTED→COMPLETED', 'DENIED',
  $$ update public.projects set status = 'COMPLETED' where id = avs_test.id('a_submitted') $$);

-- -----------------------------------------------------------------------------
-- Admin driving the permitted workflow
-- -----------------------------------------------------------------------------
select avs_test.become('admin');

select avs_test.attempt('Transition', 'Admin SUBMITTED→ASSETS_REVIEW (permitted)', 'ALLOWED',
  $$ update public.projects set status = 'ASSETS_REVIEW' where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Transition', 'Admin ASSETS_REVIEW→IN_PRODUCTION (permitted)', 'ALLOWED',
  $$ update public.projects set status = 'IN_PRODUCTION' where id = avs_test.id('a_submitted') $$);

-- From 20260101000600 onwards a preview must exist before a project can claim
-- to have one. The transition is permitted by the workflow table and still
-- refused, because the invariant is a separate check.
select avs_test.attempt('Transition', 'Admin IN_PRODUCTION→PREVIEW_READY with no preview uploaded', 'DENIED',
  $$ update public.projects set status = 'PREVIEW_READY' where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Transition', 'Admin uploads a preview', 'ALLOWED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_submitted'), avs_test.id('customer_a'), 'PREVIEW_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/preview-v1.mp4',
             'video/mp4', 4000000) $$);

select avs_test.attempt('Transition', 'Admin IN_PRODUCTION→PREVIEW_READY once a preview exists', 'ALLOWED',
  $$ update public.projects set status = 'PREVIEW_READY' where id = avs_test.id('a_submitted') $$);

-- The guard added in 20260101000400: skipping stages is refused by the database,
-- not merely by the buttons the admin UI chooses to render.
select avs_test.attempt('Transition', 'Admin PREVIEW_READY→SUBMITTED (backwards, not permitted)', 'DENIED',
  $$ update public.projects set status = 'SUBMITTED' where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Transition', 'Admin PREVIEW_READY→DRAFT (would re-open to the customer)', 'DENIED',
  $$ update public.projects set status = 'DRAFT' where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Transition', 'Admin B: SUBMITTED→COMPLETED (skips production)', 'DENIED',
  $$ update public.projects set status = 'COMPLETED' where id = avs_test.id('b_submitted') $$);

-- Stricter than Milestone 1.5, where this was permitted: completion must now go
-- through the customer's approval and FINALISING, so the shortcut is gone.
select avs_test.attempt('Transition', 'Admin PREVIEW_READY→COMPLETED (skips customer approval)', 'DENIED',
  $$ update public.projects set status = 'COMPLETED' where id = avs_test.id('a_submitted') $$);

-- The rest of the lifecycle: approval is the customer's, completion needs a final.
select avs_test.become('customer_a');
select avs_test.attempt('Transition', 'Customer approves the preview (PREVIEW_READY→FINALISING)', 'ALLOWED',
  $$ select public.approve_preview(
       avs_test.id('a_submitted'), avs_test.preview_id('a_submitted', 1)) $$);

select avs_test.become('admin');
select avs_test.attempt('Transition', 'Admin FINALISING→COMPLETED with no final video', 'DENIED',
  $$ update public.projects set status = 'COMPLETED' where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Transition', 'Admin uploads the final video', 'ALLOWED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_submitted'), avs_test.id('customer_a'), 'FINAL_VIDEO',
             'project-deliveries',
             'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/final-v1.mp4',
             'video/mp4', 8000000) $$);

select avs_test.attempt('Transition', 'Admin FINALISING→COMPLETED once a final exists', 'ALLOWED',
  $$ update public.projects set status = 'COMPLETED' where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Transition', 'Admin reopens a COMPLETED project (final status)', 'DENIED',
  $$ update public.projects set status = 'IN_PRODUCTION' where id = avs_test.id('a_submitted') $$);

-- -----------------------------------------------------------------------------
-- The audit trail recorded every accepted move, and no rejected one
-- -----------------------------------------------------------------------------
do $$
declare
  path     text;
  -- Fixtures now upload reference objects while DRAFT, then submit. Include
  -- both transitions in the expected audit trail.
  expected text := 'NULL>DRAFT, DRAFT>SUBMITTED, SUBMITTED>ASSETS_REVIEW, '
                || 'ASSETS_REVIEW>IN_PRODUCTION, IN_PRODUCTION>PREVIEW_READY, '
                || 'PREVIEW_READY>FINALISING, FINALISING>COMPLETED';
  ok boolean;
begin
  select string_agg(
           coalesce(from_status::text, 'NULL') || '>' || to_status::text,
           ', ' order by created_at
         )
  into path
  from public.project_status_history
  where project_id = avs_test.id('a_submitted');

  ok := path is not distinct from expected;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Trigger', 'Audit trail records every accepted transition, in order',
    'ALLOWED (' || expected || ')',
    case when ok then 'ALLOWED' else 'DENIED' end || ' (' || coalesce(path, 'no rows') || ')',
    ok);
end;
$$;

-- Rejected transitions must leave no trace at all.
do $$
declare
  n int;
begin
  select count(*) into n from public.project_status_history
  where project_id = avs_test.id('b_submitted') and to_status = 'COMPLETED';

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Trigger', 'Rejected transition wrote no history row',
    'DENIED', case when n = 0 then 'DENIED (0 rows)' else format('ALLOWED (%s rows)', n) end, n = 0);
end;
$$;

select avs_test.become_postgres();

commit;
