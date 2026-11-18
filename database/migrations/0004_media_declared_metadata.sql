-- Keep client-declared upload metadata separate from server-verified media facts.
BEGIN;

ALTER TABLE media_assets
  ADD COLUMN mime_type_declared text,
  ADD COLUMN checksum_sha256_declared char(64);

UPDATE media_assets
SET mime_type_declared = mime_type_detected,
    checksum_sha256_declared = checksum_sha256;

ALTER TABLE media_assets
  ALTER COLUMN mime_type_declared SET NOT NULL,
  ALTER COLUMN checksum_sha256_declared SET NOT NULL;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_declared_checksum_format
  CHECK (checksum_sha256_declared ~ '^[0-9a-f]{64}$');

INSERT INTO schema_migrations(version) VALUES ('0004_media_declared_metadata');
COMMIT;
