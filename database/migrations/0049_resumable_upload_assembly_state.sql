BEGIN;
ALTER TABLE media_uploads DROP CONSTRAINT media_uploads_state_check;
ALTER TABLE media_uploads ADD CONSTRAINT media_uploads_state_check
  CHECK (state IN ('created','uploading','assembling','uploaded','processing','completed','failed','cancelled'));
INSERT INTO schema_migrations(version) VALUES ('0049_resumable_upload_assembly_state');
COMMIT;
