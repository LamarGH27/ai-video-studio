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
# Requires: PostgreSQL 16 server binaries (initdb, pg_ctl, psql).
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/lib/postgresql/avs-verify}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-/tmp}"
SOCKET_DIR="$PGHOST"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export PGHOST PGPORT PGUSER=postgres PGDATABASE=postgres
export PATH="$PGBIN:$PATH"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if ! pg_isready -q 2>/dev/null; then
  say "Starting a local PostgreSQL cluster at $PGDATA"
  rm -rf "$PGDATA"
  mkdir -p "$(dirname "$PGDATA")"
  chown postgres:postgres "$(dirname "$PGDATA")" 2>/dev/null || true
  su postgres -c "PATH=$PGBIN:\$PATH initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
  su postgres -c "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -l $PGDATA/server.log \
    -o '-k $SOCKET_DIR -p $PGPORT -c listen_addresses=' -w start" >/dev/null
fi

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
  if psql -q -v ON_ERROR_STOP=1 -f "$f" >/tmp/avs-migration.log 2>&1; then
    echo "OK"
  else
    echo "FAILED"; grep -E '^psql.*ERROR' /tmp/avs-migration.log | head -5; exit 1
  fi
done

say "Loading fixtures"
psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/harness/01_fixtures.sql" >/dev/null

for suite in "$REPO_ROOT"/supabase/tests/0[1-9]_*.sql; do
  say "Running $(basename "$suite")"
  psql -q -v ON_ERROR_STOP=1 -f "$suite" >/dev/null
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
