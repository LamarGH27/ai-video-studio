# Notification scheduler production privilege model (Blocker 3)

## Approved boundary

Customers receive only publishable API access and user JWTs, never database-login credentials. Keep net, cron, vault, production_scheduler, staging_scheduler and operator_maintenance OUT of exposed PostgREST schemas. An application profile role of admin still uses the authenticated database role; it grants no scheduler/network/Vault authority.

Supabase owns pg_net/pg_cron/Vault extensions and net functions as supabase_admin. Managed net grants, including PUBLIC defaults and authenticated table/function access, may remain. Do not revoke them merely to tidy ACLs, change ownership, drop/recreate extensions, or expose net to the API. A database login or arbitrary-SQL proxy changes this trust model and must be reviewed separately. No public general-purpose HTTP wrapper is permitted.

The approved scheduler runs as postgres, with SECURITY INVOKER, an empty search_path, no caller-supplied URL, headers or credential. Only postgres may use its private schema/tables/functions. It reads exactly h7_production_notification_worker_url and h7_production_cron_secret from Vault and posts only to /api/internal/notifications/process over HTTPS with a 70000 ms timeout. Configuration of the exact production hostname is a privileged operator action and must be compared with the deployment inventory. The wrapper does not authorize arbitrary callers just because the URL is in Vault.

Public claim_notifications, enqueue_notification, mark_notification_sent and mark_notification_failed remain postgres-owned SECURITY DEFINER functions with empty search_path; only postgres and service_role may execute. Migration 012 supplies these grants. Customers and application admins must fail with 42501. retry_notification is a separate admin-authorized business operation and is intentionally unaffected.

## Vault and database operator trust

No metadata or decrypted values are customer/API accessible. Vault functions are owned by supabase_admin; postgres has managed operator privileges and service_role has some database-level Vault grants. service_role is a trusted backend role, never a customer credential. Keep Vault outside API exposure for every role. Do not pretend the postgres scheduler role itself is restricted to two secrets: its code reads two named secrets, while the operator role is inherently broader. Database-login principals must be trusted: pg_net request headers contain bearer authentication while queued. Limit SQL/dashboard/pooler access, and do not expose request/response tables through views, GraphQL, public RPC proxies or other APIs.

Staging and production use distinct Vault names, URL values, CRON_SECRET values, Supabase projects and worker deployments. No values belong in SQL source, command arguments, shell history, screenshots or logs. Provision through the approved secret-entry UI, or a local strict-TLS parameterized database client with logging disabled. Never paste secret literals into SQL Editor history. Secret names are not secret values.

## Exact production operator sequence — NOT executed by this work

1. Verify the production project identity against the approved inventory using a strict-TLS connection. Review migrations through 014 and deploy the H6 worker/release/erasure-compatible application. **Drain old notification workers before the new migration/application combination becomes active.** Keep all production schedulers disabled during preparation.
2. Enable pg_cron, pg_net and supabase_vault using the supported Supabase extension controls. Check extension ownership remains supabase_admin and versions/capabilities match the approved staging model. Stop on ownership or platform differences; never silently take extension ownership.
3. Provision h7_production_notification_worker_url and h7_production_cron_secret using Vault's supported creation/update path. Set the matching CRON_SECRET on the production worker. Confirm exact HTTPS host/path, no query/fragment/userinfo and distinct staging/production values without printing either. Only these two values are read by the scheduler.
4. Review and run docs/sql/production-notification-scheduler.sql as postgres only. It installs private objects and two jobs in INACTIVE state. This is an explicit operator setup script, not an automatically applied application migration; it does not alter managed pg_net grants. Existing matching jobs must not be running during setup. Repeat setup keeps the same named jobs inactive.
5. Check Dashboard Data API exposed schemas. net, cron, vault and both scheduler schemas must be absent. API settings are managed platform configuration, not asserted solely by migrations. Keep the approved schema list in the release inventory; reject additions without security review. Do not confuse extra search-path schemas with exposed schemas.
6. Run docs/sql/verify-notification-worker-grants.sql. Verify production_scheduler schema/table/function owners are postgres, PUBLIC/anon/authenticated/service_role have no private-schema USAGE or function EXECUTE, and both jobs have username postgres. Run the hosted probe below using dedicated disposable customer/admin test principals. Perform this before accepting notifications, so unexpected drift cannot consume a live queue. All 45 checks must pass, including successful customer/admin role controls. Stop on any unexpected response; never count a missing signature or invalid JWT as authorization denial.
7. Run select production_scheduler.invoke('manual'); as postgres. After the response arrives run select production_scheduler.check_health(); inspect only sanitized requests telemetry for HTTP 200, provider/acknowledgement success and claimed=sent, failed=skipped=acknowledgement_errors=0. A manual call does not satisfy scheduled freshness, so watchdog healthy may remain false until a real scheduled call. Use an approved synthetic recipient, not a real customer, for a fresh queue fixture and verify H6 claim/acknowledgement results.
8. Enable only the two named jobs with cron.alter_job(job_id:=...,active:=true) after selecting their exact IDs by jobname and username. Observe at least 10 real executions, five-minute starts, successful worker responses, and a healthy recent watchdog. Inspect cron.job_run_details plus sanitized telemetry: cron success alone means only that the HTTP request was queued. The watchdog must have overdue_requests=0 and recent successful scheduled calls; inspect pending_count, oldest_pending_at and operator_retry_count separately. Blocker 4's independent alert delivery remains a separate prerequisite, not implemented here. Do not bulk retry historical FAILED notifications.
9. Record release evidence (IDs/timestamps/statuses only) and rerun boundary probes after any API-schema, migration, extension, Webhooks or platform upgrade. If anything fails, disable only the named notification cron job, preserve the queue and investigate. Keep manual fallback controlled. Production rollout requires separate authorization.

