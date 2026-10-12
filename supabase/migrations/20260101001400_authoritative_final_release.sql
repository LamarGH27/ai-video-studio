-- Blocker 2: final confirmation and release are separate database boundaries.
-- No API role can write the confirmation/release ledger directly.
create schema final_delivery;
revoke all on schema final_delivery from public, anon, authenticated, service_role;
create table final_delivery.confirmations (
  asset_id uuid primary key references public.project_assets(id) on delete cascade,
  object_id uuid not null unique,
  confirmed_at timestamptz not null default clock_timestamp()
);
create table final_delivery.releases (
  project_id uuid primary key references public.projects(id) on delete cascade,
  asset_id uuid not null unique references public.project_assets(id) on delete cascade,
  released_by uuid not null,
  released_at timestamptz not null default clock_timestamp()
);
revoke all on all tables in schema final_delivery from public, anon, authenticated, service_role;

create function public.is_released_final(p_asset_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from final_delivery.releases r
    join public.projects p on p.id=r.project_id
    join public.project_assets a on a.id=r.asset_id and a.project_id=p.id and a.user_id=p.user_id
    join final_delivery.confirmations c on c.asset_id=a.id
    join storage.objects o on o.id=c.object_id and o.bucket_id=a.storage_bucket and o.name=a.storage_path
    where r.asset_id=p_asset_id and p.status='COMPLETED' and a.asset_type='FINAL_VIDEO'
      and not public.project_is_erasing(p.id)
      and (p.user_id=auth.uid() or public.is_admin())
  )
$$;
revoke all on function public.is_released_final(uuid) from public, anon, service_role;
grant execute on function public.is_released_final(uuid) to authenticated;

create function final_delivery.guard_completion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='COMPLETED' and not exists (
    select 1 from final_delivery.releases r join public.project_assets a on a.id=r.asset_id
    join final_delivery.confirmations c on c.asset_id=a.id
    join storage.objects o on o.id=c.object_id and o.bucket_id=a.storage_bucket and o.name=a.storage_path
    where r.project_id=new.id and a.project_id=new.id and a.user_id=new.user_id
      and a.asset_type='FINAL_VIDEO'
  ) then raise exception 'Completion requires an authoritative final release' using errcode='42501'; end if;
  if tg_op='UPDATE' and old.status='COMPLETED' and new.status<>'COMPLETED' then
    raise exception 'A released project cannot be reopened' using errcode='42501'; end if;
  return new;
end $$;
create trigger projects_01_final_release before insert or update on public.projects
  for each row execute function final_delivery.guard_completion();

create function final_delivery.guard_asset()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.asset_type='FINAL_VIDEO' then
    if tg_op='DELETE' and exists(select 1 from operator_maintenance.project_erasures
      where project_id=old.project_id and phase='FINALIZING') then return old; end if;
    raise exception 'Final asset identity is immutable; use operator erasure' using errcode='42501';
  end if;
  if tg_op='UPDATE' and new.asset_type='FINAL_VIDEO' then
    raise exception 'Final assets must be newly confirmed' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger project_assets_03_final_identity before update or delete on public.project_assets
  for each row execute function final_delivery.guard_asset();

create function final_delivery.guard_object()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.bucket_id='project-deliveries' and exists (
    select 1 from final_delivery.confirmations c join public.project_assets a on a.id=c.asset_id
    where c.object_id=old.id or (a.storage_bucket=old.bucket_id and a.storage_path=old.name)
  ) then
    if tg_op='DELETE' and operator_maintenance.storage_delete_allowed(old.bucket_id,old.name) then return old; end if;
    raise exception 'Confirmed final media is immutable; use operator erasure' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger objects_01_final_identity before update or delete on storage.objects
  for each row execute function final_delivery.guard_object();

