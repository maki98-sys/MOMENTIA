BEGIN;
ALTER TABLE media_assets ADD COLUMN original_filename varchar(255);
ALTER TABLE media_uploads ADD COLUMN declared_mime_type text;
ALTER TABLE media_uploads ADD CONSTRAINT media_uploads_declared_mime_type_check
 CHECK (declared_mime_type IS NULL OR declared_mime_type IN ('image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime'));
INSERT INTO schema_migrations(version) VALUES ('0005_media_upload_metadata');
COMMIT;
