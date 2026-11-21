BEGIN;

ALTER TABLE media_assets
  ADD COLUMN storage_provider text NOT NULL DEFAULT 'local'
  CHECK (storage_provider IN ('local','s3'));

ALTER TABLE media_upload_parts
  ADD COLUMN storage_provider text NOT NULL DEFAULT 'local'
  CHECK (storage_provider IN ('local','s3'));

ALTER TABLE media_storage_deletions
  ADD COLUMN storage_provider text NOT NULL DEFAULT 'local'
  CHECK (storage_provider IN ('local','s3'));

ALTER TABLE media_variants
  ADD CONSTRAINT media_variants_storage_provider_check
  CHECK (storage_provider IN ('local','s3'));

INSERT INTO schema_migrations(version) VALUES ('0051_media_object_storage_provider')
ON CONFLICT(version) DO NOTHING;

COMMIT;
