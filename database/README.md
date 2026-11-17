# Database — MOMENTIA

PostgreSQL 15+ is the primary relational store. Original media and variants belong in private object storage; PostgreSQL stores metadata and object keys only.

## Apply locally

Requires a local PostgreSQL 15+ database, `psql`, and a development role with schema privileges.

    DATABASE_URL="postgres://..." bash database/scripts/migrate.sh

The runner applies migrations in filename order, checks the `schema_migrations` ledger, skips versions already applied, and stops on the first failure. Each migration is transactional and records its version only after its DDL succeeds. Never edit an already-applied migration in a deployed environment; add a new forward migration instead.

See [SCHEMA.md](SCHEMA.md) for the table inventory, invariants and implementation boundaries.

## Transaction invariants

1. Create a COUPLE space, its subtype row and exactly two active memberships in one transaction.
2. An active COUPLE space must have exactly two active members at commit. Close the space before processing a departure that reduces the active member count.
3. Create the subtype row matching the declared space type in the same transaction.
4. Store hashes of invitation and refresh tokens, never reusable secrets.
5. Authorize media access before issuing short-lived signed object URLs.
6. Use timestamptz for instants and retain IANA timezone separately for calendar intent.

## Verification status

Migrations 0001–0003, deferred integrity checks, SQLite smoke tests, synthetic seeds, representative EXPLAIN queries, PostgreSQL backup/restore and the concurrent COUPLE membership test passed GitHub Actions run #26 on PostgreSQL 16.


## Automated verification
The GitHub Actions workflow at .github/workflows/database-check.yml starts PostgreSQL 16, applies migrations through the ledger-aware runner, verifies an idempotent second run, runs integrity/concurrency checks, loads development fixtures, checks representative query plans, restores a backup and verifies the SQLite schema.


## Local SQLite

The offline client schema is database/local/0001_local_schema.sql. It stores cached spaces, memberships, local media files, timeline entries, durable outbox operations, sync cursors and a bounded download cache. Authentication secrets must remain in platform secure storage, not SQLite.

Run the standard-library smoke tests with:

    python database/local/verify_schema.py

The SQLite file is a local cache and sync queue, not an alternative server of record. Conflict resolution and sync execution are implemented in the offline application phase.


## Additional operational tables

Migration 0003 adds plans, subscriptions, idempotent payment-provider events, data export/deletion requests, configurable retention policy records, audit logs, moderation cases, media access grants and support tickets. Retention rules are deliberately not pre-populated: legal periods and actions must be approved for each market before activation.
