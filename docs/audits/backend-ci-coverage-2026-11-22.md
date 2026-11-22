# Backend CI coverage — 2026-11-22

## Last completed coverage run

- Workflow: `api-coverage`
- Run ID: `44970052062`
- Commit: `995d91fd926201cfade892f3b325c389200e1646`
- Result: success
- Unit tests: **169/169 passed**
- Suites: **24/24 passed**

| Metric | Coverage |
|---|---:|
| Statements | 30.29% |
| Branches | 28.33% |
| Functions | 29.24% |
| Lines | 32.26% |

## Interpretation

- These values describe coverage of the code instrumented by Jest. They are **not** a percentage of backend implementation completion.
- A passing unit suite does not certify database authorization, integration behavior, concurrency, provider integration or production readiness.
- The current branch has additional tests and corrections after this run; newer coverage is running. Newer coverage and API/E2E checks are running; use their final results before treating the current PR head as approved.
- Frontend is excluded from this audit because frontend implementation has not started.

## Additional test work in the current branch

- PostgreSQL snapshot authorization regressions: membership revocation, unfollow, block, audience change, suspended author, archived event timeline, cursor ordering and payload redaction.
- Snapshot session release, expiry, cross-user isolation and maximum-session tests.
- Deterministic authorization-lock test for membership revocation.
- Device registration idempotency and transfer, session revocation and pending push cancellation.
- Notification dispatch revalidation for revoked devices and inactive recipients.
- Couple journal create/delete audit events.
- Database transaction rollback and broken-client disposal.

## Remaining test gaps

- Full authorization matrix across every endpoint and resource type.
- Concurrent revocation tests for blocks, relationships, profile visibility, album access, couple membership and media processing.
- Billing provider signature verification, checkout/cancellation and account-deletion billing behavior.
- Real provider playback integration for Social Audio.
- Media processing/storage deletion and object restore integration.
- Distributed rate-limit and WebSocket abuse tests.
- Retention/cleanup tests for sync change logs, push receipts and idempotency receipts.