## Repeatable drift checks

From repository root, with secrets in an ignored local configuration file:

    node scripts/verify-scheduler-boundary.mjs ENV_FILE EXPECTED_PROJECT_REF production_scheduler

The script fails on unexpected API exposure, worker RPC access, incorrect customer/admin identity, a non-ignored non-template .env file, or any configured CRON_SECRET/DATABASE_URL/SUPABASE_SECRET_KEY/RESEND_API_KEY value in tracked or non-ignored untracked source. It never prints response values. CRON_SECRET is mandatory for the scan; provide other relevant configuration values in the release environment. Non-ignored pending files are scanned without staging them. Exact-value scans cannot detect unknown/previous credentials: also run the repository/organization secret scanner over the release diff and reachable Git history. A scanner alert blocks release until reviewed/rotated; do not claim absence of every possible secret from an exact-value scan alone.

Run the SQL grant assertion before hosted probes. HTTP probes use Accept-Profile/Content-Profile and demand PGRST106 for private schemas; public worker RPCs require 42501 (401 anonymous, 403 signed in). Real customer/admin profile reads are positive controls. On drift, probes stop immediately. They do not use privileged API keys. A wrongly exposed cron create could leave the inert boundary-probe-must-not-exist job; an operator must inventory/remove that exact synthetic job, not touch approved jobs. Never grant permissions to make tests pass.

These checks belong in each release gate and after configuration changes. A regular external execution/alert mechanism is Blocker 4; this deliverable does not claim independent monitoring exists. Dashboard schema settings cannot be made migration-reproducible by cosmetic pg_net REVOKEs. The release checklist plus hosted probes is the required control.

## Verified staging evidence

2026-10-12: 45/45 anonymous/customer/application-admin probes passed. All net/cron/vault/private-wrapper probes returned HTTP 406 PGRST106; worker-only RPCs returned 42501. Customer and admin JWT profile controls succeeded. Previous 15 customer checks independently passed. This demonstrates direct PostgREST isolation, not database-level denial or exhaustive proof against arbitrary SQL vulnerabilities.

H7 recent watchdog samples at 14:12, 14:17 and 14:22 UTC were healthy, with zero overdue and zero pending. In the two-hour sample 23 completed scheduled results were HTTP 200/healthy; one newest request awaited watchdog collection. Existing FAILED queue count was 46; this work did not retry or alter those rows. H1–H7 and Blockers 1–2 behavior is unchanged. No production actions were performed.

## Managed-platform risks

Supabase-managed grants can survive attempted revocations or change after upgrades. Recheck effective access and hosted boundaries after upgrades; do not treat SQL without an error as a successful privilege change. Production installation/host matching and actual scheduler execution must be proven during the separately authorized deployment rehearsal. The SQL setup here is a specified production model, not evidence of a production deployment.

