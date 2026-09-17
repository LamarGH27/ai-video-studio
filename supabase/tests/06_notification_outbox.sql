-- =============================================================================
-- Transactional notification outbox — workflow, idempotency and access.
-- =============================================================================
-- Runs as real `anon` / `authenticated` roles carrying a JWT claim set, exactly
-- as PostgREST presents a request. Nothing here goes through application code.
--
-- What it has to establish:
--   * business events create the right notifications, and only those
--   * the same event twice is still one notification
--   * customers cannot read, write or alter any of it
--   * the worker's claim/complete/fail cycle behaves, including the retry
--     schedule and the point at which it gives up
--   * nothing that looks like a signed URL can be stored
-- =============================================================================

begin;

-- avs_test.attempt() deliberately refuses to run as a superuser, because a
-- superuser bypasses RLS and every "DENIED" would be a false pass. Constraint
-- tests are the one thing that genuinely must run on a direct connection: as any
-- application role the INSERT is refused by RLS before the constraint is
-- consulted, so the constraint itself would never be exercised. This records
-- them separately, and only ever expects a raise.
create or replace function avs_test.expect_rejected(
  p_area text, p_attack text, p_sql text
) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    insert into avs_test.results (area, attack, expected, actual, pass)
    values (p_area, p_attack, 'DENIED (constraint)', 'ALLOWED (accepted)', false);
  exception when others then
    insert into avs_test.results (area, attack, expected, actual, pass)
    values (p_area, p_attack, 'DENIED (constraint)',
            format('DENIED (SQLSTATE %s)', sqlstate), true);
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixtures: a project of A's that we drive through the whole workflow.
-- -----------------------------------------------------------------------------
insert into avs_test.ids (k, v) values
  ('n_project', 'dddddddd-0000-4000-8000-00000000000d')
on conflict (k) do nothing;

insert into public.projects
  (id, user_id, status, brief, orientation, desired_duration_seconds)
values
  (avs_test.id('n_project'), avs_test.id('customer_a'), 'DRAFT',
   'Notification fixture project, with a brief long enough to satisfy the length constraint.',
   'VERTICAL_9_16', 15);

-- =============================================================================
-- 1. Submission enqueues exactly two notifications, addressed correctly.
-- =============================================================================
select avs_test.become('customer_a');

select avs_test.attempt('Notifications', 'Owner submits their own project', 'ALLOWED',
  $$ select public.submit_project(avs_test.id('n_project'),true,true,false)
     from (select avs_test.prepare_submission(avs_test.id('n_project'))) prepared $$);

do $$
declare
  v_customer int; v_admin int; v_email text; v_admin_email text; v_ref text; ok boolean;
begin
  perform avs_test.become_postgres();

  select count(*) filter (where event_type = 'PROJECT_SUBMITTED_CUSTOMER'),
         count(*) filter (where event_type = 'PROJECT_SUBMITTED_ADMIN')
  into v_customer, v_admin
  from public.notification_outbox where project_id = avs_test.id('n_project');

  -- The customer's address comes from auth.users, inside the trigger. Nothing
  -- the browser sent can influence it, because nothing the browser sends
  -- reaches this table at all.
  select recipient_email into v_email from public.notification_outbox
  where project_id = avs_test.id('n_project') and event_type = 'PROJECT_SUBMITTED_CUSTOMER';

  -- The admin row is deliberately unaddressed: the worker resolves staff mail
  -- from configuration, so the database never learns who the team are.
  select recipient_email into v_admin_email from public.notification_outbox
  where project_id = avs_test.id('n_project') and event_type = 'PROJECT_SUBMITTED_ADMIN';

  select payload ->> 'reference' into v_ref from public.notification_outbox
  where project_id = avs_test.id('n_project') and event_type = 'PROJECT_SUBMITTED_CUSTOMER';

  ok := v_customer = 1 and v_admin = 1
        and v_email = 'customer-a@test.invalid'
        and v_admin_email is null
        and v_ref ~ '^AVS-[0-9]{6}$';

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications', 'DRAFT->SUBMITTED enqueues one customer and one admin notification',
    'ALLOWED (customer=1 admin=1 addressed from auth.users, admin unaddressed, public reference)',
    format('%s (customer=%s admin=%s email=%s admin_email=%s ref=%s)',
           case when ok then 'ALLOWED' else 'DENIED' end,
           v_customer, v_admin, coalesce(v_email,'null'),
           coalesce(v_admin_email,'null'), coalesce(v_ref,'null')),
    ok);
