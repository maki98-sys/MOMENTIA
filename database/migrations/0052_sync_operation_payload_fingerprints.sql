BEGIN;

ALTER TABLE sync_operation_receipts
  ADD COLUMN request_hash char(64);

ALTER TABLE sync_operation_receipts
  ADD CONSTRAINT sync_operation_receipts_request_hash_format
  CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$');

INSERT INTO schema_migrations(version)
VALUES ('0052_sync_operation_payload_fingerprints')
ON CONFLICT (version) DO NOTHING;

COMMIT;
