-- =============================================================================
-- LOCAL TEST HARNESS — assertion framework and fixtures.  NOT A MIGRATION.
-- =============================================================================
-- Creates three test principals (Customer A, Customer B, Admin) and a tiny
-- framework that records every attempt into avs_test.results so the suite can
-- print a real Attack | Expected | Actual | Pass/Fail matrix.
-- =============================================================================

drop schema if exists avs_test cascade;
create schema avs_test;
grant usage on schema avs_test to anon, authenticated, service_role;

create table avs_test.results (
  seq        serial primary key,
  area       text    not null,
  attack     text    not null,
  expected   text    not null,
  actual     text    not null,
  pass       boolean not null
);
grant select, insert on avs_test.results to anon, authenticated, service_role;
grant usage, select on sequence avs_test.results_seq_seq to anon, authenticated, service_role;

-- Fixed UUIDs so assertions can reference them directly.
create table avs_test.ids (k text primary key, v uuid not null);
grant select on avs_test.ids to anon, authenticated, service_role;

insert into avs_test.ids (k, v) values
  ('customer_a',  'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('customer_b',  'bbbbbbbb-0000-4000-8000-00000000000b'),
  ('admin',       'cccccccc-0000-4000-8000-00000000000c'),
  ('a_submitted', '11111111-0000-4000-8000-000000000001'),
  ('a_draft',     '22222222-0000-4000-8000-000000000002'),
  ('b_submitted', '33333333-0000-4000-8000-000000000003'),
  ('b_draft',     '44444444-0000-4000-8000-000000000004'),
  ('a_asset',     '55555555-0000-4000-8000-000000000005'),
  ('b_asset',     '66666666-0000-4000-8000-000000000006');

create or replace function avs_test.id(k text) returns uuid
language sql stable as $$ select v from avs_test.ids where avs_test.ids.k = $1 $$;
grant execute on function avs_test.id(text) to anon, authenticated, service_role;

-- Naming a specific preview by version, for the staleness tests.
--
-- SECURITY DEFINER on purpose: this is the *test harness* deciding which id to
-- pass as an argument, not the thing under test. It has to work while acting as
-- a customer who cannot read the row — that a foreign id is refused is exactly
-- what those cases assert, so the lookup must not be the thing that blocks them.
create or replace function avs_test.preview_id(project_key text, want_version int)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.project_assets a
  where a.project_id = avs_test.id(project_key)
    and a.asset_type = 'PREVIEW_VIDEO'
    and a.version = want_version
$$;
grant execute on function avs_test.preview_id(text, int) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Becoming a principal, exactly as PostgREST presents one.
-- -----------------------------------------------------------------------------
create or replace function avs_test.become(user_key text) returns void
language plpgsql as $$
declare
  uid uuid := avs_test.id(user_key);
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'aud', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

create or replace function avs_test.become_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  execute 'set local role anon';
end;
$$;

create or replace function avs_test.become_postgres() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- -----------------------------------------------------------------------------
-- attempt(): run a statement as the CURRENT role and record what happened.
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER (the default) is essential — the statement must run with the
-- privileges of whoever called it, not of the function's owner.
--
-- "DENIED" covers both ways RLS refuses:
--   * INSERT / WITH CHECK violations and trigger RAISEs -> an error code
--   * SELECT / UPDATE / DELETE filtered by USING        -> zero rows touched
-- Both are a refusal; conflating them would hide a real failure, so the actual
-- column always records which one occurred.
create or replace function avs_test.attempt(
  p_area     text,
  p_attack   text,
  p_expected text,   -- 'DENIED' or 'ALLOWED'
  p_sql      text
) returns void
language plpgsql as $$
declare
  n      bigint;
  actual text;
begin
  -- HARNESS GUARD. A suite that quietly runs as a superuser or a BYPASSRLS role
  -- reports passes it has not earned, which is worse than having no suite. Fail
  -- loudly instead of testing nothing.
  if exists (
    select 1 from pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception
      'HARNESS FAULT: attempt() is running as "%", which bypasses RLS. '
      'Did SET LOCAL ROLE get reverted by autocommit? Run the suite inside one transaction.',
      current_user;
  end if;

  begin
    execute p_sql;
    get diagnostics n = row_count;
    if n = 0 then
      actual := 'DENIED (0 rows)';
    else
      actual := format('ALLOWED (%s row%s)', n, case when n = 1 then '' else 's' end);
    end if;
  exception when others then
    actual := format('DENIED (SQLSTATE %s)', sqlstate);
  end;

  insert into avs_test.results (area, attack, expected, actual, pass)
  values (
    p_area, p_attack, p_expected, actual,
    starts_with(actual, p_expected)
  );
end;
$$;

grant execute on function
  avs_test.become(text), avs_test.become_anon(), avs_test.become_postgres(),
  avs_test.attempt(text, text, text, text)
to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
values
  (avs_test.id('customer_a'), 'customer-a@test.invalid', '{"display_name":"Customer A"}'),
  (avs_test.id('customer_b'), 'customer-b@test.invalid', '{"display_name":"Customer B"}'),
  (avs_test.id('admin'),      'admin@test.invalid',      '{"display_name":"Admin"}');

-- handle_new_user() should already have created these; assert that rather than
-- silently creating them, because the trigger is part of what we are testing.
do $$
declare
  created int;
begin
  select count(*) into created from public.profiles
  where id in (avs_test.id('customer_a'), avs_test.id('customer_b'), avs_test.id('admin'));
  if created <> 3 then
    raise exception 'FIXTURE FAIL: on_auth_user_created created % of 3 profiles', created;
  end if;
end;
$$;

-- Promote the admin the way the README documents: direct SQL as a superuser.
update public.profiles set role = 'admin' where id = avs_test.id('admin');

-- Two projects each: one submitted, one still a draft.
insert into public.projects (id, user_id, status, brief, orientation, desired_duration_seconds, submitted_at)
values
  (avs_test.id('a_submitted'), avs_test.id('customer_a'), 'DRAFT',
   'Customer A submitted brief, long enough to satisfy the completeness constraint.',
   'VERTICAL_9_16', 15, now()),
  (avs_test.id('b_submitted'), avs_test.id('customer_b'), 'DRAFT',
   'Customer B submitted brief, long enough to satisfy the completeness constraint.',
   'LANDSCAPE_16_9', 30, now());

insert into public.projects (id, user_id, status, brief)
values
  (avs_test.id('a_draft'), avs_test.id('customer_a'), 'DRAFT', 'Customer A draft brief.'),
  (avs_test.id('b_draft'), avs_test.id('customer_b'), 'DRAFT', 'Customer B draft brief.');

-- Storage objects matching the asset rows, so storage policies have real targets.
insert into storage.objects (bucket_id, name, metadata)
values
  ('reference-images',
   'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/a1.jpg',
   '{"size":120000,"mimetype":"image/jpeg"}'),
  ('reference-images',
   'bbbbbbbb-0000-4000-8000-00000000000b/33333333-0000-4000-8000-000000000003/b1.jpg',
   '{"size":130000,"mimetype":"image/jpeg"}');

insert into public.project_assets
  (id, project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
values
  (avs_test.id('a_asset'), avs_test.id('a_submitted'), avs_test.id('customer_a'),
   'REFERENCE_IMAGE', 'reference-images',
   'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/a1.jpg',
   'image/jpeg', 120000),
  (avs_test.id('b_asset'), avs_test.id('b_submitted'), avs_test.id('customer_b'),
   'REFERENCE_IMAGE', 'reference-images',
   'bbbbbbbb-0000-4000-8000-00000000000b/33333333-0000-4000-8000-000000000003/b1.jpg',
   'image/jpeg', 130000);

insert into public.project_consents (project_id, user_id, consent_type, granted, wording_version, granted_at)
values
  (avs_test.id('a_submitted'), avs_test.id('customer_a'), 'HAS_LIKENESS_PERMISSION', true, '2026-09-15', now()),
  (avs_test.id('a_submitted'), avs_test.id('customer_a'), 'AI_PROCESSING_CONSENT',   true, '2026-09-15', now()),
  (avs_test.id('b_submitted'), avs_test.id('customer_b'), 'HAS_LIKENESS_PERMISSION', true, '2026-09-15', now()),
  (avs_test.id('b_submitted'), avs_test.id('customer_b'), 'AI_PROCESSING_CONSENT',   true, '2026-09-15', now());

-- Upload before submission, matching the enforced Storage lifecycle.
update public.projects set status = 'SUBMITTED'
where id in (avs_test.id('a_submitted'), avs_test.id('b_submitted'));

-- An inactive portfolio row, to prove `active` actually filters for anon.
-- Test-only helper exercising the customer confirmation path under caller RLS.
create or replace function avs_test.prepare_submission(pid uuid) returns jsonb
language plpgsql security invoker as $$
declare object_path text;
begin
  update public.projects set brief = 'A complete submission fixture with enough detail for production.',
    orientation = 'VERTICAL_9_16', desired_duration_seconds = 15 where id = pid;
  object_path := auth.uid()::text || '/' || pid::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects(bucket_id,name,metadata) values
    ('reference-images',object_path,'{"size":100,"mimetype":"image/jpeg"}');
  return public.confirm_reference_asset(pid,object_path,'fixture.jpg');
end;
$$;
grant execute on function avs_test.prepare_submission(uuid) to authenticated;

insert into public.portfolio_items (slug, title, category, active)
values ('unreleased-concept', 'Unreleased Concept', 'CINEMATIC', false);
