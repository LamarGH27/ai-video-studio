#!/usr/bin/env bash
# =============================================================================
# Two-session concurrency proof: delivery writes and customer decisions
# serialise on the same public.projects row.
# =============================================================================
# The SQL suites cannot show this. They run inside ONE transaction, because
# `SET LOCAL ROLE` is how a PostgREST request is impersonated and autocommit
# would discard it — so everything there is, by construction, sequential.
#
# This script drives two real connections and interleaves them by hand. What it
# proves, precisely:
#
#   1. A delivery INSERT cannot proceed while a customer decision on the same
#      project is in flight. It blocks on the project row; with lock_timeout set
#      it reports 55P03 rather than quietly succeeding. That is the interlock,
#      observed rather than asserted.
#
#   2. Once the decision commits, the same INSERT is refused outright (42501),
#      because the project is no longer IN_PRODUCTION. So the preview the
#      customer approved cannot be superseded between the RPC's latest-preview
#      check and its commit — in the first window the writer is blocked, and
#      after it the write is illegal. There is no third window.
#
#   3. The same holds for two simultaneous approvals, and for an administrator
#      changing status underneath a revision request.
#
# `lock_timeout` is the instrument, not the mechanism: without it session two
# would simply wait, which is correct but indistinguishable from a hang. Turning
# the wait into a reportable error is what makes "it blocked" testable.
# =============================================================================
set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkfifo "$WORK/a.in" "$WORK/a.out" "$WORK/b.in" "$WORK/b.out"

psql -X -q -P pager=off -f - <"$WORK/a.in" >"$WORK/a.out" 2>&1 &
psql -X -q -P pager=off -f - <"$WORK/b.in" >"$WORK/b.out" 2>&1 &

exec 3>"$WORK/a.in" 4<"$WORK/a.out" 5>"$WORK/b.in" 6<"$WORK/b.out"

STEP=0
LAST=""

# send <in-fd> <out-fd> <sql...> — runs SQL in that session and waits for it to
# finish, collecting anything the session printed into $LAST.
send() {
  local in_fd="$1" out_fd="$2"; shift 2
  STEP=$((STEP + 1))
  local mark="<<<STEP_${STEP}>>>"
  printf '%s\n' "$*" >&"$in_fd"
  printf '\\echo %s\n' "$mark" >&"$in_fd"

  LAST=""
  local line
  while IFS= read -r -t 60 -u "$out_fd" line; do
    case "$line" in
      *"$mark"*) return 0 ;;
      *) LAST="${LAST}${line}"$'\n' ;;
    esac
  done
  echo "TIMED OUT waiting for step ${STEP}" >&2
  echo "$LAST" >&2
  exit 1
}

a() { send 3 4 "$*"; }
b() { send 5 6 "$*"; }

# Wraps one plpgsql statement in an exception handler, so that a failure is
# reported instead of poisoning the still-open transaction, and so the SQLSTATE
# is visible. The handler is a subtransaction: catching the error rolls back the
# statement, not the session's outstanding work.
attempt_sql() {
  cat <<PLPGSQL
do \$outer\$
begin
  $1;
  raise notice 'AVSRESULT=ALLOWED';
exception when others then
  raise notice 'AVSRESULT=DENIED %', sqlstate;
end;
\$outer\$;
PLPGSQL
}

verdict() { printf '%s' "$LAST" | sed -n 's/.*AVSRESULT=\([A-Z]*\).*/\1/p' | head -1; }
sqlstate() { printf '%s' "$LAST" | sed -n 's/.*AVSRESULT=DENIED \([0-9A-Z]*\).*/\1/p' | head -1; }

PASSED=0
FAILED=0
RESULTS_SQL=""

record() { # area, attack, expected, actual
  local pass=false
  [ "$3" = "$4" ] && pass=true
  if [ "$pass" = true ]; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
    printf '  FAIL  %s\n        expected: %s\n        actual:   %s\n' "$2" "$3" "$4" >&2
  fi
  RESULTS_SQL="${RESULTS_SQL}insert into avs_test.results (area, attack, expected, actual, pass) values ($(sql_lit "$1"), $(sql_lit "$2"), $(sql_lit "$3"), $(sql_lit "$4"), ${pass});"$'\n'
}

