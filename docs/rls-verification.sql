-- =============================================================================
-- AI Video Studio — Row Level Security verification
-- =============================================================================
-- Runnable assertions for the security properties the product depends on.
-- Run in the Supabase SQL Editor (or psql as `postgres`) AFTER applying every
-- migration in supabase/migrations/.
--
-- Everything happens inside a transaction that is rolled back at the end, so no
-- test data survives. Each check RAISES EXCEPTION if the expectation fails — a
-- clean run that reaches the final NOTICE means every assertion held.
--
-- Method: `set local role authenticated` plus a `request.jwt.claims` setting is
-- exactly how PostgREST presents a signed-in user to the database, so these
-- checks exercise the same code path a real request does.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fixtures: two customers and one admin.
-- -----------------------------------------------------------------------------
-- profiles.id references auth.users, so the users have to exist first. If your
-- project forbids direct auth.users inserts, create three accounts through the
-- app instead and replace these UUIDs with their real ids.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-alice@example.test', '', now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-bob@example.test', '', now(), now()),
  ('cccccccc-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-admin@example.test', '', now(), now())
on conflict (id) do nothing;

-- handle_new_user() will normally have created these already.
insert into public.profiles (id, display_name, role)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Alice', 'customer'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Bob',   'customer'),
  ('cccccccc-0000-4000-8000-000000000003', 'Admin', 'admin')
on conflict (id) do update set role = excluded.role;

-- Alice owns one submitted project with an asset and a consent record.
insert into public.projects
  (id, user_id, status, brief, orientation, desired_duration_seconds, submitted_at)
values
  ('11111111-0000-4000-8000-00000000000a',
   'aaaaaaaa-0000-4000-8000-000000000001',
   'SUBMITTED',
   'Alice''s brief, long enough to satisfy the projects_submitted_is_complete constraint.',
   'VERTICAL_9_16', 15, now())
on conflict (id) do nothing;

insert into public.project_assets
  (id, project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
values
  ('22222222-0000-4000-8000-00000000000a',
   '11111111-0000-4000-8000-00000000000a',
   'aaaaaaaa-0000-4000-8000-000000000001',
   'REFERENCE_IMAGE', 'reference-images',
   'aaaaaaaa-0000-4000-8000-000000000001/11111111-0000-4000-8000-00000000000a/ref.jpg',
   'image/jpeg', 12345)
on conflict (id) do nothing;

insert into public.project_consents
  (project_id, user_id, consent_type, granted, wording_version, granted_at)
values
  ('11111111-0000-4000-8000-00000000000a',
   'aaaaaaaa-0000-4000-8000-000000000001',
   'HAS_LIKENESS_PERMISSION', true, '2026-01-01', now())
on conflict (project_id, consent_type) do nothing;

-- Alice also has a draft, to check the draft-only write rules.
insert into public.projects (id, user_id, status, brief)
values
  ('33333333-0000-4000-8000-00000000000a',
   'aaaaaaaa-0000-4000-8000-000000000001',
   'DRAFT',
   'Alice''s draft brief.')
on conflict (id) do nothing;

-- Helper: become a signed-in user the way PostgREST does.
create or replace function pg_temp.become(user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.become_anon() returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );
  execute 'set local role anon';
end;
$$;

create or replace function pg_temp.become_postgres() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;


-- =============================================================================
-- 1. A customer cannot read another customer's project, assets or consent.
-- =============================================================================
do $$
declare
  visible int;
begin
  perform pg_temp.become('bbbbbbbb-0000-4000-8000-000000000002');

  select count(*) into visible
  from public.projects
  where id = '11111111-0000-4000-8000-00000000000a';
  if visible <> 0 then
    raise exception 'FAIL 1a: Bob can see Alice''s project';
  end if;

  select count(*) into visible
  from public.project_assets
  where project_id = '11111111-0000-4000-8000-00000000000a';
  if visible <> 0 then
    raise exception 'FAIL 1b: Bob can see Alice''s reference images';
  end if;

  select count(*) into visible
  from public.project_consents
  where project_id = '11111111-0000-4000-8000-00000000000a';
  if visible <> 0 then
    raise exception 'FAIL 1c: Bob can see Alice''s consent records';
  end if;

  select count(*) into visible
  from public.project_status_history
  where project_id = '11111111-0000-4000-8000-00000000000a';
  if visible <> 0 then
    raise exception 'FAIL 1d: Bob can see Alice''s status history';
  end if;

  -- And Alice can see her own.
  perform pg_temp.become('aaaaaaaa-0000-4000-8000-000000000001');
  select count(*) into visible
  from public.projects
  where id = '11111111-0000-4000-8000-00000000000a';
  if visible <> 1 then
    raise exception 'FAIL 1e: Alice cannot see her own project';
  end if;

  perform pg_temp.become_postgres();
  raise notice 'PASS 1: cross-customer reads are blocked, own reads work';
end;
$$;


-- =============================================================================
-- 2. A customer cannot grant themselves the admin role.
-- =============================================================================
do $$
declare
  resulting_role public.user_role;
  blocked boolean := false;
begin
  perform pg_temp.become('bbbbbbbb-0000-4000-8000-000000000002');

  begin
    update public.profiles
    set role = 'admin'
    where id = 'bbbbbbbb-0000-4000-8000-000000000002';
  exception when others then
    -- The trigger raises; the policy silently matches no rows. Either is a pass.
    blocked := true;
  end;

  perform pg_temp.become_postgres();

  select role into resulting_role
  from public.profiles
  where id = 'bbbbbbbb-0000-4000-8000-000000000002';

  if resulting_role <> 'customer' then
    raise exception 'FAIL 2: Bob escalated to %', resulting_role;
  end if;

  raise notice 'PASS 2: role escalation blocked (raised=%), role still %', blocked, resulting_role;
end;
$$;

-- 2b. A customer can still update a safe field on their own profile.
do $$
declare
  name_after text;
begin
  perform pg_temp.become('bbbbbbbb-0000-4000-8000-000000000002');

  update public.profiles
  set display_name = 'Bob Renamed'
  where id = 'bbbbbbbb-0000-4000-8000-000000000002';

  perform pg_temp.become_postgres();

  select display_name into name_after
  from public.profiles
  where id = 'bbbbbbbb-0000-4000-8000-000000000002';

  if name_after <> 'Bob Renamed' then
    raise exception 'FAIL 2b: a customer cannot update their own display name';
  end if;

  raise notice 'PASS 2b: safe profile fields remain updatable by their owner';
end;
$$;


-- =============================================================================
-- 3. A customer cannot create a project owned by someone else.
-- =============================================================================
do $$
declare
  blocked boolean := false;
begin
  perform pg_temp.become('bbbbbbbb-0000-4000-8000-000000000002');

  begin
    insert into public.projects (user_id, status, brief)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'DRAFT', 'Forged on Alice''s behalf.');
  exception when others then
    blocked := true;
  end;

  perform pg_temp.become_postgres();

  if not blocked then
    raise exception 'FAIL 3: Bob inserted a project owned by Alice';
  end if;

  raise notice 'PASS 3: a client-supplied user_id cannot forge ownership';
