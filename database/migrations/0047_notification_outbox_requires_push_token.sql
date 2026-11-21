BEGIN;

CREATE OR REPLACE FUNCTION enqueue_notification_push()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM notification_preferences p
    WHERE p.user_id=NEW.user_id AND p.category=NEW.category AND p.push_enabled=false
  ) THEN
    INSERT INTO notification_outbox(notification_id,user_id,device_id,channel)
    SELECT NEW.id,NEW.user_id,d.id,'push'
    FROM devices d
    WHERE d.user_id=NEW.user_id
      AND d.revoked_at IS NULL
      AND d.push_token_encrypted IS NOT NULL
    ON CONFLICT(notification_id,device_id,channel) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

INSERT INTO schema_migrations(version)
VALUES ('0047_notification_outbox_requires_push_token')
ON CONFLICT(version) DO NOTHING;

COMMIT;
