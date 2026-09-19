-- H5: resolution records a replacement preview, never a status announcement.
-- Historical resolutions have no provable resolving asset: leave them NULL.
alter table public.project_revisions
  add column resolved_by_preview_asset_id uuid
    references public.project_assets(id);

comment on column public.project_revisions.resolved_by_preview_asset_id is
  'The newly recorded preview that resolved this revision. NULL for historical resolutions; never inferred from current project status.';

drop trigger projects_resolve_revisions on public.projects;

create or replace function public.resolve_revisions_on_new_preview()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The existing delivery BEFORE INSERT trigger holds the project row lock,
  -- then assigns a monotonically increasing version. Revision requests take
  -- the same lock. Versions, unlike transaction timestamps, order both paths.
  update public.project_revisions r
  set status = 'RESOLVED', resolved_at = now(),
      resolved_by_preview_asset_id = new.id
  from public.project_assets rejected
  where r.project_id = new.project_id
    and r.status = 'OPEN'
    and rejected.id = r.preview_asset_id
    and rejected.project_id = new.project_id
    and rejected.asset_type = 'PREVIEW_VIDEO'
    and rejected.id <> new.id
    and rejected.version < new.version;
  -- Missing rejected assets deliberately fail closed; do not invent a baseline.
  return null;
end;
$$;

revoke all on function public.resolve_revisions_on_new_preview() from public;

create trigger project_assets_resolve_revisions
  after insert on public.project_assets
  for each row when (new.asset_type = 'PREVIEW_VIDEO')
  execute function public.resolve_revisions_on_new_preview();

create function public.require_revision_replacement_preview()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- UPDATE already holds the same project row lock as preview recording and
  -- revision requests. This guard also applies to privileged/system updates.
  if exists (
    select 1 from public.project_revisions r
    where r.project_id = new.id and r.status = 'OPEN'
  ) then
    raise exception 'Upload a new preview before announcing a revised preview'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.require_revision_replacement_preview() from public;

create trigger projects_require_revision_replacement
  before update of status on public.projects
  for each row
  when (new.status = 'PREVIEW_READY' and old.status is distinct from new.status)
  execute function public.require_revision_replacement_preview();