create function public.release_final_video(p_project_id uuid, p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.projects; a public.project_assets; chosen uuid;
begin
  if not public.is_admin() then raise exception 'Project not found' using errcode='42501'; end if;
  select * into p from public.projects where id=p_project_id for update;
  if p.id is null or public.project_is_erasing(p.id) then
    raise exception 'Project not found' using errcode='42501'; end if;
  select asset_id into chosen from final_delivery.releases where project_id=p.id;
  if chosen is not null then
    if chosen=p_asset_id and public.is_released_final(chosen) then
      return jsonb_build_object('assetId',chosen,'status','COMPLETED');
    end if;
    raise exception 'A different final has already been released' using errcode='40001';
  end if;
  if p.status<>'FINALISING' then raise exception 'Project is not finalising' using errcode='42501'; end if;
  select * into a from public.project_assets where id=p_asset_id and project_id=p.id
    and user_id=p.user_id and asset_type='FINAL_VIDEO' and storage_bucket='project-deliveries';
  if a.id is null or not exists (
    select 1 from final_delivery.confirmations c join storage.objects o on o.id=c.object_id
    where c.asset_id=a.id and o.bucket_id=a.storage_bucket and o.name=a.storage_path
      and o.metadata->>'mimetype'=a.mime_type and (o.metadata->>'size')::bigint=a.file_size
  ) then raise exception 'A confirmed final object is required' using errcode='42501'; end if;
  if exists(select 1 from public.project_assets where project_id=p.id and asset_type='FINAL_VIDEO' and version>a.version) then
    raise exception 'A newer final exists; review it before release' using errcode='40001'; end if;
  insert into final_delivery.releases(project_id,asset_id,released_by) values(p.id,a.id,auth.uid());
  update public.projects set status='COMPLETED' where id=p.id;
  -- Existing H6 outbox trigger runs in this transaction, with its existing dedupe key.
  return jsonb_build_object('assetId',a.id,'status','COMPLETED');
end $$;
revoke all on function public.release_final_video(uuid,uuid) from public, anon, service_role;
grant execute on function public.release_final_video(uuid,uuid) to authenticated;

create policy "final assets require authoritative release" on public.project_assets
  as restrictive for select to authenticated
  using(asset_type<>'FINAL_VIDEO' or public.is_admin() or public.is_released_final(id));

-- Restrictive policy also applies to the existing admin ALL policy.
-- Final bytes use authenticated GET, never newly minted transferable read URLs.
create policy "delivery reads require authoritative asset" on storage.objects
  as restrictive for select to authenticated using (
    bucket_id<>'project-deliveries' or (
      (public.is_admin() or exists (
        select 1 from public.project_assets a where a.storage_bucket=bucket_id and a.storage_path=name
          and a.user_id=auth.uid() and (a.asset_type='PREVIEW_VIDEO' or public.is_released_final(a.id))
      )) and (
        storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info','object.list','object.list_v2','object.sign_upload_url','object.upload','object.upload_signed','object.upload_update','object.delete','object.delete_many','object.move','object.copy'])
        or exists(select 1 from public.project_assets a where a.storage_bucket=bucket_id
          and a.storage_path=name and a.asset_type='PREVIEW_VIDEO')
      ) and (
        public.is_admin() or exists(select 1 from public.project_assets a where a.storage_bucket=bucket_id
          and a.storage_path=name and a.asset_type='PREVIEW_VIDEO')
        or storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info'])
      )
    )
  );
revoke all on all functions in schema final_delivery from public, anon, authenticated, service_role;

create or replace function public.record_delivery_asset(
  p_project_id uuid,
  p_asset_type public.asset_type,
  p_storage_path text,
  p_mime_type text,
  p_original_filename text,
  p_file_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid;
  v_status   public.project_status;
  v_asset_id uuid;
  v_version  integer;
  v_existing public.project_assets;
  v_object storage.objects;
begin
  if not public.is_admin() then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  if p_asset_type not in ('PREVIEW_VIDEO', 'FINAL_VIDEO') then
    raise exception 'Only delivery assets are recorded through this function'
      using errcode = '42501';
  end if;

  -- The lock, before anything is read that the decision depends on.
  select p.user_id, p.status into v_owner, v_status
  from public.projects p
  where p.id = p_project_id
  for update;

  if v_owner is null then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  if public.project_is_erasing(p_project_id) then
    raise exception 'Project not found' using errcode='42501'; end if;
  if p_asset_type='FINAL_VIDEO' then
    select * into v_existing from public.project_assets where storage_bucket='project-deliveries'
      and storage_path=p_storage_path;
    if v_existing.id is not null then
      if v_existing.project_id=p_project_id and v_existing.user_id=v_owner
        and v_existing.asset_type='FINAL_VIDEO' and exists(select 1 from final_delivery.confirmations where asset_id=v_existing.id) then
        return jsonb_build_object('assetId',v_existing.id,'version',v_existing.version,'status',v_status);
      end if;
      raise exception 'Existing asset is not a confirmed final for this project' using errcode='42501';
    end if;
    select * into v_object from storage.objects where bucket_id='project-deliveries'
      and name=p_storage_path for share;
    if v_object.id is null or v_object.metadata->>'mimetype' is distinct from p_mime_type
      or (v_object.metadata->>'size')::bigint is distinct from p_file_size
      or p_file_size>1073741824 then
      raise exception 'Final upload metadata does not match Storage' using errcode='42501'; end if;
  end if;

  if p_asset_type = 'PREVIEW_VIDEO' and v_status <> 'IN_PRODUCTION' then
    raise exception
      'A preview can only be uploaded while the project is in production'
      using errcode = '42501';
  end if;

  if p_asset_type = 'FINAL_VIDEO' and v_status <> 'FINALISING' then
    raise exception
      'A final video can only be uploaded once the customer has approved a preview'
      using errcode = '42501';
  end if;

  -- The path is treated as untrusted even though this application generated it:
  -- it must address the customer's own folder for this project, which is the
  -- only place their storage read policy can reach.
  if p_storage_path is null
     or p_storage_path not like (v_owner::text || '/' || p_project_id::text || '/%') then
    raise exception 'That upload does not belong to this project' using errcode = '42501';
  end if;

  if p_mime_type not in ('video/mp4', 'video/webm') then
    raise exception 'Delivery videos must be MP4 or WebM' using errcode = '22023';
  end if;

  if p_file_size is null or p_file_size <= 0 then
    raise exception 'That upload is empty' using errcode = '22023';
  end if;

  insert into public.project_assets
    (project_id, user_id, asset_type, storage_bucket, storage_path,
     mime_type, original_filename, file_size)
  values
    (p_project_id, v_owner, p_asset_type, 'project-deliveries', p_storage_path,
     p_mime_type, nullif(btrim(coalesce(p_original_filename, '')), ''), p_file_size)
  returning id, version into v_asset_id, v_version;

  if p_asset_type='FINAL_VIDEO' then
    insert into final_delivery.confirmations(asset_id,object_id) values(v_asset_id,v_object.id);
  end if;

  -- A preview nobody is told about is not a delivery, so the announcement is
  -- part of the same transaction rather than a follow-up request that might not
  -- happen. The final video does NOT auto-complete: an administrator confirms.
  if p_asset_type = 'PREVIEW_VIDEO' then
    update public.projects set status = 'PREVIEW_READY' where id = p_project_id;
    v_status := 'PREVIEW_READY';
  end if;

  return jsonb_build_object(
    'assetId', v_asset_id, 'version', v_version, 'status', v_status);
end;
$$;
