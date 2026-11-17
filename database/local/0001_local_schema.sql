-- MOMENTIA local-first SQLite schema. SQLite 3.35+.
-- Keep auth secrets in iOS Keychain / Android Keystore, never in this database.
PRAGMA foreign_keys = ON;

CREATE TABLE local_account (
 singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
 remote_user_id TEXT,
 display_name TEXT,
 last_profile_sync_at TEXT
);

CREATE TABLE cached_spaces (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL CHECK (type IN ('EVENT','COUPLE','CIRCLE')),
 name TEXT NOT NULL,
 status TEXT NOT NULL,
 visibility TEXT NOT NULL,
 server_updated_at TEXT NOT NULL,
 cached_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE cached_space_memberships (
 space_id TEXT NOT NULL REFERENCES cached_spaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 role TEXT NOT NULL,
 state TEXT NOT NULL,
 server_updated_at TEXT NOT NULL,
 PRIMARY KEY(space_id,user_id)
);

CREATE TABLE local_media_assets (
 local_id TEXT PRIMARY KEY,
 remote_id TEXT UNIQUE,
 file_uri TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
 checksum_sha256 TEXT,
 captured_at_utc TEXT,
 captured_timezone TEXT,
 uploaded_at_utc TEXT,
 upload_state TEXT NOT NULL DEFAULT 'queued'
  CHECK (upload_state IN ('queued','preparing','uploading','uploaded','processing','ready','failed','cancelled')),
 gps_ciphertext BLOB,
 gps_consent_at TEXT,
 last_error_code TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK (gps_ciphertext IS NULL OR gps_consent_at IS NOT NULL)
);
CREATE INDEX local_media_upload_queue_idx ON local_media_assets(upload_state, created_at);

CREATE TABLE local_media_variants (
 id TEXT PRIMARY KEY,
 local_media_id TEXT NOT NULL REFERENCES local_media_assets(local_id) ON DELETE CASCADE,
 variant_type TEXT NOT NULL CHECK (variant_type IN ('thumbnail','preview','display')),
 file_uri TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(local_media_id,variant_type)
);

CREATE TABLE cached_posts (
 id TEXT PRIMARY KEY,
 author_id TEXT NOT NULL,
 space_id TEXT REFERENCES cached_spaces(id) ON DELETE CASCADE,
 body TEXT,
 audience TEXT NOT NULL CHECK (audience IN ('public','followers','space','private')),
 status TEXT NOT NULL,
 published_at TEXT,
 server_updated_at TEXT NOT NULL
);

CREATE TABLE cached_timeline_entries (
 id TEXT PRIMARY KEY,
 space_id TEXT NOT NULL REFERENCES cached_spaces(id) ON DELETE CASCADE,
 post_id TEXT REFERENCES cached_posts(id) ON DELETE CASCADE,
 local_media_id TEXT REFERENCES local_media_assets(local_id) ON DELETE CASCADE,
 occurred_at TEXT NOT NULL,
 CHECK ((post_id IS NOT NULL AND local_media_id IS NULL) OR (post_id IS NULL AND local_media_id IS NOT NULL))
);
CREATE INDEX cached_timeline_space_time_idx ON cached_timeline_entries(space_id,occurred_at DESC);

CREATE TABLE outbox_operations (
 id TEXT PRIMARY KEY,
 operation_type TEXT NOT NULL,
 aggregate_type TEXT NOT NULL,
 aggregate_local_id TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
 idempotency_key TEXT NOT NULL UNIQUE,
 depends_on_operation_id TEXT REFERENCES outbox_operations(id) ON DELETE SET NULL,
 state TEXT NOT NULL DEFAULT 'pending'
  CHECK (state IN ('pending','in_flight','retry','succeeded','conflict','rejected','cancelled')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
 next_attempt_at TEXT,
 last_error_code TEXT,
 server_version INTEGER,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX outbox_ready_idx ON outbox_operations(state,next_attempt_at,created_at)
 WHERE state IN ('pending','retry');
CREATE INDEX outbox_aggregate_idx ON outbox_operations(aggregate_type,aggregate_local_id,created_at);

CREATE TABLE sync_cursors (
 scope TEXT PRIMARY KEY,
 cursor TEXT,
 last_successful_sync_at TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE cached_downloads (
 id TEXT PRIMARY KEY,
 remote_object_id TEXT NOT NULL,
 file_uri TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
 expires_at TEXT,
 last_accessed_at TEXT NOT NULL,
 pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1))
);
CREATE INDEX cached_downloads_lru_idx ON cached_downloads(pinned,last_accessed_at);

CREATE TRIGGER local_media_updated_at
AFTER UPDATE ON local_media_assets
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
 UPDATE local_media_assets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE local_id = NEW.local_id;
END;

CREATE TRIGGER outbox_updated_at
AFTER UPDATE ON outbox_operations
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
 UPDATE outbox_operations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
