-- H2: a committed deletion claim bridges the database/Storage HTTP boundary.
-- Claims never expire: a delayed Storage DELETE must not remove a reused path.
-- No parent FK/cascade: even project deletion must not make a claimed name reusable.
create table if not exists public.reference_orphan_claims (
  storage_path text primary key,
  project_id uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.reference_orphan_claims enable row level security;
revoke all on public.reference_orphan_claims from public, anon, authenticated, service_role;

create or replace function public.claim_reference_orphans(p_project_id uuid, p_paths text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  p public.projects%rowtype;
  object_path text;
  claimed text[] := array[]::text[];
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- PostgREST uses READ COMMITTED. A caller's older repeatable snapshot must
  -- never decide asset absence after waiting for another transaction's lock.
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Reference cleanup requires READ COMMITTED' using errcode = '25001';
  end if;
  if p_paths is null or cardinality(p_paths) > 100 then
    raise exception 'Cleanup requires at most 100 paths' using errcode = '22023';
  end if;
  -- The same exclusive lock used by confirmation, child writes and submission.
  select * into p from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found then raise exception 'Project not found' using errcode = '42501'; end if;
  if p.status <> 'DRAFT' then return claimed; end if;
  for object_path in select distinct unnest(p_paths) order by 1 loop
    if not coalesce(public.reference_object_path_valid(object_path), false)
      or split_part(object_path,'/',1) <> p.user_id::text
      or split_part(object_path,'/',2) <> p.id::text then
      raise exception 'Invalid cleanup path' using errcode = '42501';
    end if;
    -- Recheck under the project lock, using authoritative database metadata.
    -- A committed asset can never acquire a cleanup claim, even on replay.
    if exists (select 1 from public.project_assets
      where storage_bucket = 'reference-images' and storage_path = object_path) then
      continue;
    end if;
    if exists (select 1 from public.reference_orphan_claims where storage_path = object_path)
      or exists (select 1 from storage.objects where bucket_id = 'reference-images'
        and name = object_path and created_at < now() - interval '1 hour') then
      insert into public.reference_orphan_claims(storage_path,project_id)
        values (object_path,p.id) on conflict (storage_path) do nothing;
      claimed := array_append(claimed,object_path);
    end if;
  end loop;
  return claimed;
end;
$$;

-- Enforce the claim at the authoritative asset INSERT, including privileged
-- inserts. The existing H4 guard still validates the object and draft state.
-- Confirmation's existing read-only replay is unchanged.
create or replace function public.guard_reference_asset_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.asset_type = 'REFERENCE_IMAGE' then
    if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
      raise exception 'Reference confirmation requires READ COMMITTED' using errcode = '25001';
    end if;
    perform 1 from public.projects where id = new.project_id for update;
    if exists (select 1 from public.reference_orphan_claims where storage_path = new.storage_path) then
      raise exception 'Reference is claimed for deletion; upload to a new path' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists project_assets_orphan_claim_guard on public.project_assets;
create trigger project_assets_orphan_claim_guard before insert on public.project_assets
  for each row execute function public.guard_reference_asset_claim();

-- Never reuse a claimed path, even after deletion succeeds. Otherwise an old
-- in-flight DELETE/retry could erase a newly uploaded object at that same name.
-- H3's draft guard runs first and holds FOR SHARE until commit; that conflicts
-- with the claim RPC's FOR UPDATE. Do not change H3's DELETE or state rules.
create or replace function public.guard_reference_storage_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.bucket_id = 'reference-images' or (tg_op = 'UPDATE' and old.bucket_id = 'reference-images'))
    and current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Reference writes require READ COMMITTED' using errcode = '25001';
  end if;
  if (new.bucket_id = 'reference-images' and exists (
      select 1 from public.reference_orphan_claims where storage_path = new.name)) then
    raise exception 'Reference path is retired by cleanup' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.bucket_id = 'reference-images' and exists (
      select 1 from public.reference_orphan_claims where storage_path = old.name) then
    raise exception 'Reference path is retired by cleanup' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists reference_objects_orphan_claim_guard on storage.objects;
create trigger reference_objects_orphan_claim_guard before insert or update on storage.objects
  for each row execute function public.guard_reference_storage_claim();

revoke all on function public.claim_reference_orphans(uuid,text[]),
  public.guard_reference_asset_claim(), public.guard_reference_storage_claim()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_reference_orphans(uuid,text[]) to authenticated;