Reference: https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16

## Final verification and command record (2026-10-12)

BLOCKER 3 CLOSED for the specified production privilege model and drift-control deliverable. Production setup/rehearsal remains unexecuted and requires separate authorization. No managed grants, live scheduler definitions or application behavior were changed. Changes remain uncommitted.

VERIFIED: 45 hosted probes passed again after the final module conversion, including anonymous, customer and application-admin controls. Exact configured-secret scan covers tracked and non-ignored pending files. H7's latest sampled watchdog checks (20:42, 20:47, 20:52 UTC) were healthy; all 24 collected responses in the two-hour window were HTTP 200/healthy, with zero overdue requests and zero pending rows. The 46 historical operator-retry rows were untouched.

VERIFIED: Node 22.22.2; 420 unit tests/23 files; typecheck; lint; production build. Native PostgreSQL: 472 SQL assertions, H2 56, H5 25, H6 31, operator erasure 43, final release 34 native plus 19 concurrent assertions passed. These reruns support retaining H1-H7 and Blockers 1-2 CLOSED. The complete authenticated browser lifecycle was not rerun for this documentation/probe-only change.

Previously executed within this Blocker 3 verification: hosted worker ACL/owner/search-path assertions passed. The proposed setup was executed twice inside a staging transaction, private access and inactive jobs checked, then rolled back. This verifies staging compatibility and idempotency, not production deployment.

Exact verification commands (repository root; logs are outside the repository):

```sh
export PATH=/usr/local/share/nvm/versions/node/v22.22.2/bin:$PATH
node --version
node --check scripts/verify-scheduler-boundary.mjs
node scripts/verify-scheduler-boundary.mjs .env.staging.local mpulcpuaxfrvqihynrns staging_scheduler > /workspaces/avs-blocker3/drift-probes-final.log 2>&1
NODE_EXTRA_CA_CERTS=/workspaces/avs-blocker1/supabase-ca.crt node /workspaces/avs-blocker1/hosted-health.mjs > /workspaces/avs-blocker3/health-final.log 2>&1
npm test > /workspaces/avs-blocker3/unit-final.log 2>&1
npm run typecheck > /workspaces/avs-blocker3/typecheck-final.log 2>&1
npm run lint > /workspaces/avs-blocker3/lint-final.log 2>&1
AVS_PG_ROOT=/tmp/avs-blocker3-final-sql npm run verify:db > /workspaces/avs-blocker3/sql-final.log 2>&1
npm run build > /workspaces/avs-blocker3/build-final.log 2>&1
git status --short
git rev-parse HEAD
git check-ignore .env.staging.local
```

The initial probe filename was verify-scheduler-boundary.cjs; its Node syntax check and hosted run passed, but lint rejected CommonJS imports. It was converted to .mjs, then syntax, lint and hosted probes passed. One log-summary command was rejected by Bash history expansion; it was rerun with proper single-quote shell quoting. No test failure was hidden. The earlier hosted setup validation used `NODE_EXTRA_CA_CERTS=/workspaces/avs-blocker1/supabase-ca.crt node /workspaces/avs-blocker3/validate-model.mjs`; its final twice-run rollback validation passed.

RTK was unavailable in the Codespace (`rtk --version`: command not found); ordinary commands were explicitly authorized. No installation was attempted.

Additional final checks: operator-script regression `npm run test:erasure` passed 11/11. `./node_modules/.bin/prettier --write scripts/verify-scheduler-boundary.mjs docs/notification-scheduler-privilege-model.md` formatted only the two new files; `./node_modules/.bin/eslint scripts/verify-scheduler-boundary.mjs` passed afterward. `git diff --check` passed. A final in-memory exact-value scan of all 251 tracked/non-ignored pending files passed; the four new files below were the only changes, and the tracked diff was empty. `.env.staging.local` remained ignored. No commit or push occurred.

Files: `docs/notification-scheduler-privilege-model.md`, `docs/sql/production-notification-scheduler.sql`, `docs/sql/verify-notification-worker-grants.sql`, `scripts/verify-scheduler-boundary.mjs`. No application migration was added: deployment-specific scheduler setup is explicitly operator-applied and leaves jobs inactive.
