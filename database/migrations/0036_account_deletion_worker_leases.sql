BEGIN;
ALTER TABLE account_deletion_requests
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN processing_worker_id text,
  ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0 CHECK (processing_attempts>=0),
  ADD COLUMN last_error_code varchar(120);
CREATE INDEX account_deletion_due_idx
  ON account_deletion_requests(scheduled_for,requested_at)
  WHERE status='pending';
CREATE INDEX account_deletion_processing_idx
  ON account_deletion_requests(processing_started_at)
  WHERE status='pending' AND processing_started_at IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES ('0036_account_deletion_worker_leases')
ON CONFLICT(version) DO NOTHING;
COMMIT;
