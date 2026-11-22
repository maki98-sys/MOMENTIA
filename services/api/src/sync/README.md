# Synchronization API contract

## Snapshot

- `snapshot(userId, { sections, limit, snapshotId? })` returns authorized section data and a pagination cursor.
- A new snapshot captures the latest `sync_change_log.sequence_id` **before** reading any section rows. Changes committed after that cursor are picked up by incremental pull.
- Every continuation re-reads current source rows and revalidates current permissions. It does not reuse a frozen payload from a prior page.
- Snapshot session rows retain only section/cursor metadata; the JSONB `data` field is intentionally empty so stale materialized content is not retained.
- Sessions expire after 30 minutes. At most two active sessions are retained per user; older sessions are evicted. A user can release their own session.
- Snapshot IDs are isolated by user. Expired, released, unknown and cross-user IDs are rejected.
- Permission-sensitive reads hold a shared transaction advisory lock. Permission mutations hold the matching exclusive lock before taking row locks and evaluating permissions.

## Incremental pull

- `pull(userId, cursor, limit)` returns sequence metadata: `sequence_id`, `entity_type`, `entity_id`, `change_type` and `occurred_at`.
- Historical `payload` is always returned as `null`. The change log may contain content that was authorized when recorded but is no longer authorized. Clients must refresh via `snapshot()` when `refreshRequired` is true.
- This avoids replaying stale post/comment/media payloads after unfollow, block, membership revocation or audience changes.
- Clients should reconcile their local cache against the newly authorized snapshot rather than trusting historical payloads.

## Push mutations

- Push operations are validated and bounded, and use operation IDs plus request hashes for idempotency.
- Permission-sensitive operations acquire the authorization write lock before authorization checks and writes.
- Failed operations are recorded as rejected receipts; completed operations return their stored result on replay.

## Current limitations

- The authorization lock is global. It is correct but may serialize unrelated permission mutations. A per-user/per-resource authorization epoch design is a future scalability improvement.
- The API/frontend cache reconciliation contract still needs an end-to-end client implementation and tests.
- Snapshot E2E coverage currently focuses on membership revocation, unfollow, block, audience change, suspended authors, archived timelines, cursor ordering, pull payload redaction, release, expiry, cross-user isolation and session limits.
