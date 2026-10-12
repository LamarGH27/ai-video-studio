# Operator erasure and retention

Status: verified locally and against hosted staging on 6 October 2026. See operator-erasure-verification.md for evidence and limitations. No production rollout is authorised by this document.

## Scope and authority

Use an approved opaque case reference, exact project/account UUID, purpose and independently verified identity/authority. Record holds and retention decisions before execution. Do not put names, email addresses or personal narrative in the case reference. The case system must identify the human operator; database session_user alone identifies only the database principal.

The private operator_maintenance schema is not exposed through PostgREST. PUBLIC, anon, authenticated and service_role have no maintenance execution rights. A controlled direct postgres connection prepares and completes targeted jobs. An application admin is not an erasure operator. Storage service credentials may only delete the exact inventoried object of an active erasure job; normal H3 restrictions remain in force elsewhere.

## Invocation

Keep DATABASE_URL and SUPABASE_SECRET_KEY in an ignored access-restricted local file. Supply the expected Supabase project reference explicitly. TLS certificate verification is mandatory; supply PGSSLROOTCERT with an approved CA file if required. Never print credentials or put their values in arguments.

Plan first (no --execute):

~~~sh
node scripts/operator-erasure.mjs --env-file <ignored-file> --expected-project-ref <ref> --project <uuid> --case <opaque-case> --purpose ERASURE
~~~

After reviewing the scope and holds, repeat with --execute. For account erasure use --account instead of --project. Other supported purposes are RETENTION and OPERATOR_DELETION. RETENTION does not select a period or make the legal decision: the approved case supplies that decision.

## Transaction and Storage sequence

1. Reconcile PROCESSING notifications. Preparation refuses them even if their lease appears expired: the provider outcome may be uncertain. Do not reset or bulk retry notifications to force erasure.
2. Preparation locks the project, freezes future mutations, records a permanent namespace tombstone and inventories authoritative assets plus unconfirmed objects under the exact owner/project prefix. Pending and terminal project notification payloads are removed in the same transaction.
3. The operator removes each manifest object through the Storage API. Deleting storage.objects with SQL is not physical deletion and is prohibited as an operational shortcut.
4. Persist a deletion receipt only after API success and metadata absence. Failure leaves the project frozen and the job resumable. Reuse the same target and case. No automatic cancel/unfreeze is provided.
5. Finalization requires all receipts and an empty Storage namespace. It deletes revision relationships before project cascades and retains the namespace tombstone and H2 claims. Old paths must not become reusable.
6. Account erasure first retires the account namespace against new projects/uploads, processes its projects, checks all buckets and recipient notifications, invokes Auth Admin deletion and records completion. Unknown buckets or orphan paths fail closed and require scoped investigation; this tool must not silently broaden its scope.
7. Verify absence and unrelated-project integrity, record counts and resolve external copies before declaring the complete erasure request fulfilled.

## Failure recovery

For a Storage or database receipt failure, repair the underlying issue and rerun the same case. Physical deletion may already have succeeded; replay must converge without inventing a second scope. Never disable triggers, revert a submitted project to DRAFT or globally grant service-role mutation bypass. A failed account deletion leaves the account retired until recovery.

## Retention policy dependencies

No default age or automatic retention sweep is implemented.

| Data | Technical handling | Required policy decision |
| --- | --- | --- |
| Reference uploads, previews, final videos | Approved project erasure deletes physical objects before final relational cleanup | Period, trigger, holds, and any need for selective retention |
| Notifications | Project/recipient cleanup after in-flight reconciliation | Routine history retention and provider-side records |
| H2 orphan/deletion claims | Preserve path retirement | Approved treatment of pseudonymous identifiers; no age purge without equivalent non-reuse protection |
| Operator manifests/tombstones | Private audit and permanent namespace retirement | Access, minimisation, lawful purpose and retention of identifiers |
| Application, Cron and operational logs | No blanket deletion in this mechanism | Owner, retention, access and external-provider procedure |
| Backups | Restore procedure must reapply completed erasures before service resumes | Backup expiry, restore responsibility and response commitments |

The mechanism does not erase backups, external email/provider logs or files previously downloaded by recipients. Previously issued signed URLs and CDN behaviour require hosted verification; do not promise instantaneous revocation of all copies.

## Deployment and verification gate

Apply migration 20260101001300_operator_erasure.sql only after review and staging proof. The existing H6 requirement to drain obsolete notification workers still applies to H6 rollout. Do not enable broad schema grants or expose operator_maintenance to API clients. Do not deploy this candidate to production while hosted tests remain incomplete.

Required evidence: customer/admin/service-role denial, draft and submitted physical deletion, exact target isolation, stale signed upload token rejection, receipt/failure replay, all media and revision relationships, account/Auth cleanup, and confirmation/submission/revision/final/cleanup races in both orders. Run test:erasure, verify:db, full unit, typecheck, lint and Node 22.22.2 build. Recheck staging H7 health without changing scheduler configuration.

Storage API rationale: https://supabase.com/docs/guides/storage/management/delete-objects
