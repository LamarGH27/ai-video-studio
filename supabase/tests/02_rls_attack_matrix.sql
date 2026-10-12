-- =============================================================================
-- Adversarial RLS matrix — direct database operations, not the application UI.
-- =============================================================================
-- Every statement runs as a real `authenticated` / `anon` role with a JWT claim
-- set, which is how PostgREST presents an API request to Postgres. Nothing here
-- goes through application code, so nothing here can be protected by it.
-- =============================================================================

-- The whole suite runs in ONE transaction on purpose: `SET LOCAL ROLE` and the
-- request.jwt.claims GUC are transaction-scoped, so under psql's autocommit each
-- statement would silently revert to the superuser and every assertion would
-- pass without testing anything. avs_test.attempt() also refuses to run as a
-- BYPASSRLS role, as a second line of defence against exactly that mistake.
begin;

-- =============================================================================
-- CUSTOMER A ATTACKING CUSTOMER B
-- =============================================================================
select avs_test.become('customer_a');

select avs_test.attempt('A→B projects', 'SELECT B''s project', 'DENIED',
  $$ select * from public.projects where id = avs_test.id('b_submitted') $$);

select avs_test.attempt('A→B projects', 'UPDATE B''s project brief', 'DENIED',
  $$ update public.projects set brief = 'hijacked' where id = avs_test.id('b_submitted') $$);

select avs_test.attempt('A→B projects', 'UPDATE B''s draft project', 'DENIED',
  $$ update public.projects set brief = 'hijacked' where id = avs_test.id('b_draft') $$);

select avs_test.attempt('A→B projects', 'DELETE B''s project', 'DENIED',
  $$ delete from public.projects where id = avs_test.id('b_submitted') $$);

select avs_test.attempt('A→B projects', 'DELETE B''s draft project', 'DENIED',
  $$ delete from public.projects where id = avs_test.id('b_draft') $$);

select avs_test.attempt('A→B projects', 'SELECT every project in the table', 'DENIED',
  $$ select * from public.projects where user_id = avs_test.id('customer_b') $$);

select avs_test.attempt('A→B assets', 'SELECT B''s project assets', 'DENIED',
  $$ select * from public.project_assets where project_id = avs_test.id('b_submitted') $$);

select avs_test.attempt('A→B assets', 'INSERT asset against B''s project', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('b_draft'), avs_test.id('customer_b'), 'REFERENCE_IMAGE',
             'reference-images', 'b/forged.jpg', 'image/jpeg', 100) $$);

select avs_test.attempt('A→B assets', 'INSERT asset on B''s project, claiming own user_id', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('b_draft'), avs_test.id('customer_a'), 'REFERENCE_IMAGE',
             'reference-images', 'a/forged.jpg', 'image/jpeg', 100) $$);

select avs_test.attempt('A→B assets', 'DELETE B''s asset', 'DENIED',
  $$ delete from public.project_assets where id = avs_test.id('b_asset') $$);

select avs_test.attempt('A→B consents', 'SELECT B''s consents', 'DENIED',
  $$ select * from public.project_consents where project_id = avs_test.id('b_submitted') $$);

select avs_test.attempt('A→B consents', 'INSERT consent against B''s project', 'DENIED',
  $$ insert into public.project_consents
       (project_id, user_id, consent_type, granted, wording_version, granted_at)
     values (avs_test.id('b_draft'), avs_test.id('customer_b'),
             'PORTFOLIO_PERMISSION', true, '2026-01-01', now()) $$);

select avs_test.attempt('A→B consents', 'UPDATE B''s consent to grant portfolio rights', 'DENIED',
  $$ update public.project_consents set granted = true
     where project_id = avs_test.id('b_submitted') $$);

select avs_test.attempt('A→B history', 'SELECT B''s status history', 'DENIED',
  $$ select * from public.project_status_history where project_id = avs_test.id('b_submitted') $$);

