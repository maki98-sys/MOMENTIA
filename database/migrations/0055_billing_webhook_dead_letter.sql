BEGIN;
ALTER TABLE billing_webhook_events
  DROP CONSTRAINT billing_webhook_events_processing_status_check;
ALTER TABLE billing_webhook_events
  ADD CONSTRAINT billing_webhook_events_processing_status_check
  CHECK (processing_status IN ('received','processing','processed','failed','ignored','dead_letter'));
CREATE INDEX billing_webhook_events_dead_letter_idx
  ON billing_webhook_events(updated_at DESC)
  WHERE processing_status='dead_letter';
INSERT INTO schema_migrations(version) VALUES ('0055_billing_webhook_dead_letter');
COMMIT;
