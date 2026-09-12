#!/usr/bin/env bash
# =============================================================================
# Run the database security suite against a throwaway local PostgreSQL cluster.
# =============================================================================
# Verifies the parts of the security model that live in the database: schema
# objects, RLS policies, triggers and storage policy predicates. It applies
# supabase/migrations/ from a CLEAN database every time, so it also proves the
# migrations still work from scratch.
#
# It does NOT cover Supabase Auth, PostgREST's HTTP layer or the Storage API
# (signed URLs, MIME/size enforcement). Those need a live project — see
# scripts/verify-live.ts.
#
# Usage:   supabase/tests/run-local.sh
# Requires: PostgreSQL 16 server binaries (initdb, pg_ctl, psql). No sudo, no
#           system PostgreSQL service, and nothing outside a temporary
#           directory — so it runs the same on a workstation, in a container as
#           root, or in a Codespace as an unprivileged user.
#
# Environment overrides, all optional:
#   PGBIN             directory holding initdb/pg_ctl/psql (auto-detected)
#   AVS_PG_ROOT       where the throwaway cluster lives (default under TMPDIR)
#   PGPORT            port the cluster listens on, over its private socket
#   AVS_KEEP_CLUSTER  set to 1 to leave the cluster running for inspection
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[1mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Where the server binaries are
# -----------------------------------------------------------------------------
# Debian and Ubuntu keep them off PATH under /usr/lib/postgresql/<major>/bin;
# Homebrew, Postgres.app and most container images put them on PATH. Try the
# obvious things rather than hard-coding one distribution's layout.
find_pgbin() {
  if command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
    return 0
  fi
  local dir
  for dir in $(ls -d /usr/lib/postgresql/*/bin /usr/local/pgsql/bin \
                     /opt/homebrew/opt/postgresql@*/bin \
                     /usr/local/opt/postgresql@*/bin 2>/dev/null | sort -Vr); do
    [ -x "$dir/initdb" ] && { printf '%s' "$dir"; return 0; }
  done
  if command -v pg_config >/dev/null 2>&1; then
    pg_config --bindir
    return 0
  fi
  return 1
}

PGBIN="${PGBIN:-$(find_pgbin || true)}"
[ -n "$PGBIN" ] && [ -x "$PGBIN/initdb" ] || die \
  "PostgreSQL server binaries not found. Install the postgresql server package
  (Debian/Ubuntu: postgresql-16; macOS: brew install postgresql@16), or set
  PGBIN to the directory containing initdb, pg_ctl and psql."

export PATH="$PGBIN:$PATH"

# -----------------------------------------------------------------------------
# Where the throwaway cluster lives
# -----------------------------------------------------------------------------
# A temporary directory, never /var/lib/postgresql: that path belongs to a
# system-installed server, is root-owned, and does not exist at all on a machine
# where PostgreSQL was installed by Homebrew. Everything this suite needs is
# disposable, so it belongs somewhere disposable and user-writable.
#
# The socket lives inside that same directory rather than in /tmp, which is what
# keeps concurrent or repeated runs from finding each other: with
# listen_addresses empty there is no TCP port to contend for, and the socket path
# is unique to this root.
AVS_PG_ROOT="${AVS_PG_ROOT:-${TMPDIR:-/tmp}/avs-verify-pg}"
AVS_PG_ROOT="${AVS_PG_ROOT%/}"
PGDATA="$AVS_PG_ROOT/data"
SOCKET_DIR="$AVS_PG_ROOT/socket"
PGPORT="${PGPORT:-55432}"
PGHOST="$SOCKET_DIR"

# A unix socket path is capped near 107 bytes and the cap is enforced at connect
# time with an unhelpful message. macOS TMPDIR is long, so check rather than
# discover it later.
if [ "${#SOCKET_DIR}" -gt 80 ]; then
  AVS_PG_ROOT="/tmp/avs-verify-pg.$$"
  PGDATA="$AVS_PG_ROOT/data"
  SOCKET_DIR="$AVS_PG_ROOT/socket"
  PGHOST="$SOCKET_DIR"
fi

export PGHOST PGPORT PGUSER=postgres PGDATABASE=postgres

# -----------------------------------------------------------------------------
# Who runs the server
# -----------------------------------------------------------------------------
# PostgreSQL refuses to run as root, so in a container that starts as root the
# work is handed to the postgres account. Anywhere else — a Codespace, a laptop
# — the current user runs it directly, which is why no part of this needs sudo.
if [ "$(id -u)" -eq 0 ]; then
  id -u postgres >/dev/null 2>&1 || die \
    "Running as root, but there is no 'postgres' account to drop to, and
  PostgreSQL will not run as root. Re-run as an unprivileged user."
  as_pg() { su postgres -c "PATH='$PGBIN':\$PATH; $*"; }
  own_root() { chown -R postgres "$AVS_PG_ROOT"; }
else
  as_pg() { bash -c "PATH='$PGBIN':\$PATH; $*"; }
  own_root() { :; }
fi

# -----------------------------------------------------------------------------
# Start clean, and leave nothing behind
# -----------------------------------------------------------------------------
stop_cluster() {
  [ -f "$PGDATA/postmaster.pid" ] || return 0
  as_pg "pg_ctl -D '$PGDATA' -m immediate -w stop" >/dev/null 2>&1 || true

  # pg_ctl cannot stop a cluster whose data directory is half-removed, so fall
  # back to the pid the postmaster recorded.
  local pid tries=0
  pid="$(head -1 "$PGDATA/postmaster.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 50 ]; do
      tries=$((tries + 1)); sleep 0.2
    done
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  local status=$?
  if [ "${AVS_KEEP_CLUSTER:-0}" = "1" ]; then
    say "Leaving the cluster at $AVS_PG_ROOT (AVS_KEEP_CLUSTER=1)"
    printf '  connect with: PGHOST=%s PGPORT=%s psql -U postgres\n' "$SOCKET_DIR" "$PGPORT"
  else
    stop_cluster
    rm -rf "$AVS_PG_ROOT"
  fi
  return $status
}
trap cleanup EXIT