end;
$$;

-- =============================================================================
-- 2. The same business event cannot produce a second email.
-- =============================================================================
-- Replaying an event is not hypothetical: a retried action, a double submit, a
-- re-run E2E suite and a redeployed worker all do it. Uniqueness on the dedupe
-- key is what makes the second one a no-op.
do $$
declare v_before int; v_after int; v_id uuid;
begin
  perform avs_test.become_postgres();
  select count(*) into v_before from public.notification_outbox
  where project_id = avs_test.id('n_project');

  -- Exactly what the trigger does, called again by hand.
  select public.enqueue_notification(
    'PROJECT_SUBMITTED_CUSTOMER', 'CUSTOMER', avs_test.id('n_project'),
    format('project:%s:submitted:customer', avs_test.id('n_project'))) into v_id;

  select count(*) into v_after from public.notification_outbox
  where project_id = avs_test.id('n_project');

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications', 'Re-enqueuing the same event creates no second notification',
    'ALLOWED (no new row, no id returned)',
    format('%s (%s -> %s rows, returned %s)',
           case when v_after = v_before and v_id is null then 'ALLOWED' else 'DENIED' end,
           v_before, v_after, coalesce(v_id::text, 'null')),
    v_after = v_before and v_id is null);
end;
$$;

-- A direct insert of a duplicate key must fail even for a superuser: the
-- guarantee is a constraint, not a convention.
select avs_test.expect_rejected('Notifications', 'Direct insert of a duplicate dedupe key',
  $$ insert into public.notification_outbox
       (event_type, recipient, project_id, dedupe_key)
     values ('PROJECT_SUBMITTED_ADMIN', 'ADMIN', avs_test.id('n_project'),
             format('project:%s:submitted:admin', avs_test.id('n_project'))) $$);

-- =============================================================================
-- 3. A signed URL can never be stored.
-- =============================================================================
-- Signed media URLs expire. An outbox row may be read minutes or days after it
-- was written, and then emailed — which would turn a short-lived credential
-- into a durable one sitting in an inbox. The constraint refuses, so a future
-- change that forgets cannot quietly reintroduce it.
select avs_test.expect_rejected('Notifications', 'Payload containing a signed storage URL',
  $$ insert into public.notification_outbox
       (event_type, recipient, project_id, dedupe_key, payload)
     values ('PREVIEW_READY_CUSTOMER', 'ADMIN', avs_test.id('n_project'),
             'payload-with-signed-url',
             jsonb_build_object('url',
               'https://x.supabase.co/storage/v1/object/sign/p/a.mp4?token=abc')) $$);

select avs_test.expect_rejected('Notifications', 'Payload containing any http link',
  $$ insert into public.notification_outbox
       (event_type, recipient, project_id, dedupe_key, payload)
     values ('PREVIEW_READY_CUSTOMER', 'ADMIN', avs_test.id('n_project'),
             'payload-with-link', jsonb_build_object('cta', 'http://example.com/x')) $$);

-- And nothing the real triggers wrote contains one either.
do $$
declare v_bad int;
begin
  perform avs_test.become_postgres();
  select count(*) into v_bad from public.notification_outbox
  where payload::text ~* '(https?://|/storage/v1/|token=)';

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications', 'No notification written by the workflow contains a URL or token',
    'ALLOWED (0 rows)', format('%s (%s rows)',
      case when v_bad = 0 then 'ALLOWED' else 'DENIED' end, v_bad),
    v_bad = 0);
end;
$$;

-- =============================================================================
-- 4. Customers cannot see, create or alter notifications. Neither can anon.
-- =============================================================================
select avs_test.become('customer_a');

