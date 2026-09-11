-- =============================================================================
-- AI Video Studio — initial schema
-- =============================================================================
-- Creates the enums, tables, triggers and helper functions that back the MVP.
-- Row Level Security is enabled and policed in 20260101000100_row_level_security.sql.
-- Storage buckets and their policies live in 20260101000200_storage.sql.
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type public.user_role as enum ('customer', 'admin');

create type public.project_status as enum (
  'DRAFT',
  'SUBMITTED',
  'ASSETS_REVIEW',
  'IN_PRODUCTION',
  'PREVIEW_READY',
  'REVISION_REQUESTED',
  'COMPLETED',
  'CANCELLED'
);

create type public.project_orientation as enum (
  'VERTICAL_9_16',
  'LANDSCAPE_16_9',
  'SQUARE_1_1'
);

-- PREVIEW_VIDEO / FINAL_VIDEO are not produced by the MVP, but the asset table is
-- shaped for them so delivery can be added without a destructive migration.
create type public.asset_type as enum (
  'REFERENCE_IMAGE',
  'PREVIEW_VIDEO',
  'FINAL_VIDEO'
);

create type public.consent_type as enum (
  'HAS_LIKENESS_PERMISSION',
  'AI_PROCESSING_CONSENT',
  'PORTFOLIO_PERMISSION'
);

-- Shared by video_experiences and portfolio_items so a portfolio piece can be
-- filtered by the same taxonomy a customer picks from.
create type public.experience_category as enum (
  'LUXURY_LIFESTYLE',
  'FASHION',
  'CINEMATIC',
  'SOCIAL_MEDIA',
  'CELEBRATION',
  'TRAVEL',
  'EXECUTIVE',
  'BESPOKE'
);

-- -----------------------------------------------------------------------------
-- Shared helper functions
-- -----------------------------------------------------------------------------

-- Generic updated_at maintenance.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- The PostgREST role of the current request ('anon', 'authenticated',
-- 'service_role'), or NULL for a direct database connection (migrations, psql).
create or replace function public.request_jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

-- SECURITY DEFINER so it can read public.profiles without tripping the RLS
-- policies that are themselves defined in terms of this function.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- Reads the caller's own stored role without recursing through RLS. Used by the
-- profiles UPDATE policy to pin the role column to its existing value.
create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

revoke execute on function public.current_profile_role() from public;
grant execute on function public.current_profile_role() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for an auth.users row. `role` is privilege data and is immutable to the account owner (see enforce_profile_role_immutable).';

create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Defence in depth: the RLS policy already pins `role`, this blocks privilege
-- escalation even if a future policy is written too loosely.
create or replace function public.enforce_profile_role_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and coalesce(public.request_jwt_role(), 'service_role') <> 'service_role'
  then
    raise exception 'profiles.role may only be changed by a service-role client'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_enforce_role_immutable
  before update on public.profiles
  for each row execute function public.enforce_profile_role_immutable();

-- Every auth user gets a profile. SECURITY DEFINER because the trigger runs in
-- the auth schema's context.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- video_experiences
-- -----------------------------------------------------------------------------

create table public.video_experiences (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 120),
  description text not null check (char_length(description) between 1 and 1000),
  category public.experience_category not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.video_experiences is
  'Reusable, commercially reusable video templates a customer selects in step 1 of /create.';

create index video_experiences_active_sort_idx
  on public.video_experiences (active, sort_order, name);

create trigger video_experiences_set_updated_at
  before update on public.video_experiences
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------

-- Public-facing reference (AVS-000123). Deliberately separate from the UUID
-- primary key so it can be quoted to customers without leaking a row id.
create sequence public.project_reference_seq as bigint start with 1 increment by 1;

create or replace function public.generate_project_reference()
returns text
language sql
volatile
as $$
  select 'AVS-' || lpad(nextval('public.project_reference_seq')::text, 6, '0');
