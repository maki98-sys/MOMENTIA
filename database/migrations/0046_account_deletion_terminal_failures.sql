BEGIN;
ALTER TABLE account_deletion_requests
  DROP CONSTRAINT account_deletion_requests_status_check;
ALTER TABLE account_deletion_requests
  ADD CONSTRAINT account_deletion_requests_status_check
  CHECK (status IN ('pending','cancelled','completed','failed'));
ALTER TABLE account_deletion_requests
  ADD COLUMN failed_at timestamptz;
CREATE INDEX account_deletion_failed_idx
  ON account_deletion_requests(failed_at DESC)
  WHERE status='failed';
INSERT INTO schema_migrations(version) VALUES ('0046_account_deletion_terminal_failures')
ON CONFLICT(version) DO NOTHING;
COMMIT;