select avs_test.attempt('A→B profile', 'SELECT B''s profile', 'DENIED',
  $$ select * from public.profiles where id = avs_test.id('customer_b') $$);

select avs_test.attempt('A→B profile', 'UPDATE B''s profile display name', 'DENIED',
  $$ update public.profiles set display_name = 'pwned' where id = avs_test.id('customer_b') $$);

-- =============================================================================
-- PRIVILEGE ESCALATION
-- =============================================================================
select avs_test.attempt('Escalation', 'Grant self admin via profiles.role', 'DENIED',
  $$ update public.profiles set role = 'admin' where id = avs_test.id('customer_a') $$);

select avs_test.attempt('Escalation', 'Grant self admin alongside a legitimate field', 'DENIED',
  $$ update public.profiles set display_name = 'A', role = 'admin'
     where id = avs_test.id('customer_a') $$);

select avs_test.attempt('Escalation', 'Promote B to admin', 'DENIED',
  $$ update public.profiles set role = 'admin' where id = avs_test.id('customer_b') $$);

select avs_test.attempt('Escalation', 'INSERT a second profile row with role=admin', 'DENIED',
  $$ insert into public.profiles (id, display_name, role)
     values (gen_random_uuid(), 'Backdoor', 'admin') $$);

-- =============================================================================
-- IMMUTABILITY AND OWNERSHIP FORGERY
-- =============================================================================
select avs_test.attempt('Immutability', 'Reassign own project to B', 'DENIED',
  $$ update public.projects set user_id = avs_test.id('customer_b')
     where id = avs_test.id('a_draft') $$);

select avs_test.attempt('Immutability', 'Steal B''s project by setting user_id to self', 'DENIED',
  $$ update public.projects set user_id = avs_test.id('customer_a')
     where id = avs_test.id('b_draft') $$);

select avs_test.attempt('Immutability', 'Change own public_reference', 'DENIED',
  $$ update public.projects set public_reference = 'AVS-999999'
     where id = avs_test.id('a_draft') $$);

select avs_test.attempt('Ownership', 'INSERT project owned by B', 'DENIED',
  $$ insert into public.projects (user_id, status, brief)
     values (avs_test.id('customer_b'), 'DRAFT', 'Forged on B''s behalf.') $$);

select avs_test.attempt('Ownership', 'INSERT own project already SUBMITTED', 'DENIED',
  $$ insert into public.projects (user_id, status, brief, orientation,
                                  desired_duration_seconds, submitted_at)
     values (avs_test.id('customer_a'), 'SUBMITTED',
             'Skipping the draft stage entirely with a sufficiently long brief.',
             'VERTICAL_9_16', 15, now()) $$);

-- =============================================================================
-- WRITING WHERE ONLY STAFF OR TRIGGERS MAY WRITE
-- =============================================================================
select avs_test.attempt('Audit trail', 'Forge a status-history row', 'DENIED',
  $$ insert into public.project_status_history (project_id, from_status, to_status)
     values (avs_test.id('a_submitted'), 'SUBMITTED', 'COMPLETED') $$);

select avs_test.attempt('Audit trail', 'Rewrite own status history', 'DENIED',
  $$ update public.project_status_history set to_status = 'COMPLETED'
     where project_id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Audit trail', 'Delete own status history', 'DENIED',
  $$ delete from public.project_status_history where project_id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Staff writes', 'Attach a FINAL_VIDEO delivery asset to own draft', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_draft'), avs_test.id('customer_a'), 'FINAL_VIDEO',
             'project-deliveries', 'a/final.mp4', 'video/mp4', 100) $$);

select avs_test.attempt('Staff writes', 'Edit the public experience catalogue', 'DENIED',
  $$ update public.video_experiences set name = 'Defaced' where slug = 'fashion' $$);

select avs_test.attempt('Staff writes', 'Publish self into the public portfolio', 'DENIED',
  $$ insert into public.portfolio_items (slug, title, category)
     values ('self-promo', 'Self Promo', 'CINEMATIC') $$);