end;
$$;


-- =============================================================================
-- 4. A customer cannot edit a project once it has been submitted.
-- =============================================================================
do $$
declare
  affected int;
  brief_after text;
begin
  perform pg_temp.become('aaaaaaaa-0000-4000-8000-000000000001');

  update public.projects
  set brief = 'Tampered after submission.'
  where id = '11111111-0000-4000-8000-00000000000a';
  get diagnostics affected = row_count;

  perform pg_temp.become_postgres();

  select brief into brief_after
  from public.projects
  where id = '11111111-0000-4000-8000-00000000000a';

  if affected <> 0 or brief_after = 'Tampered after submission.' then
    raise exception 'FAIL 4: a submitted project was edited by its owner';
  end if;

  raise notice 'PASS 4: submitted projects are read-only to the customer';
end;
$$;

-- 4b. The customer's own draft is still editable.
do $$
declare
  affected int;
begin
  perform pg_temp.become('aaaaaaaa-0000-4000-8000-000000000001');

  update public.projects
  set mood = 'Confident'
  where id = '33333333-0000-4000-8000-00000000000a';
  get diagnostics affected = row_count;

  perform pg_temp.become_postgres();

  if affected <> 1 then
    raise exception 'FAIL 4b: a customer cannot edit their own draft';
  end if;

  raise notice 'PASS 4b: drafts remain editable by their owner';
end;
$$;


-- =============================================================================
-- 5. A customer cannot attach an asset to a project they do not own,
--    nor to a project that has already been submitted.
-- =============================================================================
do $$
declare
  blocked_foreign boolean := false;
  blocked_submitted boolean := false;
