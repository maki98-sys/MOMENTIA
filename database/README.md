# Database — MOMENTIA

PostgreSQL 15+ is the primary relational store. Original media and variants belong in private object storage; PostgreSQL stores metadata and object keys only.

## Apply locally

Requires a local PostgreSQL 15+ database and a development role with schema privileges.

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0001_initial_schema.sql
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0002_space_integrity_and_event_albums.sql
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0003_platform_operations_and_ownership.sql

The migrations are ordered and intended for a fresh, empty database. Do not run them twice against the same schema.

## Transaction invariants

1. Create a COUPLE space, its subtype row and exactly two active memberships in one transaction.
2. An active COUPLE space must have exactly two active members at commit. Close the space before processing a departure that reduces the active member count.
3. Create the subtype row matching the declared space type in the same transaction.
4. Store hashes of invitation and refresh tokens, never reusable secrets.
5. Authorize media access before issuing short-lived signed object URLs.
6. Use timestamptz for instants and retain IANA timezone separately for calendar intent.

## Verification status

Migrations 0001 and 0002 have passed PostgreSQL 16 CI and their integrity checks. Migration 0003 and the concurrent-membership test were added afterward and require the latest workflow run to pass before acceptance.


## Automated verification
The GitHub Actions workflow at .github/workflows/database-check.yml starts PostgreSQL 16, applies migrations in order, runs integrity/concurrency checks, and verifies the SQLite schema.


## Local SQLite

The offline client schema is database/local/0001_local_schema.sql. It stores cached spaces, memberships, local media files, timeline entries, durable outbox operations, sync cursors and a bounded download cache. Authentication secrets must remain in platform secure storage, not SQLite.

Run the standard-library smoke tests with:

    python database/local/verify_schema.py

The SQLite file is a local cache and sync queue, not an alternative server of record. Conflict resolution and sync execution are implemented in the offline application phase.


## Additional operational tables

Migration 0003 adds plans, subscriptions, idempotent payment-provider events, data export/deletion requests, configurable retention policy records, audit logs, moderation cases, media access grants and support tickets. Retention rules are deliberately not pre-populated: legal periods and actions must be approved for each market before activation.