select avs_test.attempt('Notifications', 'Customer reads their OWN notifications', 'DENIED',
  $$ select * from public.notification_outbox
     where recipient_user_id = avs_test.id('customer_a') $$);

select avs_test.attempt('Notifications', 'Customer reads the whole outbox', 'DENIED',
  $$ select * from public.notification_outbox $$);

select avs_test.attempt('Notifications', 'Customer inserts an arbitrary notification', 'DENIED',
  $$ insert into public.notification_outbox
       (event_type, recipient, recipient_user_id, recipient_email, project_id, dedupe_key)
     values ('FINAL_VIDEO_READY_CUSTOMER', 'CUSTOMER', avs_test.id('customer_a'),
             'attacker@evil.invalid', avs_test.id('n_project'), 'forged-key') $$);

select avs_test.attempt('Notifications', 'Customer marks a notification SENT to suppress it', 'DENIED',
  $$ update public.notification_outbox set status = 'SENT', sent_at = now()
     where project_id = avs_test.id('n_project') $$);

select avs_test.attempt('Notifications', 'Customer redirects a notification to another address', 'DENIED',
  $$ update public.notification_outbox set recipient_email = 'attacker@evil.invalid'
     where project_id = avs_test.id('n_project') $$);

select avs_test.attempt('Notifications', 'Customer deletes their notification history', 'DENIED',
  $$ delete from public.notification_outbox where project_id = avs_test.id('n_project') $$);

-- The quietest attack on a notification system is not forging a message, it is
-- taking the dedupe key first so the real one is never created. enqueue is
-- SECURITY DEFINER, so being able to call it at all would be enough.
select avs_test.attempt('Notifications', 'Customer enqueues a notification directly', 'DENIED',
  $$ select public.enqueue_notification(
       'FINAL_VIDEO_READY_CUSTOMER', 'CUSTOMER', avs_test.id('n_project'),
       'forged-by-customer') $$);

select avs_test.attempt('Notifications', 'Customer pre-claims a dedupe key the workflow will need', 'DENIED',
  $$ select public.enqueue_notification(
       'FINAL_VIDEO_READY_CUSTOMER', 'CUSTOMER', avs_test.id('n_project'),
       format('project:%s:completed:customer', avs_test.id('n_project'))) $$);

select avs_test.attempt('Notifications', 'Customer claims the queue', 'DENIED',
  $$ select * from public.claim_notifications(10, 300) $$);

select avs_test.attempt('Notifications', 'Customer marks a notification sent through the RPC', 'DENIED',
  $$ select public.mark_notification_sent(
       (select id from public.notification_outbox limit 1), 'x') $$);

select avs_test.attempt('Notifications', 'Customer fails a notification out of its retry budget', 'DENIED',
  $$ select public.mark_notification_failed(
       (select id from public.notification_outbox limit 1), 'x', true) $$);

select avs_test.attempt('Notifications', 'Customer requeues a notification', 'DENIED',
  $$ select public.retry_notification(
       (select id from public.notification_outbox limit 1)) $$);

select avs_test.become('customer_b');

select avs_test.attempt('Notifications', 'B reads A''s notifications', 'DENIED',
  $$ select * from public.notification_outbox
     where recipient_user_id = avs_test.id('customer_a') $$);

select avs_test.become_anon();

select avs_test.attempt('Notifications', 'Anonymous reads the outbox', 'DENIED',
  $$ select * from public.notification_outbox $$);

select avs_test.attempt('Notifications', 'Anonymous claims the queue', 'DENIED',
  $$ select * from public.claim_notifications(10, 300) $$);

select avs_test.attempt('Notifications', 'Anonymous enqueues a notification', 'DENIED',
  $$ select public.enqueue_notification(
       'PROJECT_SUBMITTED_ADMIN', 'ADMIN', avs_test.id('n_project'), 'anon-forged') $$);

-- =============================================================================
-- 5. Admin visibility: read yes, write no.
-- =============================================================================
select avs_test.become('admin');

select avs_test.attempt('Notifications', 'Admin reads the outbox', 'ALLOWED',
  $$ select * from public.notification_outbox where project_id = avs_test.id('n_project') $$);

