BEGIN;
CREATE TABLE media_upload_parts (
  upload_id uuid NOT NULL REFERENCES media_uploads(id) ON DELETE CASCADE,
  part_number integer NOT NULL CHECK (part_number BETWEEN 0 AND 10000),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(upload_id,part_number)
);
CREATE INDEX media_upload_parts_upload_idx ON media_upload_parts(upload_id,part_number);
INSERT INTO schema_migrations(version) VALUES ('0048_resumable_media_upload_parts');
COMMIT;
