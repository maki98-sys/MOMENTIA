#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
RESTORE_URL="postgres://momentia:momentia_test@localhost:5432/momentia_restore_test"
pg_dump --format=custom "$DATABASE_URL" --file=/tmp/momentia-backup.dump
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE momentia_restore_test"
pg_restore --no-owner --dbname="$RESTORE_URL" /tmp/momentia-backup.dump
COUNT=$(psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM schema_migrations")
test "$COUNT" = "3"
TABLES=$(psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
test "$TABLES" -ge "30"
echo "PostgreSQL backup/restore smoke test: PASS ($COUNT migrations, $TABLES tables)"
