BEGIN;
ALTER TABLE media_uploads
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours');
CREATE INDEX media_uploads_expired_idx
  ON media_uploads(expires_at,created_at)
  WHERE state IN ('created','uploading');
INSERT INTO schema_migrations(version) VALUES ('0037_expired_media_upload_cleanup')
ON CONFLICT(version) DO NOTHING;
COMMIT;
