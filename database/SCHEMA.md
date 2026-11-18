# MOMENTIA — Database schema inventory

This is the physical PostgreSQL schema inventory for the current database foundation. It documents persisted responsibilities; it does not imply that the corresponding API or user interface has been implemented.

## Server schema (41 tables)

### Identity and account security
- `schema_migrations`: applied migration versions and timestamps.
- `users`: canonical account and lifecycle state.
- `auth_identities`: external/provider identity mappings.
- `user_profiles`: public/private profile fields and display preferences.
- `devices`: registered client devices and push-token metadata.
- `auth_sessions`: revocable authenticated sessions.
- `user_relationships`: follow/friend relationship state.
- `user_blocks`: user-to-user blocks.

### Shared spaces, membership and invitations
- `spaces`: common root for EVENT, COUPLE and CIRCLE spaces.
- `space_memberships`: member, owner, guest roles and membership lifecycle.
- `space_invitations`: hashed invite tokens, expiry and usage state.
- `event_details`, `couple_details`, `circle_details`: one matching subtype per space.

### Media and uploads
- `media_assets`: logical media asset and ownership.
- `media_variants`: thumbnails and derived renditions.
- `media_metadata`: capture time, EXIF-derived fields and optional location metadata.
- `media_uploads`: upload and processing state.
- `media_processing_jobs`: durable queue, lease, retry and terminal processing state for media workers.
- `media_processing_jobs`: durable, retryable work queue for verified uploads; workers claim jobs with PostgreSQL `SKIP LOCKED`.

### Social content and memories
- `posts`: social and space-scoped publications.
- `post_comments`: comments and replies.
- `content_reactions`: reactions to supported content targets.
- `timeline_entries`: chronological memory/feed projection; a partial unique index guarantees one media item per space.
- `event_albums`, `event_album_items`: collaborative event albums and media ordering.

### Audio, notifications and reliability
- `audio_sessions`: shared listening sessions scoped to a space.
- `audio_queue_items`: ordered queue and playback metadata.
- `audio_participants`: connected session participants and device state.
- `audio_votes`: participant votes for queue actions.
- `notifications`: in-app notification records and read state.
- `idempotency_records`: deduplication keys for retried operations.

### Moderation, access, audit and support
- `space_audit_events`: space-level activity history.
- `user_reports`: user-submitted safety reports.
- `moderation_cases`: moderation workflow and decisions.
- `audit_logs`: security and administrative audit trail.
- `media_access_grants`: explicit view/download grants for users or spaces.
- `support_tickets`: customer support requests.

### Billing and privacy operations
- `billing_plans`: plan catalog and entitlements.
- `subscriptions`: user subscription lifecycle.
- `payment_events`: provider webhook events with unique provider event IDs.
- `user_data_requests`: export and deletion request lifecycle.
- `retention_policies`: versioned retention configuration, disabled until approved.

## Local SQLite schema (10 tables)

- `local_account`
- `cached_spaces`
- `cached_space_memberships`
- `local_media_assets`
- `local_media_variants`
- `cached_posts`
- `cached_timeline_entries`
- `outbox_operations`
- `sync_cursors`
- `cached_downloads`

SQLite is a device cache and durable offline outbox, not the system of record. Authentication secrets belong in iOS Keychain / Android Keystore. Encryption-at-rest configuration, secure local file handling and sync conflict resolution are implementation tasks for the mobile/offline phases.

## Critical invariants

1. A space has one subtype matching its declared type.
2. An active space has exactly one active owner membership.
3. An active COUPLE space has exactly two active memberships at transaction commit.
4. A space membership cannot be moved to another space with an UPDATE; remove and recreate it.
5. Event albums can only belong to EVENT spaces.
6. Active audio participation without a device ID is unique per user/session.
7. Invitation tokens and refresh tokens are stored as hashes, not reusable raw secrets.
8. Payment webhook events are unique by provider and provider event ID.
9. Retention policies cannot be enabled without an approval timestamp.
10. Media object bytes are not stored in PostgreSQL; private object storage keys and metadata are persisted.

## Explicit boundaries / implementation dependencies

- Authorization is required on every API read/write, including generic content targets. Database rows alone do not grant access.
- `media_access_grants.subject_id` and generic audit/content target IDs are polymorphic references; their existence and ownership must be validated in domain services. Do not treat them as ordinary foreign keys.
- Signed media URLs must be short-lived and issued only after authorization.
- Retention periods and deletion/anonymization behavior must be approved for each jurisdiction before policies are enabled.
- The schema prepares Social Audio state; synchronized playback still depends on a licensed music provider and its platform SDK/terms.
- Subscription and payment tables do not mean a payment provider has been selected or connected.
