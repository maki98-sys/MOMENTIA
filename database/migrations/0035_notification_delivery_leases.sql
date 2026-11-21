BEGIN;
ALTER TABLE notification_outbox
  ADD COLUMN processing_started_at timestamptz;
CREATE INDEX notification_outbox_stale_processing_idx
  ON notification_outbox(processing_started_at)
  WHERE status='processing';
INSERT INTO schema_migrations(version) VALUES ('0035_notification_delivery_leases')
ON CONFLICT(version) DO NOTHING;
COMMIT;