begin
  perform pg_temp.become('bbbbbbbb-0000-4000-8000-000000000002');
  begin
    insert into public.project_assets
      (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
    values
      ('11111111-0000-4000-8000-00000000000a',
       'bbbbbbbb-0000-4000-8000-000000000002',
       'REFERENCE_IMAGE', 'reference-images', 'bob/steal.jpg', 'image/jpeg', 10);
  exception when others then
    blocked_foreign := true;
  end;

  perform pg_temp.become('aaaaaaaa-0000-4000-8000-000000000001');
  begin
    insert into public.project_assets
      (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
    values
      ('11111111-0000-4000-8000-00000000000a',
       'aaaaaaaa-0000-4000-8000-000000000001',
       'REFERENCE_IMAGE', 'reference-images', 'alice/late.jpg', 'image/jpeg', 10);
  exception when others then
    blocked_submitted := true;
  end;

  perform pg_temp.become_postgres();

  if not blocked_foreign then
    raise exception 'FAIL 5a: an asset was attached to another customer''s project';
  end if;
  if not blocked_submitted then
    raise exception 'FAIL 5b: an asset was added to an already-submitted project';
  end if;

  raise notice 'PASS 5: asset writes are limited to the owner''s own draft';
end;
$$;

-- 5c. A customer cannot claim a delivery asset type on their own draft.
do $$
declare
  blocked boolean := false;
begin
  perform pg_temp.become('aaaaaaaa-0000-4000-8000-000000000001');
  begin
    insert into public.project_assets
      (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
    values
      ('33333333-0000-4000-8000-00000000000a',
       'aaaaaaaa-0000-4000-8000-000000000001',
       'FINAL_VIDEO', 'project-deliveries', 'alice/final.mp4', 'video/mp4', 10);
  exception when others then
    blocked := true;
  end;

  perform pg_temp.become_postgres();

  if not blocked then
    raise exception 'FAIL 5c: a customer wrote a delivery asset';
  end if;

  raise notice 'PASS 5c: delivery asset types are not customer-writable';
end;
$$;


-- =============================================================================
-- 6. Anonymous visitors read only active public reference data.
-- =============================================================================
do $$
declare
  experiences int;
  portfolio int;
  leaked int;
begin
  perform pg_temp.become_anon();

  select count(*) into experiences from public.video_experiences;
  select count(*) into portfolio from public.portfolio_items;
  select count(*) into leaked from public.projects;

  perform pg_temp.become_postgres();

  if experiences = 0 then
    raise exception 'FAIL 6a: anonymous visitors cannot read the experience catalogue';
  end if;
  if portfolio = 0 then
    raise exception 'FAIL 6b: anonymous visitors cannot read the portfolio';
  end if;
  if leaked <> 0 then
    raise exception 'FAIL 6c: anonymous visitors can see % customer projects', leaked;
  end if;

  raise notice 'PASS 6: anon reads % experiences, % portfolio items, 0 projects',
    experiences, portfolio;
end;
$$;


-- =============================================================================
-- 7. project_status_history rejects direct writes from any API role.
-- =============================================================================
do $$
declare
  blocked boolean := false;
  history_rows int;
begin
  perform pg_temp.become('aaaaaaaa-0000-4000-8000-000000000001');
  begin
    insert into public.project_status_history (project_id, from_status, to_status)
    values ('11111111-0000-4000-8000-00000000000a', 'SUBMITTED', 'COMPLETED');
  exception when others then
    blocked := true;
  end;

  perform pg_temp.become_postgres();

  if not blocked then
    raise exception 'FAIL 7a: status history accepted a direct client write';
  end if;

  -- The trigger, however, must have recorded the real transitions.
  select count(*) into history_rows
  from public.project_status_history
  where project_id = '11111111-0000-4000-8000-00000000000a';

  if history_rows = 0 then
    raise exception 'FAIL 7b: the status-history trigger recorded nothing';
  end if;

  raise notice 'PASS 7: history is trigger-written only (% rows recorded)', history_rows;
end;
$$;


-- =============================================================================
-- 8. Admins can read every project; ownership is still immutable.
-- =============================================================================
do $$
declare
  visible int;
  blocked boolean := false;
begin
  perform pg_temp.become('cccccccc-0000-4000-8000-000000000003');

  select count(*) into visible
  from public.projects
  where id = '11111111-0000-4000-8000-00000000000a';

  if visible <> 1 then
    raise exception 'FAIL 8a: an admin cannot read a submitted project';
  end if;

  begin
    update public.projects
    set user_id = 'cccccccc-0000-4000-8000-000000000003'
    where id = '11111111-0000-4000-8000-00000000000a';
  exception when others then
    blocked := true;
  end;

  perform pg_temp.become_postgres();

  if not blocked then
    raise exception 'FAIL 8b: an admin reassigned a project to themselves';
  end if;

  raise notice 'PASS 8: admin reads work; project ownership is immutable';
end;
$$;


do $$
begin
  raise notice '--------------------------------------------------';
  raise notice 'All Row Level Security assertions passed.';
  raise notice '--------------------------------------------------';
end;
$$;

rollback;
