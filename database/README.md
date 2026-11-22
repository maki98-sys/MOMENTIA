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

## Verification

The migration runner currently applies the complete ordered migration set **0001–0066** and records each applied version in `schema_migrations`. The PostgreSQL CI workflow verifies:

- all migrations apply to a fresh PostgreSQL database;
- rerunning the migration runner is idempotent;
- the migration ledger contains the expected versions;
- representative foreign-key, uniqueness, index and integrity checks pass;
- representative query plans and a 10,000-row timeline smoke test run;
- PostgreSQL backup and restore complete;
- the local SQLite schema checks pass;
- the concurrent COUPLE membership invariant is preserved.

The latest completed database verification at the time of this update is workflow run `44969387624` on commit `0fc`, which completed successfully and included migrations through `0066_device_installation_identity`. A newer verification is running on the current PR head; check the PR checks before treating that newer head as approved.

Recent database corrections:

| Migration | Purpose |
|---|---|
| 0036 | Rebuild the account-deletion due index consistently and keep the migration ledger idempotent |
| 0039 | Synchronize media asset lifecycle changes |
| 0056 | Order subscription provider events |
| 0061 | Cast nullable sync tombstone payloads explicitly to JSONB |
| 0062 | Fix JSONB casts for block-change tombstones |
| 0063 | Fix JSONB casts for comment-author block tombstones |
| 0064 | Serialize authorization-changing writes with sync snapshot reads |
| 0065 | Include profile visibility changes in authorization serialization |
| 0066 | Add stable device installation identity and idempotent device registration |

Passing the database workflow proves that the migration set applies and the listed database checks pass. It does **not** by itself prove that every API query, authorization rule, concurrency path, retention policy or production storage integration has been fully audited. Those backend audits and their regression tests remain tracked separately.
