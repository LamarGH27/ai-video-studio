-- H4: authoritative confirmation and atomic submission. Historical submitted
-- projects are not rewritten. Legacy draft assets are revalidated at submission.
-- Deploy together with the Server Actions that call these RPCs.
alter policy "projects: owner can update own draft projects" on public.projects
  with check (user_id = (select auth.uid()) and status = 'DRAFT');
drop policy if exists "project_assets: owner can add reference images to own draft" on public.project_assets;
drop policy if exists "project_consents: owner can record consent on own draft" on public.project_consents;
drop policy if exists "project_consents: owner can revise consent on own draft" on public.project_consents;

-- Only Storage's system metadata is used; user_metadata is never consulted.
create or replace function public.valid_reference_object(
  p_project_id uuid, p_user_id uuid, p_path text, p_mime text, p_size bigint
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.reference_object_path_valid(p_path)
    and split_part(p_path, '/', 1) = p_user_id::text
    and split_part(p_path, '/', 2) = p_project_id::text
    and p_mime in ('image/jpeg','image/png','image/webp')
    and p_size between 1 and 10485760
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'reference-images' and o.name = p_path
        and o.metadata->>'mimetype' = p_mime
        and case when o.metadata->>'size' ~ '^[0-9]{1,10}$'
          then (o.metadata->>'size')::bigint = p_size else false end
    ), false)
$$;

-- All relevant child writes take the same exclusive project lock as submission.
-- Delivery asset guards remain unchanged. Consent identities never change.
create or replace function public.guard_submission_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  pid uuid;
  state public.project_status;
begin
  if tg_table_name = 'project_assets' then
    if tg_op = 'INSERT' and new.asset_type <> 'REFERENCE_IMAGE' then return new; end if;
    if tg_op = 'DELETE' and old.asset_type <> 'REFERENCE_IMAGE' then return old; end if;
    if tg_op = 'UPDATE' then
      if old.asset_type = 'REFERENCE_IMAGE' or new.asset_type = 'REFERENCE_IMAGE' then
        raise exception 'Reference asset records are immutable' using errcode = '42501';
      end if;
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.user_id is distinct from old.user_id
      or new.consent_type is distinct from old.consent_type then
      raise exception 'Consent identity is immutable' using errcode = '42501';
    end if;
  end if;

  pid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  select status into state from public.projects where id = pid for update;
  -- A permitted parent deletion cascades after the parent has disappeared.
  if not found and tg_op = 'DELETE' then return old; end if;
  if state is distinct from 'DRAFT' then
    raise exception 'Submission records require an editable draft' using errcode = '42501';
  end if;
  if tg_table_name = 'project_assets' and tg_op = 'INSERT' then
    if new.storage_bucket <> 'reference-images' or not public.valid_reference_object(
      new.project_id, new.user_id, new.storage_path, new.mime_type, new.file_size
    ) then
      raise exception 'A reference requires a valid uploaded Storage object' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists project_assets_submission_guard on public.project_assets;
create trigger project_assets_submission_guard before insert or update or delete
  on public.project_assets for each row execute function public.guard_submission_child();
drop trigger if exists project_consents_submission_guard on public.project_consents;
create trigger project_consents_submission_guard before insert or update or delete
  on public.project_consents for each row execute function public.guard_submission_child();