$$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique default public.generate_project_reference(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  experience_id uuid references public.video_experiences (id) on delete set null,
  title text check (title is null or char_length(title) between 1 and 160),
  status public.project_status not null default 'DRAFT',
  brief text check (brief is null or char_length(brief) <= 4000),
  mood text check (mood is null or char_length(mood) <= 300),
  environment text check (environment is null or char_length(environment) <= 300),
  wardrobe_style text check (wardrobe_style is null or char_length(wardrobe_style) <= 300),
  orientation public.project_orientation,
  desired_duration_seconds integer
    check (desired_duration_seconds is null or desired_duration_seconds between 5 and 180),
  special_requirements text check (special_requirements is null or char_length(special_requirements) <= 2000),
  preserve_requirements text check (preserve_requirements is null or char_length(preserve_requirements) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  -- Anything past DRAFT must be a complete brief.
  constraint projects_submitted_is_complete check (
    status = 'DRAFT'
    or (
      submitted_at is not null
      and brief is not null
      and char_length(btrim(brief)) >= 40
      and orientation is not null
    )
  )
);

comment on column public.projects.public_reference is
  'Customer-facing identifier (AVS-000123). Never used as a foreign key.';
comment on column public.projects.experience_id is
  'NULL for a Custom Concept brief, which has no reusable template.';

create index projects_user_id_created_at_idx on public.projects (user_id, created_at desc);
create index projects_status_idx on public.projects (status, created_at desc);
create index projects_experience_id_idx on public.projects (experience_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- A project's owner is fixed for life. Policies cannot reference OLD, so the
-- admin UPDATE policy relies on this trigger to stop a project being reassigned.
create or replace function public.enforce_project_owner_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'projects.user_id is immutable' using errcode = '42501';
  end if;
  if new.public_reference is distinct from old.public_reference then
    raise exception 'projects.public_reference is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger projects_enforce_owner_immutable
  before update on public.projects
  for each row execute function public.enforce_project_owner_immutable();

-- -----------------------------------------------------------------------------
-- project_assets
-- -----------------------------------------------------------------------------

create table public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Denormalised owner so storage/RLS checks never need a join.
  user_id uuid not null references public.profiles (id) on delete cascade,
  asset_type public.asset_type not null,
  storage_bucket text not null check (char_length(storage_bucket) between 1 and 100),
  storage_path text not null check (char_length(storage_path) between 1 and 500),
  mime_type text not null check (char_length(mime_type) between 1 and 150),
  original_filename text check (original_filename is null or char_length(original_filename) <= 300),
  file_size bigint not null check (file_size > 0),
  created_at timestamptz not null default now(),
  constraint project_assets_unique_object unique (storage_bucket, storage_path)
);

comment on column public.project_assets.original_filename is
  'Retained for support/debugging only. Never used to build a storage path.';

create index project_assets_project_idx on public.project_assets (project_id, created_at);
create index project_assets_user_idx on public.project_assets (user_id);

-- Shared by project_assets and project_consents: the row's user_id must always
-- equal the owner of the parent project, so a client cannot attach a child row
-- to somebody else's project even if it passes the RLS check on its own columns.
create or replace function public.enforce_child_owner_matches_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  select p.user_id into owner_id from public.projects p where p.id = new.project_id;

  if owner_id is null then
    raise exception 'project % does not exist', new.project_id using errcode = '23503';
  end if;

  if new.user_id <> owner_id then
    raise exception '%.user_id must match the owning project', tg_table_name
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger project_assets_enforce_owner
  before insert or update on public.project_assets
  for each row execute function public.enforce_child_owner_matches_project();

-- -----------------------------------------------------------------------------
-- project_consents
-- -----------------------------------------------------------------------------

create table public.project_consents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  consent_type public.consent_type not null,
  granted boolean not null,
  -- Consent wording is versioned so a historical record states exactly what the
  -- customer agreed to, even after the copy changes.
  wording_version text not null check (char_length(wording_version) between 1 and 40),
  granted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint project_consents_unique_per_project unique (project_id, consent_type),
  constraint project_consents_granted_has_timestamp check (
    (granted and granted_at is not null) or (not granted and granted_at is null)
  )
);

create index project_consents_project_idx on public.project_consents (project_id);
create index project_consents_user_idx on public.project_consents (user_id);

create trigger project_consents_enforce_owner
  before insert or update on public.project_consents
  for each row execute function public.enforce_child_owner_matches_project();

-- -----------------------------------------------------------------------------
-- project_status_history
-- -----------------------------------------------------------------------------

create table public.project_status_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  from_status public.project_status,
  to_status public.project_status not null,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index project_status_history_project_idx
  on public.project_status_history (project_id, created_at desc);

-- History is written by the database, not by application code, so it cannot be
-- skipped by a caller that forgets.
create or replace function public.record_project_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_status_history (project_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, (select auth.uid()));
  elsif new.status is distinct from old.status then
    insert into public.project_status_history (project_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, (select auth.uid()));
  end if;
  return null;
end;
$$;

create trigger projects_record_status_change
  after insert or update of status on public.projects
  for each row execute function public.record_project_status_change();

-- -----------------------------------------------------------------------------
-- portfolio_items
-- -----------------------------------------------------------------------------

create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid references public.video_experiences (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (description is null or char_length(description) <= 1000),
  category public.experience_category not null,
  -- Public marketing media only. Customer uploads are never referenced here.
  media_url text,
  thumbnail_url text,
  featured boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.portfolio_items is
  'Publicly readable marketing showcase. Linking experience_id lets "Create Your Version" pre-select the matching template.';
comment on column public.portfolio_items.media_url is
  'Public marketing asset URL. Customer reference images are private and must never be surfaced here.';

create index portfolio_items_active_sort_idx
  on public.portfolio_items (active, sort_order, created_at desc);
create index portfolio_items_category_idx on public.portfolio_items (category);
create index portfolio_items_experience_idx on public.portfolio_items (experience_id);

create trigger portfolio_items_set_updated_at
  before update on public.portfolio_items
  for each row execute function public.set_updated_at();
