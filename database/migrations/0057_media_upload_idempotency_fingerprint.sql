BEGIN;

ALTER TABLE media_uploads
  ADD COLUMN IF NOT EXISTS request_fingerprint char(64);

CREATE INDEX IF NOT EXISTS media_uploads_fingerprint_idx
  ON media_uploads(uploader_id, idempotency_key, request_fingerprint);

INSERT INTO schema_migrations(version) VALUES ('0057_media_upload_idempotency_fingerprint')
ON CONFLICT(version) DO NOTHING;

COMMIT;
