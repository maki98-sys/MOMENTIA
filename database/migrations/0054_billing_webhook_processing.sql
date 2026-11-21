BEGIN;
ALTER TABLE billing_webhook_events
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX billing_webhook_events_claim_idx
  ON billing_webhook_events(next_attempt_at,received_at,id)
  WHERE processing_status IN ('received','failed');
CREATE INDEX billing_webhook_events_stale_idx
  ON billing_webhook_events(processing_started_at)
  WHERE processing_status='processing';
INSERT INTO schema_migrations(version) VALUES ('0054_billing_webhook_processing');
COMMIT;
