BEGIN;
ALTER TABLE notifications ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX notifications_user_dedupe_uq
  ON notifications(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL,
  in_app_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,category)
);
CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('push')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','delivered','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code varchar(120),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE(notification_id,device_id,channel)
);
CREATE INDEX notification_outbox_dispatch_idx
  ON notification_outbox(status,next_attempt_at,created_at)
  WHERE status IN ('pending','failed');
CREATE INDEX notification_outbox_user_idx
  ON notification_outbox(user_id,created_at DESC);
INSERT INTO schema_migrations(version) VALUES ('0013_notification_delivery_preferences');
COMMIT;