select avs_test.attempt('Notifications', 'Admin edits a notification row directly', 'DENIED',
  $$ update public.notification_outbox set status = 'SENT', sent_at = now()
     where project_id = avs_test.id('n_project') $$);

select avs_test.attempt('Notifications', 'Admin inserts a notification directly', 'DENIED',
  $$ insert into public.notification_outbox
       (event_type, recipient, project_id, dedupe_key)
     values ('PROJECT_SUBMITTED_ADMIN', 'ADMIN', avs_test.id('n_project'), 'admin-forged') $$);

select avs_test.attempt('Notifications', 'Admin deletes a notification', 'DENIED',
  $$ delete from public.notification_outbox where project_id = avs_test.id('n_project') $$);

-- Even an admin cannot run the queue: that is the worker's credential, not a
-- session's. is_admin() is not a way in.
select avs_test.attempt('Notifications', 'Admin claims the queue', 'DENIED',
  $$ select * from public.claim_notifications(10, 300) $$);

-- =============================================================================
-- 6. The rest of the workflow enqueues the right things, and nothing else.
-- =============================================================================
select avs_test.become('admin');

select avs_test.attempt('Notifications', 'Admin moves to Assets in review', 'ALLOWED',
  $$ update public.projects set status = 'ASSETS_REVIEW'
     where id = avs_test.id('n_project') $$);

select avs_test.attempt('Notifications', 'Admin moves to In production', 'ALLOWED',
  $$ update public.projects set status = 'IN_PRODUCTION'
     where id = avs_test.id('n_project') $$);

-- Internal production stages are not events. A customer told about every queue
-- their project passes through stops reading the messages that matter.
do $$
declare v_count int;
begin
  perform avs_test.become_postgres();
  select count(*) into v_count from public.notification_outbox
  where project_id = avs_test.id('n_project');

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications', 'ASSETS_REVIEW and IN_PRODUCTION produce no notifications',
    'ALLOWED (still 2)', format('%s (%s)',
      case when v_count = 2 then 'ALLOWED' else 'DENIED' end, v_count),
    v_count = 2);
end;
$$;

select avs_test.become('admin');

select avs_test.attempt('Notifications', 'Admin uploads Preview 1', 'ALLOWED',
  $$ select public.record_delivery_asset(
       avs_test.id('n_project'), 'PREVIEW_VIDEO',
       'aaaaaaaa-0000-4000-8000-00000000000a/dddddddd-0000-4000-8000-00000000000d/preview-v1.mp4',
       'video/mp4', 'preview.mp4', 5000000) $$);

do $$
declare v_type text; v_key text; v_asset uuid; ok boolean;
begin
  perform avs_test.become_postgres();
  select a.id into v_asset from public.project_assets a
  where a.project_id = avs_test.id('n_project') and a.asset_type = 'PREVIEW_VIDEO';

  select event_type::text, dedupe_key into v_type, v_key
  from public.notification_outbox
  where project_id = avs_test.id('n_project')
    and event_type in ('PREVIEW_READY_CUSTOMER', 'PREVIEW_REVISED_CUSTOMER');

  -- Keyed on the asset, so a re-announced preview is the same notification and
  -- a genuinely new preview is a new one.
  ok := v_type = 'PREVIEW_READY_CUSTOMER'
        and v_key = format('project:%s:preview:%s:ready', avs_test.id('n_project'), v_asset);

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications', 'A first preview enqueues PREVIEW_READY_CUSTOMER keyed on the asset',
    'ALLOWED', format('%s (%s)', case when ok then 'ALLOWED' else 'DENIED' end,
                      coalesce(v_type, 'none')),
    ok);
end;
$$;

-- A revision: the team is told, and the customer's words are not in the email.
select avs_test.become('customer_a');

select avs_test.attempt('Notifications', 'Customer requests a revision', 'ALLOWED',
  $$ select public.request_project_revision(
       avs_test.id('n_project'), avs_test.preview_id('n_project', 1),
       'Please hold a beat longer at the railing before the camera moves on, it is slightly quick.') $$);

