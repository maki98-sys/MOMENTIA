BEGIN;
ALTER TABLE media_storage_deletions ADD COLUMN locked_at timestamptz;
ALTER TABLE media_storage_deletions ADD COLUMN locked_by text;
INSERT INTO schema_migrations(version) VALUES ('0016_media_deletion_leases');
COMMIT;
