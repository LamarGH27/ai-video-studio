-- =============================================================================
-- LOCAL TEST HARNESS — a stand-in for the objects Supabase manages for you.
-- =============================================================================
-- NOT A MIGRATION. Never applied to a Supabase project — everything in here
-- already exists there. It exists so `supabase/migrations/` can be applied to a
-- plain PostgreSQL 16 cluster and the RLS policies exercised for real, as the
-- `anon` / `authenticated` roles with a JWT claim set, which is exactly how
-- PostgREST presents a request to the database.
--
-- FIDELITY NOTES — the things that would otherwise make a test pass for the
-- wrong reason:
--   * Supabase GRANTs table privileges to anon/authenticated/service_role and
--     relies on RLS for row filtering. Without those grants every statement
--     would fail with "permission denied for table", which looks like a pass
--     but proves nothing. The grants below replicate that.
--   * `service_role` is BYPASSRLS in Supabase.
--   * auth.uid() / auth.role() read `request.jwt.claims`, the same GUC
--     PostgREST sets.
--
-- What this harness CANNOT stand in for: PostgREST's HTTP layer, Supabase Auth,
-- and the Storage API (signed URLs, MIME/size enforcement). Those are verified
-- against a live project by scripts/verify-live.ts.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
-- Migrations call gen_random_uuid() unqualified; make it resolvable.
grant usage on schema extensions to public;
alter database postgres set search_path to "$user", public, extensions;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;
end;
$$;

grant anon, authenticated, service_role to postgres;
grant anon, authenticated, service_role to authenticator;

-- -----------------------------------------------------------------------------
-- auth schema
-- -----------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Matches Supabase's definitions: both read the GUC PostgREST populates.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- storage schema
-- -----------------------------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

-- Supabase's own implementation: every path segment except the final filename.
create or replace function storage.foldername(name text) returns text[]
language plpgsql stable as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

create or replace function storage.filename(name text) returns text
language plpgsql stable as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[array_length(parts, 1)];
end;
$$;

grant execute on function storage.foldername(text), storage.filename(text)
  to anon, authenticated, service_role;

-- Storage grants mirror Supabase: the API roles can touch the table; RLS decides rows.
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- public schema grants — Supabase's default privileges
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
