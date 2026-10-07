-- Operator-only, resumable erasure. No retention duration is selected here.
-- Apply after 012. This schema must NEVER be exposed through PostgREST.
create schema operator_maintenance;
revoke all on schema operator_maintenance from public, anon, authenticated, service_role;

create table operator_maintenance.project_erasures (
  project_id uuid primary key, -- permanent namespace tombstone; no cascade
  owner_id uuid not null,
  case_reference text not null check (case_reference ~ '^[A-Za-z0-9_-]{1,100}$'),
  purpose text not null check (purpose in ('ERASURE','RETENTION','OPERATOR_DELETION')),
  requested_by name not null default session_user,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  phase text not null default 'DELETING' check (phase in ('DELETING','FINALIZING','COMPLETE')),
  object_count integer not null default 0
);
create table operator_maintenance.erasure_objects (
  project_id uuid not null references operator_maintenance.project_erasures(project_id),
  bucket_id text not null check (bucket_id in ('reference-images','project-deliveries')),
  object_name text not null,
  deleted_at timestamptz,
  primary key (bucket_id,object_name)
);
create table operator_maintenance.account_erasures (
  user_id uuid primary key,
  case_reference text not null check (case_reference ~ '^[A-Za-z0-9_-]{1,100}$'),
  requested_by name not null default session_user,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
revoke all on all tables in schema operator_maintenance from public, anon, authenticated, service_role;

-- Boolean policy helper; never returns manifest paths, audit data or case IDs.
create function public.project_is_erasing(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from operator_maintenance.project_erasures where project_id=p_id)
$$;
revoke all on function public.project_is_erasing(uuid) from public, anon;
grant execute on function public.project_is_erasing(uuid) to authenticated, service_role;

-- Hide partially erased projects/assets rather than displaying dangling media.
create policy projects_erasure_read_guard on public.projects as restrictive for select
  to authenticated using (not public.project_is_erasing(id));
create policy assets_erasure_read_guard on public.project_assets as restrictive for select
  to authenticated using (not public.project_is_erasing(project_id));
create function public.storage_project_is_erasing(path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from operator_maintenance.project_erasures
    where project_id::text=split_part(path,'/',2))
$$;
revoke all on function public.storage_project_is_erasing(text) from public, anon;
grant execute on function public.storage_project_is_erasing(text) to authenticated, service_role;
create policy storage_erasure_read_guard on storage.objects as restrictive for select
  to authenticated using (bucket_id not in ('reference-images','project-deliveries')
    or not public.storage_project_is_erasing(name));

create function operator_maintenance.guard_project()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pid uuid := case when tg_op='DELETE' then old.id else new.id end;
begin
  if tg_op='UPDATE' and old.id is distinct from new.id and exists(
    select 1 from operator_maintenance.project_erasures where project_id=old.id) then
    raise exception 'Project is retired for erasure' using errcode='42501'; end if;
  if exists(select 1 from operator_maintenance.project_erasures where project_id=pid) then
    if tg_op='DELETE' and exists(select 1 from operator_maintenance.project_erasures
        where project_id=pid and phase='FINALIZING') then return old; end if;
    raise exception 'Project is retired for erasure' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    -- Account prepare locks this same row before enumerating its projects.
    perform 1 from public.profiles where id=new.user_id for share;
    if exists(select 1 from operator_maintenance.account_erasures where user_id=new.user_id) then
      raise exception 'Account is retired for erasure' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger "00_operator_erasure" before insert or update or delete on public.projects
  for each row execute function operator_maintenance.guard_project();

create function operator_maintenance.guard_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pid uuid := case when tg_op='DELETE' then old.project_id else new.project_id end;
begin
  if tg_op='UPDATE' and old.project_id is distinct from new.project_id then
    perform 1 from public.projects where id=old.project_id for update;
    if exists(select 1 from operator_maintenance.project_erasures where project_id=old.project_id) then
      raise exception 'Project is retired for erasure' using errcode='42501'; end if;
  end if;
  perform 1 from public.projects where id=pid for update;
  if exists(select 1 from operator_maintenance.project_erasures where project_id=pid) then
    if tg_op='DELETE' and exists(select 1 from operator_maintenance.project_erasures
        where project_id=pid and phase='FINALIZING') then return old; end if;
    raise exception 'Project is retired for erasure' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger "00_operator_erasure" before insert or update or delete on public.project_assets
  for each row execute function operator_maintenance.guard_child();
create trigger "00_operator_erasure" before insert or update or delete on public.project_consents
  for each row execute function operator_maintenance.guard_child();
create trigger "00_operator_erasure" before insert or update or delete on public.project_revisions
  for each row execute function operator_maintenance.guard_child();
create trigger "00_operator_erasure" before insert or update or delete on public.project_preview_approvals
  for each row execute function operator_maintenance.guard_child();
create trigger "00_operator_erasure" before insert on public.reference_orphan_claims
  for each row execute function operator_maintenance.guard_child();
-- Enqueue only: do not change H6 claim/acknowledgement lock ordering.
create trigger "00_operator_erasure" before insert on public.notification_outbox
  for each row execute function operator_maintenance.guard_child();

create function operator_maintenance.storage_delete_allowed(bucket text, path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.role()='service_role',false) and exists (
    select 1 from operator_maintenance.erasure_objects o
    join operator_maintenance.project_erasures e using(project_id)
    where o.bucket_id=bucket and o.object_name=path and e.phase='DELETING')
$$;

create function operator_maintenance.guard_storage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare obj record; pid uuid;
begin
  -- Examine both names on UPDATE; neither a move into nor out of erasure escapes.
  for obj in
    select old.bucket_id as bucket, old.name as path where tg_op<>'INSERT'
    union all select new.bucket_id,new.name where tg_op<>'DELETE'
  loop
    if obj.bucket in ('reference-images','project-deliveries') then
      perform 1 from public.profiles where id::text=split_part(obj.path,'/',1) for share;
      if tg_op<>'DELETE' and exists(select 1 from operator_maintenance.account_erasures
          where user_id::text=split_part(obj.path,'/',1)) then
        raise exception 'Account storage is retired for erasure' using errcode='42501'; end if;
      select id into pid from public.projects where id::text=split_part(obj.path,'/',2) for share;
      if exists(select 1 from operator_maintenance.project_erasures
          where project_id::text=split_part(obj.path,'/',2)) then
        if tg_op<>'DELETE' or not operator_maintenance.storage_delete_allowed(obj.bucket,obj.path) then
          raise exception 'Storage namespace is retired for erasure' using errcode='42501';
        end if;
      end if;
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger "00_operator_erasure" before insert or update or delete on storage.objects
  for each row execute function operator_maintenance.guard_storage();

-- Only this exact, inventoried DELETE exception is added to H3. No blanket
-- service-role bypass, mutable session setting, or customer capability.
create or replace function public.guard_reference_object_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare paths text[] := array[]::text[]; object_name text; project_state public.project_status;
begin
  if tg_op='DELETE' and old.bucket_id='reference-images'
    and operator_maintenance.storage_delete_allowed(old.bucket_id,old.name) then return old; end if;
  if tg_op <> 'INSERT' and old.bucket_id = 'reference-images' then paths := array_append(paths,old.name); end if;
  if tg_op <> 'DELETE' and new.bucket_id = 'reference-images' then paths := array_append(paths,new.name); end if;
  for object_name in select distinct unnest(paths) order by 1 loop
    if not coalesce(public.reference_object_path_valid(object_name),false) then
      raise exception 'Invalid reference object path' using errcode='42501';
    end if;
    select p.status into project_state from public.projects p
      where p.id=split_part(object_name,'/',2)::uuid and p.user_id::text=split_part(object_name,'/',1) for share;
    if not found or project_state<>'DRAFT' then
      raise exception 'Reference objects require an existing owned draft project' using errcode='42501';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create function operator_maintenance.prepare_project(pid uuid, case_id text, reason text)
returns void language plpgsql security invoker set search_path = '' as $$
declare uid uuid; prefix text;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Erasure requires READ COMMITTED' using errcode='25001'; end if;
  select user_id into uid from public.projects where id=pid for update;
  if exists(select 1 from operator_maintenance.project_erasures where project_id=pid) then
    if not exists(select 1 from operator_maintenance.project_erasures
      where project_id=pid and case_reference=case_id and purpose=reason) then
      raise exception 'Erasure case mismatch' using errcode='22023'; end if;
    return;
  end if;
  if uid is null then raise exception 'Project not found' using errcode='22023'; end if;
  prefix:=uid::text||'/'||pid::text||'/';
  if exists(select 1 from public.project_assets where project_id=pid
    and (storage_bucket not in ('reference-images','project-deliveries')
      or left(storage_path,length(prefix))<>prefix)) then
    raise exception 'Asset scope requires operator investigation' using errcode='23514'; end if;
  -- Locks conflict with claims. Never erase a row already handed to a worker,
  -- even when its lease looks expired: provider acceptance may be unknown.
  perform 1 from public.notification_outbox where project_id=pid for update;
  if exists(select 1 from public.notification_outbox where project_id=pid and status='PROCESSING') then
    raise exception 'Drain and reconcile in-flight notifications first' using errcode='55000'; end if;
  insert into operator_maintenance.project_erasures(project_id,owner_id,case_reference,purpose)
    values(pid,uid,case_id,reason);
  insert into operator_maintenance.erasure_objects(project_id,bucket_id,object_name)
    select pid,bucket_id,name from storage.objects
      where bucket_id in ('reference-images','project-deliveries') and left(name,length(prefix))=prefix
    union select pid,storage_bucket,storage_path from public.project_assets where project_id=pid;
  update operator_maintenance.project_erasures set object_count=(select count(*) from operator_maintenance.erasure_objects where project_id=pid) where project_id=pid;
  -- Remove queued/terminal personal payloads atomically with the freeze. New
  -- enqueues are blocked. H6 claim/ack implementation remains unchanged.
  delete from public.notification_outbox where project_id=pid;
end $$;

create function operator_maintenance.record_storage_deletion(pid uuid, bucket text, path text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from operator_maintenance.project_erasures where project_id=pid for update;
  if exists(select 1 from storage.objects where bucket_id=bucket and name=path) then
    raise exception 'Storage object still exists' using errcode='55000'; end if;
  update operator_maintenance.erasure_objects set deleted_at=coalesce(deleted_at,clock_timestamp())
    where project_id=pid and bucket_id=bucket and object_name=path;
  if not found then raise exception 'Object outside erasure manifest' using errcode='42501'; end if;
end $$;

create function operator_maintenance.finish_project(pid uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare e operator_maintenance.project_erasures;
begin
  perform 1 from public.projects where id=pid for update;
  select * into strict e from operator_maintenance.project_erasures where project_id=pid for update;
  if e.phase='COMPLETE' then return; end if;
  if exists(select 1 from operator_maintenance.erasure_objects where project_id=pid and deleted_at is null)
    or exists(select 1 from storage.objects where bucket_id in ('reference-images','project-deliveries')
      and name like e.owner_id::text||'/'||pid::text||'/%') then
    raise exception 'Physical Storage deletion is incomplete' using errcode='55000'; end if;
  update operator_maintenance.project_erasures set phase='FINALIZING' where project_id=pid;
  -- Revisions reference both rejected and resolving assets; remove them before
  -- parent cascade. H4's existing cascade guard handles other child deletes.
  delete from public.project_revisions where project_id=pid;
  delete from public.projects where id=pid;
  update operator_maintenance.project_erasures set phase='COMPLETE',completed_at=clock_timestamp() where project_id=pid;
end $$;

create function operator_maintenance.prepare_account(uid uuid, case_id text)
returns uuid[] language plpgsql security invoker set search_path = '' as $$
declare ids uuid[];
begin
  perform 1 from public.profiles where id=uid for update;
  if not found and not exists(select 1 from operator_maintenance.account_erasures where user_id=uid and case_reference=case_id) then raise exception 'Account not found' using errcode='22023'; end if;
  insert into operator_maintenance.account_erasures(user_id,case_reference) values(uid,case_id)
    on conflict(user_id) do nothing;
  if not exists(select 1 from operator_maintenance.account_erasures where user_id=uid and case_reference=case_id) then
    raise exception 'Account erasure case mismatch' using errcode='22023'; end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into ids from public.projects where user_id=uid;
  return ids;
end $$;

-- This check deliberately refuses unknown buckets/orphans. Do not silently
-- guess ownership or delete all matching data without a reviewed inventory.
create function operator_maintenance.account_ready(uid uuid, case_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.profiles where id=uid for update;
  if not exists(select 1 from operator_maintenance.account_erasures where user_id=uid and case_reference=case_id) then
    raise exception 'Account erasure is not authorised' using errcode='42501'; end if;
  if exists(select 1 from public.projects where user_id=uid)
    or exists(select 1 from storage.objects where split_part(name,'/',1)=uid::text)
    or exists(select 1 from public.notification_outbox where recipient_user_id=uid and status='PROCESSING') then
    raise exception 'Account resources require further erasure or reconciliation' using errcode='55000'; end if;
  delete from public.notification_outbox where recipient_user_id=uid;
end $$;

create function operator_maintenance.finish_account(uid uuid, case_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from auth.users where id=uid) or exists(select 1 from public.profiles where id=uid)
    or exists(select 1 from public.projects where user_id=uid)
    or exists(select 1 from storage.objects where split_part(name,'/',1)=uid::text)
    or exists(select 1 from public.notification_outbox where recipient_user_id=uid) then
    raise exception 'Account erasure is incomplete' using errcode='55000'; end if;
  update operator_maintenance.account_erasures set completed_at=coalesce(completed_at,clock_timestamp())
    where user_id=uid and case_reference=case_id;
  if not found then raise exception 'Account erasure is not authorised' using errcode='42501'; end if;
end $$;

-- No new role or public/service-role grant. Only the trusted database operator
-- owning this schema can prepare, acknowledge or finalize an erasure.
revoke all on all functions in schema operator_maintenance from public, anon, authenticated, service_role;