# A cluster left over from an interrupted run would otherwise be reused with
# stale data in it, or would hold the socket this run wants.
stop_cluster
rm -rf "$AVS_PG_ROOT"

say "Starting a throwaway PostgreSQL cluster at $AVS_PG_ROOT"
mkdir -p "$PGDATA" "$SOCKET_DIR"
own_root
as_pg "initdb -D '$PGDATA' -U postgres --auth=trust" >/dev/null
as_pg "pg_ctl -D '$PGDATA' -l '$PGDATA/server.log' \
  -o '-k $SOCKET_DIR -p $PGPORT -c listen_addresses=' -w start" >/dev/null

pg_isready -q || { cat "$PGDATA/server.log" 2>/dev/null >&2; die "the cluster did not start"; }

say "Resetting to a clean database"
psql -q -c "drop schema if exists public cascade;  create schema public;" \
     -c "drop schema if exists storage cascade;" \
     -c "drop schema if exists auth cascade;" \
     -c "drop schema if exists avs_test cascade;" >/dev/null

say "Installing the Supabase-compatible harness"
psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/harness/00_supabase_shim.sql" >/dev/null

say "Applying migrations from clean"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  printf '  %-48s ' "$(basename "$f")"
  if psql -q -v ON_ERROR_STOP=1 -f "$f" >"$AVS_PG_ROOT/migration.log" 2>&1; then
    echo "OK"
  else
    echo "FAILED"; grep -E '^psql.*ERROR' "$AVS_PG_ROOT/migration.log" | head -5; exit 1
  fi
done

say "Loading fixtures"
psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/harness/01_fixtures.sql" >/dev/null

for suite in "$REPO_ROOT"/supabase/tests/0[1-9]_*.sql; do
  say "Running $(basename "$suite")"
  psql -q -v ON_ERROR_STOP=1 -f "$suite" >/dev/null
done

for script in "$REPO_ROOT"/supabase/tests/concurrency/*.sh; do
  say "Running $(basename "$script")"
  # Two live connections interleaved by hand. It appends its own rows to
  # avs_test.results, so its assertions are counted with all the others.
  "$script"
done

say "RESULTS"
psql -X -P pager=off -c "
  select area as \"Area\",
         attack as \"Attack\",
         expected as \"Expected\",
         actual as \"Actual\",
         case when pass then 'PASS' else 'FAIL' end as \"Result\"
  from avs_test.results order by seq;"

psql -X -P pager=off -c "
  select count(*) filter (where pass)     as \"passed\",
         count(*) filter (where not pass) as \"failed\",
         count(*)                          as \"total\"
  from avs_test.results;"

FAILED=$(psql -X -Atc "select count(*) from avs_test.results where not pass")
if [ "$FAILED" != "0" ]; then
  say "$FAILED assertion(s) FAILED"
  psql -X -P pager=off -c "select area, attack, expected, actual from avs_test.results where not pass order by seq;"
  exit 1
fi
say "All database security assertions passed."
