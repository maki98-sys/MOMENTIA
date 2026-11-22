-- Stable client installation identity makes device registration idempotent
-- and lets a push token move safely when the user changes accounts.
BEGIN;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS devices_device_key_uq ON devices(device_key) WHERE device_key IS NOT NULL;

INSERT INTO schema_migrations(version)
VALUES ('0066_device_installation_identity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
