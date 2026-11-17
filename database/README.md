# Database — MOMENTIA

PostgreSQL 15+ is the primary relational store. Original media and variants belong in private object storage; PostgreSQL stores metadata and object keys only.

## Apply locally

Requires a local PostgreSQL 15+ database and a development role with schema privileges.

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0001_initial_schema.sql

The baseline is for a fresh, empty database. Do not run it twice against the same schema.

## Transaction invariants

1. Create a COUPLE space, its subtype row and exactly two active memberships in one transaction.
2. Any membership change in a COUPLE space must leave exactly two active members at commit.
3. Create the subtype row matching the declared space type in the same transaction.
4. Store hashes of invitation and refresh tokens, never reusable secrets.
5. Authorize media access before issuing short-lived signed object URLs.
6. Use timestamptz for instants and retain IANA timezone separately for calendar intent.

## Verification status

The migration is committed as source but has not yet been executed against PostgreSQL in this environment. It must pass fresh-database application, integrity tests, concurrent membership tests and rollback/forward-fix review before this phase is accepted.


## Automated verification
A GitHub Actions workflow at .github/workflows/database-check.yml starts PostgreSQL 16, applies migrations in order, and runs the SQL integrity checks. The workflow must complete successfully on the working branch before database phase acceptance. Its initial run has not yet been observed.