sql_lit() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

become() { # fd-pair selector, user key
  local fn="$1" key="$2"
  $fn "select avs_test.become('${key}');"
}

# -----------------------------------------------------------------------------
# Fixtures: three projects, each PREVIEW_READY with exactly one preview.
# Created on a direct connection, which is how a migration or an operator would
# do it — the delivery guard still applies, so each preview is inserted while
# the project is IN_PRODUCTION and only then announced.
# -----------------------------------------------------------------------------
psql -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
begin;
insert into avs_test.ids (k, v) values
  ('conc_1', 'c0000001-0000-4000-8000-00000000c001'),
  ('conc_2', 'c0000002-0000-4000-8000-00000000c002'),
  ('conc_3', 'c0000003-0000-4000-8000-00000000c003')
on conflict (k) do nothing;

insert into public.projects
  (id, user_id, status, brief, orientation, desired_duration_seconds, submitted_at)
select avs_test.id(k), avs_test.id('customer_a'), 'IN_PRODUCTION',
       'Concurrency fixture project, with a brief long enough to satisfy the length constraint.',
       'VERTICAL_9_16', 15, now()
from (values ('conc_1'), ('conc_2'), ('conc_3')) as t(k)
on conflict (id) do nothing;

insert into public.project_assets
  (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
select avs_test.id(k), avs_test.id('customer_a'), 'PREVIEW_VIDEO', 'project-deliveries',
       'aaaaaaaa-0000-4000-8000-00000000000a/' || avs_test.id(k)::text || '/preview-v1.mp4',
       'video/mp4', 5000000
from (values ('conc_1'), ('conc_2'), ('conc_3')) as t(k);

update public.projects set status = 'PREVIEW_READY'
where id in (avs_test.id('conc_1'), avs_test.id('conc_2'), avs_test.id('conc_3'));
commit;
SQL

# =============================================================================
# Scenario 1 — the race as stated: approve Preview 1 while Preview 2 arrives.
# =============================================================================
a "begin;"
become a customer_a
a "$(attempt_sql "perform public.approve_preview(avs_test.id('conc_1'), avs_test.preview_id('conc_1', 1))")"
record 'Concurrency' 'Customer begins approving Preview 1 (transaction left open)' 'ALLOWED' "$(verdict)"

# Session B now tries to introduce Preview 2, exactly as an administrator would.
b "begin;"
become b admin
b "set local lock_timeout = '2s';"
b "$(attempt_sql "insert into public.project_assets
      (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
    values (avs_test.id('conc_1'), avs_test.id('customer_a'), 'PREVIEW_VIDEO', 'project-deliveries',
            'aaaaaaaa-0000-4000-8000-00000000000a/c0000001-0000-4000-8000-00000000c001/preview-v2.mp4',
            'video/mp4', 5100000)")"
record 'Concurrency' 'Admin introduces Preview 2 during the approval: blocks on the project row' \
       'DENIED 55P03' "$(verdict) $(sqlstate)"
b "rollback;"

# The customer's transaction commits. Only now can session B proceed at all.
a "commit;"

b "begin;"
become b admin
b "$(attempt_sql "insert into public.project_assets
      (project_id, user_id, asset_type, storage_bucket, storage_path, mime_type, file_size)
    values (avs_test.id('conc_1'), avs_test.id('customer_a'), 'PREVIEW_VIDEO', 'project-deliveries',
            'aaaaaaaa-0000-4000-8000-00000000000a/c0000001-0000-4000-8000-00000000c001/preview-v2.mp4',
            'video/mp4', 5100000)")"
record 'Concurrency' 'Admin retries Preview 2 after the approval commits: refused, project is FINALISING' \
       'DENIED 42501' "$(verdict) $(sqlstate)"
b "rollback;"

ACTUAL="$(psql -X -Atc "
  select p.status || ' / previews=' || (
           select count(*) from public.project_assets a
           where a.project_id = p.id and a.asset_type = 'PREVIEW_VIDEO')
         || ' / approved_version=' || coalesce((
           select a.version::text from public.project_preview_approvals ap
           join public.project_assets a on a.id = ap.preview_asset_id
           where ap.project_id = p.id), 'none')
  from public.projects p where p.id = avs_test.id('conc_1');")"
record 'Concurrency' 'The approval records Preview 1, and Preview 2 never existed' \
       'FINALISING / previews=1 / approved_version=1' "$ACTUAL"

# =============================================================================
# Scenario 2 — two approvals of the same preview at the same time.
# =============================================================================
a "begin;"
become a customer_a
a "$(attempt_sql "perform public.approve_preview(avs_test.id('conc_2'), avs_test.preview_id('conc_2', 1))")"
record 'Concurrency' 'First approval succeeds (transaction left open)' 'ALLOWED' "$(verdict)"

b "begin;"
become b customer_a
b "set local lock_timeout = '2s';"
b "$(attempt_sql "perform public.approve_preview(avs_test.id('conc_2'), avs_test.preview_id('conc_2', 1))")"
record 'Concurrency' 'Simultaneous second approval blocks rather than double-recording' \
       'DENIED 55P03' "$(verdict) $(sqlstate)"
b "rollback;"

a "commit;"

b "begin;"
become b customer_a
b "$(attempt_sql "perform public.approve_preview(avs_test.id('conc_2'), avs_test.preview_id('conc_2', 1))")"
record 'Concurrency' 'Second approval after the first commits: refused, already FINALISING' \
       'DENIED 42501' "$(verdict) $(sqlstate)"
b "rollback;"

ACTUAL="$(psql -X -Atc "
  select count(*)::text from public.project_preview_approvals
  where project_id = avs_test.id('conc_2');")"
record 'Concurrency' 'Exactly one approval row survives two simultaneous attempts' '1' "$ACTUAL"

# =============================================================================
# Scenario 3 — an administrator moving status underneath a revision request.
# =============================================================================
a "begin;"
become a customer_a
a "$(attempt_sql "perform public.request_project_revision(avs_test.id('conc_3'), avs_test.preview_id('conc_3', 1),
      'Please hold a beat longer at the railing before the camera moves on, it is slightly quick.')")"
record 'Concurrency' 'Customer begins a revision request (transaction left open)' 'ALLOWED' "$(verdict)"

b "begin;"
become b admin
b "set local lock_timeout = '2s';"
b "$(attempt_sql "update public.projects set status = 'IN_PRODUCTION' where id = avs_test.id('conc_3')")"
record 'Concurrency' 'Admin starts rework during the revision request: blocks on the same row' \
       'DENIED 55P03' "$(verdict) $(sqlstate)"
b "rollback;"

a "commit;"

b "begin;"
become b admin
b "$(attempt_sql "update public.projects set status = 'IN_PRODUCTION' where id = avs_test.id('conc_3')")"
record 'Concurrency' 'Admin starts rework once the request commits: allowed, in the right order' \
       'ALLOWED' "$(verdict)"
b "commit;"

ACTUAL="$(psql -X -Atc "
  select p.status || ' / open_revisions=' || (
    select count(*) from public.project_revisions r
    where r.project_id = p.id and r.status = 'OPEN')
  from public.projects p where p.id = avs_test.id('conc_3');")"
record 'Concurrency' 'The revision is on the record and still open while the rework runs' \
       'IN_PRODUCTION / open_revisions=1' "$ACTUAL"

# -----------------------------------------------------------------------------
printf '\\q\n' >&3
printf '\\q\n' >&5
exec 3>&- 5>&-
wait 2>/dev/null || true
exec 4<&- 6<&-

printf '%s' "$RESULTS_SQL" | psql -X -q -v ON_ERROR_STOP=1 >/dev/null

printf '  %s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" = "0" ]
