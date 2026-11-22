-- Bound storage deletion retries and make exhausted tasks visible for operator recovery.
BEGIN;

ALTER TABLE media_storage_deletions
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 12
    CHECK (max_attempts BETWEEN 1 AND 50),
  ADD COLUMN dead_lettered_at timestamptz;

UPDATE media_storage_deletions
SET dead_lettered_at=now(),
    last_error_code=COALESCE(last_error_code,'RETRY_LIMIT_REACHED')
WHERE attempts>=12 AND status='failed';

CREATE INDEX media_storage_deletions_retryable_idx
  ON media_storage_deletions(status,available_at,created_at)
  WHERE status IN ('pending','failed') AND dead_lettered_at IS NULL;

INSERT INTO schema_migrations(version)
VALUES ('0064_media_storage_deletion_retry_limits')
ON CONFLICT(version) DO NOTHING;

COMMIT;
