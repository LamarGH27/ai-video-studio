# H5: revision resolution requires a replacement preview

## Enforcement

Apply `20260101001100_revision_preview_resolution.sql` after migrations 00000–01000.
The existing delivery insert guard locks the parent project before assigning the
preview version. Revision requests and status updates use that same row lock.
An inserted preview resolves only an OPEN revision on its own project whose
rejected preview is a different PREVIEW_VIDEO asset with a lower database-assigned
version. The revision records `resolved_by_preview_asset_id` and `resolved_at`.

The generic status resolver is removed. Entering PREVIEW_READY with an OPEN
revision raises SQLSTATE 23514, including for system/break-glass status updates.
`record_delivery_asset` still inserts and announces the preview in one transaction:
failure rolls back the asset, resolution, status and notification together.
Direct permitted admin asset inserts use the same resolution trigger, but do not
announce a preview until the existing status workflow does so.

Confirmation replay still uses the existing H1 Server Action lookup/recovery path;
it returns the committed asset without another insert. The underlying delivery
RPC is not itself a success-on-replay API: a duplicate RPC is refused by the stage
or unique object constraint. No Storage deletion behaviour changes.

## Migration and operations

- Use the migration runner's transaction and migration history; apply once. For a
  manual SQL Editor application, wrap this migration in BEGIN/COMMIT. Do not apply
  individual statements while traffic is active. No data reset is required.
- Test on staging first. No production migration is authorized by this change.
- Existing resolved revisions are left unchanged, with a NULL resolving asset.
  The migration cannot reconstruct whether old status-only resolutions were valid.
  Review historical disputed resolutions separately; do not fabricate associations.
- An OPEN revision with a missing rejected asset fails closed. Inspect these before
  rollout with the read-only query below. Restore or establish the actual rejected
  asset through a reviewed repair before attempting to deliver that revision.
- The new foreign key prevents independent deletion of a resolving asset while its
  revision refers to it. Whole-project deletion can still cascade both records;
  verify existing retention/operator workflows before rollout.
- Existing app instances remain compatible: the column is additive and RPC
  signatures are unchanged. A manual status-only reannouncement now receives the
  existing generic admin error. Uploading a new preview is the intended action.
- Version/identity prove a new recorded object, not that video content creatively
  addresses the customer's feedback. Media-content assessment remains human work.

```sql
select r.id, r.project_id, r.preview_asset_id
from public.project_revisions r
left join public.project_assets a on a.id = r.preview_asset_id
where r.status = 'OPEN'
  and (a.id is null or a.project_id <> r.project_id
       or a.asset_type <> 'PREVIEW_VIDEO');
```

## Notifications and verification

Notification code is unchanged. The existing status trigger still keys the preview
event by asset ID. A refused status-only announcement produces no new event;
a replacement RPC produces one event, and rollback/replay produce no duplicates.
This does not claim provider-level exactly-once email delivery (H6 is out of scope).

Run `npm test`, `npm run verify:db`, `npm run typecheck`, `npm run lint`, and
`npm run build` on Node 22.22.2. `verify:db` includes the H5 SQL lifecycle suite and
the independent-session races in `03_revision_resolution.mjs`, alongside H1–H4.
The enhanced `e2e/delivery-lifecycle.spec.ts` checks that the real admin action
cannot resolve the old preview and that uploading Preview 2 resolves the request.
Run it against staging only after the migration is applied. Native PostgreSQL
tests use a Supabase schema shim; they are not hosted Storage/PostgREST evidence.
