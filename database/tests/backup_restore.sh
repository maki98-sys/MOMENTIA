#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
RESTORE_URL="postgres://momentia:momentia_test@localhost:5432/momentia_restore_test"

# Use a plain logical dump so a newer pg_dump client can restore into the
# PostgreSQL 16 service. Strip the PG17+ transaction_timeout SET statement.
pg_dump --format=plain --no-owner --no-privileges "$DATABASE_URL" --file=/tmp/momentia-backup.sql
sed -i '/^SET transaction_timeout = 0;$/d' /tmp/momentia-backup.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE momentia_restore_test"
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -f /tmp/momentia-backup.sql

COUNT=$(psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM schema_migrations")
test "$COUNT" = "3"
TABLES=$(psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
test "$TABLES" -ge "30"
echo "PostgreSQL backup/restore smoke test: PASS ($COUNT migrations, $TABLES tables)"
