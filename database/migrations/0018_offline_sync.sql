BEGIN;
CREATE TABLE sync_operation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  operation_type text NOT NULL,
  result jsonb,
  error_code text,
  state text NOT NULL DEFAULT 'processing' CHECK (state IN ('processing','succeeded','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(user_id, operation_id)
);
CREATE INDEX sync_operation_receipts_user_time_idx
  ON sync_operation_receipts(user_id, created_at DESC);
CREATE TABLE sync_change_log (
  sequence_id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('upsert','delete')),
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_change_log_user_cursor_idx ON sync_change_log(user_id, sequence_id);
INSERT INTO schema_migrations(version) VALUES ('0018_offline_sync')
ON CONFLICT (version) DO NOTHING;
COMMIT;