do $$
declare v_count int; v_recipient text; v_payload jsonb; ok boolean;
begin
  perform avs_test.become_postgres();
  select count(*) into v_count
  from public.notification_outbox
  where project_id = avs_test.id('n_project') and event_type = 'REVISION_REQUESTED_ADMIN';

  select recipient::text, payload into v_recipient, v_payload
  from public.notification_outbox
  where project_id = avs_test.id('n_project') and event_type = 'REVISION_REQUESTED_ADMIN'
  limit 1;

  -- The revision message must not travel to an inbox. It is the customer's
  -- words about their own film; the admin reads it in the portal.
  ok := v_count = 1 and v_recipient = 'ADMIN'
        and v_payload::text not ilike '%railing%';

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications', 'A revision notifies the team without carrying the message',
    'ALLOWED (1 admin row, message not in payload)',
    format('%s (%s rows, %s, payload=%s)',
           case when ok then 'ALLOWED' else 'DENIED' end,
           v_count, coalesce(v_recipient,'none'), coalesce(v_payload::text,'null')),
    ok);
end;
$$;

-- Rework, then a replacement preview: different wording, different notification.
select avs_test.become('admin');

select avs_test.attempt('Notifications', 'Admin begins the rework', 'ALLOWED',
  $$ update public.projects set status = 'IN_PRODUCTION'
     where id = avs_test.id('n_project') $$);

select avs_test.attempt('Notifications', 'Admin uploads Preview 2', 'ALLOWED',
  $$ select public.record_delivery_asset(
       avs_test.id('n_project'), 'PREVIEW_VIDEO',
       'aaaaaaaa-0000-4000-8000-00000000000a/dddddddd-0000-4000-8000-00000000000d/preview-v2.mp4',
       'video/mp4', 'preview.mp4', 5100000) $$);

do $$
declare v_count int; v_version int; ok boolean;
begin
  perform avs_test.become_postgres();
  select count(*) into v_count from public.notification_outbox
  where project_id = avs_test.id('n_project') and event_type = 'PREVIEW_REVISED_CUSTOMER';

  select (payload ->> 'previewVersion')::int into v_version
  from public.notification_outbox
  where project_id = avs_test.id('n_project') and event_type = 'PREVIEW_REVISED_CUSTOMER';

  ok := v_count = 1 and v_version = 2;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications', 'A replacement preview enqueues the revised wording, not the first-preview one',
    'ALLOWED (1 revised row, version 2)',
    format('%s (%s rows, version %s)',
           case when ok then 'ALLOWED' else 'DENIED' end, v_count, coalesce(v_version, -1)),
    ok);
end;
$$;

-- Approval: a receipt for the customer, a go-ahead for the team.
select avs_test.become('customer_a');

select avs_test.attempt('Notifications', 'Customer approves Preview 2', 'ALLOWED',
  $$ select public.approve_preview(
       avs_test.id('n_project'), avs_test.preview_id('n_project', 2)) $$);

select avs_test.become('admin');

select avs_test.attempt('Notifications', 'Admin uploads the final video', 'ALLOWED',
  $$ select public.record_delivery_asset(
       avs_test.id('n_project'), 'FINAL_VIDEO',
       'aaaaaaaa-0000-4000-8000-00000000000a/dddddddd-0000-4000-8000-00000000000d/final-v1.mp4',
       'video/mp4', 'final.mp4', 9000000) $$);

select avs_test.attempt('Notifications', 'Admin completes the project', 'ALLOWED',
  $$ update public.projects set status = 'COMPLETED'
     where id = avs_test.id('n_project') $$);

