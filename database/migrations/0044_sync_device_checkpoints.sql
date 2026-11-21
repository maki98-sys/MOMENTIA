BEGIN;

CREATE TABLE sync_device_cursors (
  device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_sequence_id bigint NOT NULL DEFAULT 0 CHECK (last_sequence_id>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id,user_id)
);
CREATE INDEX sync_device_cursors_user_idx ON sync_device_cursors(user_id,updated_at DESC);

INSERT INTO schema_migrations(version) VALUES ('0044_sync_device_checkpoints')
ON CONFLICT(version) DO NOTHING;
COMMIT;
