#!/usr/bin/env bash
# Apply supabase/migrations/003_chat.sql twice against a throwaway Postgres, then again
# after a sentinel row exists. Local only: this script creates its own data directory.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
if ! command -v initdb >/dev/null 2>&1; then
  for dir in /usr/lib/postgresql/*/bin; do
    if [[ -x "$dir/initdb" ]]; then
      export PATH="$dir:$PATH"
      break
    fi
  done
fi
command -v initdb >/dev/null 2>&1 || { echo "initdb not found" >&2; exit 1; }
if grep -Eiq 'truncate|drop table|drop schema' "$root/supabase/migrations/003_chat.sql"; then
  echo "003_chat.sql contains truncate/drop table/drop schema" >&2
  exit 1
fi

pgdata=$(mktemp -d)
cleanup() {
  if [[ -f "$pgdata/postmaster.pid" ]]; then
    pg_ctl -D "$pgdata" -m fast -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$pgdata"
}
trap cleanup EXIT

initdb -D "$pgdata" --username="$(whoami)" --auth=trust --no-sync -E UTF8 --locale=C >/dev/null
pg_ctl -D "$pgdata" -o "-c listen_addresses= -c unix_socket_directories=$pgdata" -w start >/dev/null
export PGHOST="$pgdata" PGUSER="$(whoami)"

psql -d postgres -v ON_ERROR_STOP=1 -c "create database chat_test"
psql -d chat_test -v ON_ERROR_STOP=1 -f "$root/scripts/chat-local-stub.sql" >/dev/null
psql -d chat_test -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/003_chat.sql" >/dev/null
psql -d chat_test -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/003_chat.sql" >/dev/null
psql -d chat_test -v ON_ERROR_STOP=1 -f "$root/scripts/chat-local-checks.sql"
psql -d chat_test -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/003_chat.sql" >/dev/null
kept=$(psql -d chat_test -v ON_ERROR_STOP=1 -tA -c "select count(*) from chat.messages where body = 'sentinel-keep'")
if [[ "$kept" != "1" ]]; then
  echo "third migration run removed sentinel rows (count=$kept)" >&2
  exit 1
fi
echo "chat migration applied 3 times; sentinel row kept; RLS checks passed"
