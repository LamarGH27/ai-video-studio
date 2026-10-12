-- H3: reference bytes are mutable only while their authoritative project is DRAFT.
-- Preserve reads and delivery policies. No asset row is required: upload precedes
-- confirmation. Legacy simple filenames are accepted alongside generated UUIDs.
create or replace function public.reference_object_path_valid(object_name text)
returns boolean language sql immutable strict set search_path = '' as $$
  select object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9_-]*[.](jpg|jpeg|png|webp)$'
$$;

create or replace function public.can_manage_draft_reference(object_name text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(
    public.reference_object_path_valid(object_name)
    and split_part(object_name, '/', 1) = (select auth.uid())::text
    and exists (
      select 1 from public.projects p
      where p.id = case when public.reference_object_path_valid(object_name)
        then split_part(object_name, '/', 2)::uuid else null end
        and p.user_id = (select auth.uid()) and p.status = 'DRAFT'
    ), false)
$$;

revoke all on function public.reference_object_path_valid(text),
  public.can_manage_draft_reference(text) from public, anon;
grant execute on function public.reference_object_path_valid(text),
  public.can_manage_draft_reference(text) to authenticated, service_role;

alter policy "reference-images: owner can upload into own folder" on storage.objects
  with check (bucket_id = 'reference-images' and public.can_manage_draft_reference(name));
alter policy "reference-images: owner can replace own objects" on storage.objects
  using (bucket_id = 'reference-images' and public.can_manage_draft_reference(name))
  with check (bucket_id = 'reference-images' and public.can_manage_draft_reference(name));
alter policy "reference-images: owner can delete own objects" on storage.objects
  using (bucket_id = 'reference-images' and public.can_manage_draft_reference(name));

-- Storage redeems signed upload tokens and finalises some writes using a
-- privileged connection. RLS alone cannot revoke a token issued before submit.
-- Enforce state again at the actual row write, including privileged writes.
-- FOR SHARE conflicts with project status updates and is held until commit:
-- either the object mutation precedes submission or it observes non-DRAFT.
-- This is deliberately NOT bypassed by service_role. Submitted reference repair
-- or retention deletion requires an explicit operator maintenance procedure.
create or replace function public.guard_reference_object_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  paths text[] := array[]::text[];
  object_name text;
  project_state public.project_status;
begin
  if tg_op <> 'INSERT' and old.bucket_id = 'reference-images' then
    paths := array_append(paths, old.name);
  end if;
  if tg_op <> 'DELETE' and new.bucket_id = 'reference-images' then
    paths := array_append(paths, new.name);
  end if;
  -- Stable lock order when moving between two draft projects.
  for object_name in select distinct unnest(paths) order by 1 loop
    if not coalesce(public.reference_object_path_valid(object_name), false) then
      raise exception 'Invalid reference object path' using errcode = '42501';
    end if;
    select p.status into project_state from public.projects p
    where p.id = split_part(object_name, '/', 2)::uuid
      and p.user_id::text = split_part(object_name, '/', 1)
    for share;
    if not found or project_state <> 'DRAFT' then
      raise exception 'Reference objects require an existing owned draft project'
        using errcode = '42501';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_reference_object_mutation() from public, anon, authenticated, service_role;
drop trigger if exists reference_objects_draft_guard on storage.objects;
create trigger reference_objects_draft_guard
  before insert or update or delete on storage.objects
  for each row execute function public.guard_reference_object_mutation();