create or replace function public.confirm_reference_asset(
  p_project_id uuid, p_storage_path text, p_original_filename text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.projects%rowtype;
  a public.project_assets%rowtype;
  meta jsonb;
  bytes bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into p from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found or p.user_id <> auth.uid()
    or not coalesce(public.reference_object_path_valid(p_storage_path), false)
    or split_part(p_storage_path,'/',1) <> p.user_id::text
    or split_part(p_storage_path,'/',2) <> p.id::text then
    raise exception 'Reference does not belong to this project' using errcode = '42501';
  end if;
  select * into a from public.project_assets
    where storage_bucket = 'reference-images' and storage_path = p_storage_path;
  if found then
    if a.project_id <> p.id or a.user_id <> p.user_id or a.asset_type <> 'REFERENCE_IMAGE' then
      raise exception 'Reference already recorded elsewhere' using errcode = '42501';
    end if;
    return to_jsonb(a); -- Replay is read-only, including after submission.
  end if;
  if p.status <> 'DRAFT' then raise exception 'Project is not a draft' using errcode = '42501'; end if;
  select metadata into meta from storage.objects
    where bucket_id = 'reference-images' and name = p_storage_path;
  if meta->>'size' ~ '^[0-9]{1,10}$' then bytes := (meta->>'size')::bigint; end if;
  if not public.valid_reference_object(p.id,p.user_id,p_storage_path,meta->>'mimetype',bytes) then
    raise exception 'Uploaded reference is missing or invalid' using errcode = '23514';
  end if;
  if (select count(*) from public.project_assets where project_id = p.id and asset_type = 'REFERENCE_IMAGE') >= 10 then
    raise exception 'Reference image limit reached' using errcode = '23514';
  end if;
  insert into public.project_assets(project_id,user_id,asset_type,storage_bucket,storage_path,mime_type,file_size,original_filename)
    values (p.id,p.user_id,'REFERENCE_IMAGE','reference-images',p_storage_path,meta->>'mimetype',bytes,
      left(p_original_filename,300)) returning * into a;
  return to_jsonb(a);
end;
$$;

-- Defense in depth for admin/operator direct transitions as well as the RPC.
-- UPDATE already locks the parent. Child guards and H3 Storage locks keep the
-- predicates stable until commit. Historical non-draft INSERT/import is unchanged.
create or replace function public.guard_project_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'DRAFT' or new.status <> 'SUBMITTED' then return new; end if;
  if auth.uid() is not null and auth.uid() <> new.user_id
    and coalesce(public.request_jwt_role(),'') <> 'service_role' then
    raise exception 'Only the owner can submit' using errcode = '42501';
  end if;
  if new.brief is null
    -- Match the whitespace trimmed by the application's JavaScript schema.
    or char_length(btrim(new.brief, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')) not between 40 and 4000
    or new.orientation is null or new.desired_duration_seconds is null
    or new.desired_duration_seconds not between 5 and 180 or new.submitted_at is null then
    raise exception 'Submission brief is incomplete' using errcode = '23514';
  end if;
  if (select count(*) from public.project_consents c
      where c.project_id = new.id and c.user_id = new.user_id and c.granted
        and c.granted_at is not null and c.wording_version = '2026-09-15'
        and c.consent_type in ('HAS_LIKENESS_PERMISSION','AI_PROCESSING_CONSENT')) <> 2 then
    raise exception 'Both required current consents must be affirmative' using errcode = '23514';
  end if;
  if not exists (select 1 from public.project_assets a where a.project_id = new.id
      and a.user_id = new.user_id and a.asset_type = 'REFERENCE_IMAGE') then
    raise exception 'At least one confirmed reference is required' using errcode = '23514';
  end if;
  if exists (select 1 from public.project_assets a where a.project_id = new.id
      and a.asset_type = 'REFERENCE_IMAGE' and (
        a.user_id <> new.user_id or a.storage_bucket <> 'reference-images'
        or not public.valid_reference_object(new.id,new.user_id,a.storage_path,a.mime_type,a.file_size)
      )) then
    raise exception 'Confirmed references must match valid Storage objects' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists projects_submission_guard on public.projects;
create trigger projects_submission_guard before update of status on public.projects
  for each row execute function public.guard_project_submission();

create or replace function public.submit_project(
  p_project_id uuid, p_has_likeness_permission boolean,
  p_ai_processing_consent boolean, p_portfolio_permission boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.projects%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_has_likeness_permission is distinct from true
    or p_ai_processing_consent is distinct from true or p_portfolio_permission is null then
    raise exception 'Required consent must be affirmative' using errcode = '23514';
  end if;
  select * into p from public.projects where id = p_project_id and user_id = auth.uid() for update;
  if not found or p.user_id <> auth.uid() then
    raise exception 'Project not found' using errcode = '42501';
  end if;
  if p.status = 'SUBMITTED' and exists (
    select 1 from public.project_consents where project_id = p.id
      and consent_type = 'PORTFOLIO_PERMISSION' and granted = p_portfolio_permission
  ) then
    return jsonb_build_object('projectId',p.id,'publicReference',p.public_reference);
  end if;
  if p.status <> 'DRAFT' then raise exception 'Project already submitted' using errcode = '42501'; end if;
  insert into public.project_consents(project_id,user_id,consent_type,granted,wording_version,granted_at)
    select p.id,p.user_id,c.kind,c.granted,'2026-09-15',
      case when c.granted then now() else null end
    from (values ('HAS_LIKENESS_PERMISSION'::public.consent_type,true),
                 ('AI_PROCESSING_CONSENT'::public.consent_type,true),
                 ('PORTFOLIO_PERMISSION'::public.consent_type,p_portfolio_permission)) c(kind,granted)
    on conflict(project_id,consent_type) do update
      set granted = excluded.granted, wording_version = excluded.wording_version, granted_at = excluded.granted_at;
  update public.projects set status = 'SUBMITTED', submitted_at = now() where id = p.id;
  -- Existing history and notification triggers execute in the same transaction.
  return jsonb_build_object('projectId',p.id,'publicReference',p.public_reference);
end;
$$;

revoke all on function public.valid_reference_object(uuid,uuid,text,text,bigint),
  public.guard_submission_child(),public.guard_project_submission(),
  public.confirm_reference_asset(uuid,text,text), public.submit_project(uuid,boolean,boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_reference_asset(uuid,text,text),
  public.submit_project(uuid,boolean,boolean,boolean) to authenticated;