-- =============================================================================
-- SUBMITTED PROJECTS ARE READ-ONLY TO THEIR OWNER
-- =============================================================================
select avs_test.attempt('Post-submission', 'Edit own SUBMITTED project brief', 'DENIED',
  $$ update public.projects set brief = 'changed my mind after submitting'
     where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Post-submission', 'Add a reference image to own SUBMITTED project', 'DENIED',
  $$ insert into public.project_assets
       (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
     values (avs_test.id('a_submitted'), avs_test.id('customer_a'), 'REFERENCE_IMAGE',
             'reference-images', 'a/late.jpg', 'image/jpeg', 100) $$);

select avs_test.attempt('Post-submission', 'Delete own SUBMITTED project', 'DENIED',
  $$ delete from public.projects where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('Post-submission', 'Self-advance own project to IN_PRODUCTION', 'DENIED',
  $$ update public.projects set status = 'IN_PRODUCTION' where id = avs_test.id('a_draft') $$);

-- =============================================================================
-- CUSTOMER A'S LEGITIMATE ACCESS MUST STILL WORK
-- =============================================================================
select avs_test.attempt('A legitimate', 'SELECT own profile', 'ALLOWED',
  $$ select * from public.profiles where id = avs_test.id('customer_a') $$);

select avs_test.attempt('A legitimate', 'UPDATE own display name', 'ALLOWED',
  $$ update public.profiles set display_name = 'Customer A Renamed'
     where id = avs_test.id('customer_a') $$);

select avs_test.attempt('A legitimate', 'SELECT own projects', 'ALLOWED',
  $$ select * from public.projects where user_id = avs_test.id('customer_a') $$);

select avs_test.attempt('A legitimate', 'SELECT own project assets', 'ALLOWED',
  $$ select * from public.project_assets where project_id = avs_test.id('a_submitted') $$);

select avs_test.attempt('A legitimate', 'SELECT own consents', 'ALLOWED',
  $$ select * from public.project_consents where project_id = avs_test.id('a_submitted') $$);

select avs_test.attempt('A legitimate', 'SELECT own status history', 'ALLOWED',
  $$ select * from public.project_status_history where project_id = avs_test.id('a_submitted') $$);

select avs_test.attempt('A legitimate', 'CREATE own draft project', 'ALLOWED',
  $$ insert into public.projects (user_id, status, brief)
     values (avs_test.id('customer_a'), 'DRAFT', 'A brand new draft.') $$);

select avs_test.attempt('A legitimate', 'EDIT own draft project', 'ALLOWED',
  $$ update public.projects set mood = 'Confident' where id = avs_test.id('a_draft') $$);

select avs_test.attempt('A legitimate', 'ADD reference image to own draft', 'ALLOWED',
  $$ select avs_test.prepare_submission(avs_test.id('a_draft')) $$);

select avs_test.attempt('A legitimate', 'Direct consent write requires submission RPC', 'DENIED',
  $$ insert into public.project_consents
       (project_id, user_id, consent_type, granted, wording_version, granted_at)
     values (avs_test.id('a_draft'), avs_test.id('customer_a'),
             'HAS_LIKENESS_PERMISSION', true, '2026-01-01', now()) $$);

select avs_test.attempt('A legitimate', 'READ the public experience catalogue', 'ALLOWED',
  $$ select * from public.video_experiences where active $$);

-- =============================================================================
-- CUSTOMER B, INDEPENDENTLY
-- =============================================================================
select avs_test.become('customer_b');

select avs_test.attempt('B independent', 'CREATE own draft project', 'ALLOWED',
  $$ insert into public.projects (user_id, status, brief)
     values (avs_test.id('customer_b'), 'DRAFT', 'B''s independent draft.') $$);

select avs_test.attempt('B independent', 'SELECT own projects', 'ALLOWED',
  $$ select * from public.projects where user_id = avs_test.id('customer_b') $$);

select avs_test.attempt('B→A projects', 'SELECT A''s project', 'DENIED',
  $$ select * from public.projects where id = avs_test.id('a_submitted') $$);

select avs_test.attempt('B→A assets', 'SELECT A''s project assets', 'DENIED',
  $$ select * from public.project_assets where project_id = avs_test.id('a_submitted') $$);

select avs_test.attempt('B→A consents', 'SELECT A''s consents', 'DENIED',
  $$ select * from public.project_consents where project_id = avs_test.id('a_submitted') $$);

select avs_test.attempt('B→A history', 'SELECT A''s status history', 'DENIED',
  $$ select * from public.project_status_history where project_id = avs_test.id('a_submitted') $$);

-- =============================================================================
-- ANONYMOUS
-- =============================================================================
select avs_test.become_anon();

select avs_test.attempt('Anonymous', 'SELECT any project', 'DENIED',
  $$ select * from public.projects $$);
select avs_test.attempt('Anonymous', 'SELECT any profile', 'DENIED',
  $$ select * from public.profiles $$);
select avs_test.attempt('Anonymous', 'SELECT any project asset', 'DENIED',
  $$ select * from public.project_assets $$);
select avs_test.attempt('Anonymous', 'SELECT any consent record', 'DENIED',
  $$ select * from public.project_consents $$);
select avs_test.attempt('Anonymous', 'SELECT any status history', 'DENIED',
  $$ select * from public.project_status_history $$);
select avs_test.attempt('Anonymous', 'SELECT inactive portfolio items', 'DENIED',
  $$ select * from public.portfolio_items where not active $$);
select avs_test.attempt('Anonymous', 'INSERT a project', 'DENIED',
  $$ insert into public.projects (user_id, status, brief)
     values (avs_test.id('customer_a'), 'DRAFT', 'anon insert') $$);
select avs_test.attempt('Anonymous', 'READ active portfolio (public marketing)', 'ALLOWED',
  $$ select * from public.portfolio_items where active $$);
select avs_test.attempt('Anonymous', 'READ active experiences (public catalogue)', 'ALLOWED',
  $$ select * from public.video_experiences where active $$);

-- =============================================================================
-- ADMIN
-- =============================================================================
select avs_test.become('admin');

select avs_test.attempt('Admin', 'READ all submitted projects', 'ALLOWED',
  $$ select * from public.projects where status <> 'DRAFT' $$);
select avs_test.attempt('Admin', 'READ another customer''s reference assets', 'ALLOWED',
  $$ select * from public.project_assets where project_id = avs_test.id('a_submitted') $$);
select avs_test.attempt('Admin', 'READ another customer''s consent record', 'ALLOWED',
  $$ select * from public.project_consents where project_id = avs_test.id('a_submitted') $$);
select avs_test.attempt('Admin', 'READ all profiles', 'ALLOWED',
  $$ select * from public.profiles $$);

-- An admin is trusted with production status, not with identity or privilege.
select avs_test.attempt('Admin limits', 'Reassign a project to themselves', 'DENIED',
  $$ update public.projects set user_id = avs_test.id('admin')
     where id = avs_test.id('a_submitted') $$);
select avs_test.attempt('Admin limits', 'Promote a customer to admin through the API', 'DENIED',
  $$ update public.profiles set role = 'admin' where id = avs_test.id('customer_b') $$);
select avs_test.attempt('Admin limits', 'Demote another admin through the API', 'DENIED',
  $$ update public.profiles set role = 'customer' where id = avs_test.id('admin') $$);
select avs_test.attempt('Admin limits', 'Forge a status-history row', 'DENIED',
  $$ insert into public.project_status_history (project_id, from_status, to_status)
     values (avs_test.id('a_submitted'), 'SUBMITTED', 'COMPLETED') $$);

select avs_test.become_postgres();

commit;
