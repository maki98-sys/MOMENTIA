# MOMENTIA — Database schema inventory

This is the physical PostgreSQL schema inventory for the current database foundation. It documents persisted responsibilities; it does not imply that the corresponding API or user interface has been implemented.

## Server schema (64 tables, including `schema_migrations`)

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

### Social content and memories
- `posts`: social and space-scoped publications.
- `post_comments`: comments and replies.
- `content_reactions`: reactions to supported content targets.
- `timeline_entries`: chronological memory/feed projection.
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



### Additional server tables introduced by migrations 0004–0063

These tables are part of the current migration chain and must be included in the physical inventory:

#### Albums, journals and memberships
- `space_albums`, `space_album_items`: general albums scoped to shared spaces (distinct from the event-album tables above).
- `couple_journal_entries`, `couple_space_key_envelopes`: encrypted couple journal entries and per-member key envelopes.
- `couple_space_invitations`: mutual-consent invitations for couple spaces.
- `space_join_requests`: approval workflow for joining spaces.

#### Audit, moderation and account lifecycle
- `user_audit_events`, `moderation_audit_events`: account-level and moderation decision history.
- `account_deletion_requests`: scheduled account deletion and worker lease state.

#### Billing and storage
- `subscription_plans`, `user_subscriptions`, `billing_webhook_events`, `storage_usage_events`: plan entitlements, subscription state, webhook processing and storage accounting.
- Note: the database currently also contains the earlier `billing_plans`, `subscriptions` and `payment_events` model. These overlapping billing models require an explicit ownership/deprecation decision; their coexistence must not be mistaken for one unified billing schema.

#### Notifications and media processing
- `notification_preferences`, `notification_outbox`: per-category preferences and durable push delivery.
- `media_processing_jobs`, `media_storage_deletions`: asynchronous processing and object-storage deletion work.

#### Offline sync and resumable uploads
- `sync_operation_receipts`, `sync_change_log`, `sync_device_cursors`, `sync_snapshot_sessions`: idempotent client operations, change feed, device checkpoints and paginated snapshot state.
- `event_rsvps`: event attendance responses.
- `media_upload_parts`: resumable multipart upload state.
- `auth_session_refresh_tokens`: refresh-token family and rotation state.

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


## Authorization and device lifecycle extensions (0064–0066)

- Migration 0064 adds transaction-level authorization write locks to changes that can alter access to shared content: memberships, relationships, blocks, spaces, posts, comments, albums, album items, media ownership/status and account status.
- Migration 0065 adds the same lock for profile visibility changes, which affect follow authorization.
- These triggers use the shared authorization advisory-lock key. Snapshot and read paths hold the shared lock while permission-sensitive data is read; mutation paths acquire the exclusive lock before row locks and permission checks.
- Migration 0066 adds nullable `devices.device_key` with a unique partial index. New device registrations must provide a stable installation UUID. Re-registering a key updates the device; transferring it to another account revokes the previous account's sessions and pending push deliveries.
- The authorization lock is deliberately global for correctness in this phase. It may serialize unrelated permission mutations; a per-user/per-resource epoch design remains a future scalability optimization.
