BEGIN;

-- Heartbeats can be frequent. They are operational telemetry, not user-visible
-- device state, so they must not generate a sync event on every ping.
DROP TRIGGER IF EXISTS devices_sync_update ON devices;
CREATE TRIGGER devices_sync_update
AFTER UPDATE OF platform,revoked_at ON devices
FOR EACH ROW WHEN (OLD.platform IS DISTINCT FROM NEW.platform
  OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at)
EXECUTE FUNCTION momentia_sync_device_change();

INSERT INTO schema_migrations(version) VALUES ('0043_reduce_device_sync_churn')
ON CONFLICT(version) DO NOTHING;
COMMIT;
