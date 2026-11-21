BEGIN;

CREATE TABLE sync_snapshot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sections text[] NOT NULL,
  data jsonb NOT NULL,
  cursor bigint NOT NULL CHECK (cursor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT sync_snapshot_sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT sync_snapshot_sessions_data_size_check CHECK (pg_column_size(data) <= 33554432)
);

CREATE INDEX sync_snapshot_sessions_user_expiry_idx
  ON sync_snapshot_sessions(user_id, expires_at);

CREATE INDEX sync_snapshot_sessions_expiry_idx
  ON sync_snapshot_sessions(expires_at);

INSERT INTO schema_migrations(version)
VALUES ('0058_sync_snapshot_sessions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
