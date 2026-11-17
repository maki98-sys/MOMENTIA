#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the target PostgreSQL database}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/migrations"

command -v psql >/dev/null 2>&1 || {
  echo "psql is required but was not found" >&2
  exit 127
}

# Migration filenames and ledger versions are intentionally identical.
# The SQL files use explicit transactions and record their own version only
# after every DDL statement succeeds.
for migration in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$migration" ] || continue
  version="$(basename "$migration" .sql)"

  ledger_exists="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL")"

  if [ "$ledger_exists" != "t" ]; then
    if [ "$version" != "0001_initial_schema" ]; then
      echo "Migration ledger missing before $version; refusing out-of-order apply" >&2
      exit 1
    fi
    echo "Applying $version (initial schema)"
    psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
    continue
  fi

  applied="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '$version')")"

  if [ "$applied" = "t" ]; then
    echo "Skipping $version (already applied)"
  else
    echo "Applying $version"
    psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
  fi
done

echo "MOMENTIA database migrations are up to date."