do $$
declare v_events text; expected text; ok boolean;
begin
  perform avs_test.become_postgres();
  -- Sorted by name, not by time: created_at defaults to now(), which is
  -- transaction time, so rows enqueued by one statement tie and any time
  -- ordering between them would be arbitrary. What matters is the set.
  select string_agg(event_type::text, ', ' order by event_type::text)
  into v_events
  from public.notification_outbox where project_id = avs_test.id('n_project');

  expected := 'FINAL_VIDEO_READY_CUSTOMER, PREVIEW_APPROVED_ADMIN, PREVIEW_APPROVED_CUSTOMER, '
           || 'PREVIEW_READY_CUSTOMER, PREVIEW_REVISED_CUSTOMER, PROJECT_SUBMITTED_ADMIN, '
           || 'PROJECT_SUBMITTED_CUSTOMER, REVISION_REQUESTED_ADMIN';

  ok := v_events is not distinct from expected;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications', 'The whole lifecycle enqueues exactly the eight intended notifications',
    'ALLOWED (' || expected || ')',
    case when ok then 'ALLOWED' else 'DENIED' end || ' (' || coalesce(v_events, 'none') || ')',
    ok);
end;
$$;

-- =============================================================================
-- 7. The worker's cycle: claim, succeed, fail, back off, give up.
-- =============================================================================
-- These act as `postgres`, which is what the worker's credential resolves to.
-- The access tests above already proved no session role can reach them.
do $$
declare
  v_first uuid; v_second uuid; v_status text; v_attempts int; v_next timestamptz;
  v_claimed int;
begin
  perform avs_test.become_postgres();

  -- Claim once: a bounded batch, all of it due.
  create temporary table avs_claim_1 on commit drop as
    select * from public.claim_notifications(3, 300);

  select count(*) into v_claimed from avs_claim_1;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications worker', 'A claim takes a bounded batch and marks it PROCESSING',
    'ALLOWED (3 rows)', format('%s (%s rows)',
      case when v_claimed = 3 then 'ALLOWED' else 'DENIED' end, v_claimed),
    v_claimed = 3);

  -- A second claim in the same transaction must not hand back the same rows:
  -- they are leased, so they are no longer due.
  create temporary table avs_claim_2 on commit drop as
    select * from public.claim_notifications(3, 300);

  select count(*) into v_claimed
  from avs_claim_2 where id in (select id from avs_claim_1);

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications worker', 'A second claim never returns a row the first one holds',
    'ALLOWED (0 overlapping)', format('%s (%s overlapping)',
      case when v_claimed = 0 then 'ALLOWED' else 'DENIED' end, v_claimed),
    v_claimed = 0);

  select id into v_first from avs_claim_1 order by id limit 1;

  -- Success is terminal.
  perform public.mark_notification_sent(v_first, 'resend-msg-1');
  select status::text, next_attempt_at into v_status, v_next
  from public.notification_outbox where id = v_first;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications worker', 'A delivered notification becomes SENT and is never due again',
    'ALLOWED (SENT, no next attempt)',
    format('%s (%s, next=%s)',
           case when v_status = 'SENT' and v_next is null then 'ALLOWED' else 'DENIED' end,
           v_status, coalesce(v_next::text, 'null')),
    v_status = 'SENT' and v_next is null);

  -- And a SENT row is not picked up again, however many times the worker runs.
  select count(*) into v_claimed
  from public.claim_notifications(50, 300) where id = v_first;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications worker', 'A SENT notification is never claimed again',
    'ALLOWED (0)', format('%s (%s)',
      case when v_claimed = 0 then 'ALLOWED' else 'DENIED' end, v_claimed),
    v_claimed = 0);

  -- Failure is retryable, and the delay comes from the schedule.
  select id into v_second from avs_claim_1 where id <> v_first order by id limit 1;
  perform public.mark_notification_failed(v_second, 'Provider responded 503: upstream', false);

  select status::text, attempt_count, next_attempt_at
  into v_status, v_attempts, v_next
  from public.notification_outbox where id = v_second;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications worker', 'A transient failure stays retryable, one minute out',
    'ALLOWED (FAILED, attempt 1, due in ~1 minute)',
    format('%s (%s, attempt %s, due in %s)',
           case when v_status = 'FAILED' and v_attempts = 1
                     and v_next between now() + interval '50 seconds'
                                     and now() + interval '70 seconds'
                then 'ALLOWED' else 'DENIED' end,
           v_status, v_attempts, coalesce((v_next - now())::text, 'never')),
    v_status = 'FAILED' and v_attempts = 1
      and v_next between now() + interval '50 seconds' and now() + interval '70 seconds');

  -- A permanent failure does not wait for four more attempts to say the same thing.
  perform public.mark_notification_failed(v_second, 'Provider responded 422: invalid address', true);
  select next_attempt_at into v_next from public.notification_outbox where id = v_second;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications worker', 'A permanent failure stops immediately',
    'ALLOWED (never due again)',
    format('%s (next=%s)', case when v_next is null then 'ALLOWED' else 'DENIED' end,
           coalesce(v_next::text, 'null')),
    v_next is null);
end;
$$;

-- Exhausting the budget: five attempts and no more, ever.
do $$
declare v_id uuid; v_attempts int; v_next timestamptz; v_claimable int; i int;
begin
  perform avs_test.become_postgres();

  select id into v_id from public.notification_outbox
  where status <> 'SENT'
  order by created_at limit 1;

  if v_id is null then
    raise exception 'fixture error: no unsent notification to exhaust';
  end if;

  -- Start it from a clean budget so the loop below is the only thing that
  -- spends it, whatever the earlier claims left behind.
  update public.notification_outbox
  set status = 'PENDING', attempt_count = 0, next_attempt_at = now(), claimed_at = null
  where id = v_id;

  for i in 1..public.notification_max_attempts() loop
    update public.notification_outbox set next_attempt_at = now() where id = v_id;
    perform public.claim_notifications(50, 300);
    perform public.mark_notification_failed(v_id, format('Attempt %s failed', i), false);
  end loop;

  select attempt_count, next_attempt_at into v_attempts, v_next
  from public.notification_outbox where id = v_id;

  -- Even if something set it due again, the claim refuses on attempt count.
  update public.notification_outbox set next_attempt_at = now() where id = v_id;
  select count(*) into v_claimable
  from public.claim_notifications(50, 300) where id = v_id;

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications worker', 'Retrying stops after the maximum attempts, and stays stopped',
    'ALLOWED (5 attempts, never due, not claimable)',
    format('%s (%s attempts, next=%s, claimable=%s)',
           case when v_attempts = 5 and v_next is null and v_claimable = 0
                then 'ALLOWED' else 'DENIED' end,
           v_attempts, coalesce(v_next::text, 'null'), v_claimable),
    v_attempts = 5 and v_next is null and v_claimable = 0);
end;
$$;

-- An operator can give it another budget, without creating a second email.
do $$
declare v_id uuid; v_key text; v_rows_before int; v_rows_after int;
        v_status text; v_attempts int; ok boolean;
begin
  perform avs_test.become_postgres();
  select id, dedupe_key into v_id, v_key from public.notification_outbox
  where status = 'FAILED' and attempt_count >= public.notification_max_attempts()
  order by created_at limit 1;

  if v_id is null then
    raise exception 'fixture error: no exhausted notification to retry';
  end if;

  select count(*) into v_rows_before from public.notification_outbox;

  perform avs_test.become('admin');
  perform public.retry_notification(v_id);

  perform avs_test.become_postgres();
  select count(*) into v_rows_after from public.notification_outbox;
  select status::text, attempt_count into v_status, v_attempts
  from public.notification_outbox where id = v_id;

  -- The same row, requeued. A retry that inserted would silently discard the
  -- one-email-per-event guarantee at the exact moment someone is fixing things.
  ok := v_rows_after = v_rows_before and v_status = 'PENDING' and v_attempts = 0
        and exists (select 1 from public.notification_outbox
                    where id = v_id and dedupe_key = v_key);

  insert into avs_test.results (area, attack, expected, actual, pass) values (
    'Notifications worker', 'An admin retry reuses the same row and keeps its dedupe key',
    'ALLOWED (no new row, PENDING, attempts reset)',
    format('%s (%s -> %s rows, %s, %s attempts)',
           case when ok then 'ALLOWED' else 'DENIED' end,
           v_rows_before, v_rows_after, v_status, v_attempts),
    ok);
end;
$$;

select avs_test.become_postgres();

commit;
