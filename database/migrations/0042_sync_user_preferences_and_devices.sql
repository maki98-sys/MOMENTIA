BEGIN;

-- Device metadata is private to its owner. Never copy encrypted or plaintext
-- push credentials into the synchronization log.
CREATE OR REPLACE FUNCTION momentia_sync_device_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_user uuid; target_id uuid; kind text; data jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    target_user:=OLD.user_id; target_id:=OLD.id; kind:='delete'; data:=NULL;
  ELSIF NEW.revoked_at IS NOT NULL THEN
    target_user:=NEW.user_id; target_id:=NEW.id; kind:='delete'; data:=NULL;
  ELSE
    target_user:=NEW.user_id; target_id:=NEW.id; kind:='upsert';
    data:=jsonb_build_object('id',NEW.id,'platform',NEW.platform,
      'last_seen_at',NEW.last_seen_at,'created_at',NEW.created_at);
  END IF;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  VALUES(target_user,'device',target_id,kind,data);
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER devices_sync_insert
AFTER INSERT ON devices FOR EACH ROW EXECUTE FUNCTION momentia_sync_device_change();
CREATE TRIGGER devices_sync_update
AFTER UPDATE OF platform,last_seen_at,revoked_at ON devices
FOR EACH ROW WHEN (OLD.platform IS DISTINCT FROM NEW.platform
  OR OLD.last_seen_at IS DISTINCT FROM NEW.last_seen_at
  OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at)
EXECUTE FUNCTION momentia_sync_device_change();
CREATE TRIGGER devices_sync_delete
AFTER DELETE ON devices FOR EACH ROW EXECUTE FUNCTION momentia_sync_device_change();

CREATE OR REPLACE FUNCTION momentia_sync_notification_preference_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_user uuid; category_name text; kind text; data jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    target_user:=OLD.user_id; category_name:=OLD.category; kind:='delete'; data:=NULL;
  ELSE
    target_user:=NEW.user_id; category_name:=NEW.category; kind:='upsert';
    data:=jsonb_build_object('category',NEW.category,'in_app_enabled',NEW.in_app_enabled,
      'push_enabled',NEW.push_enabled,'updated_at',NEW.updated_at);
  END IF;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  VALUES(target_user,'notification_preference',
    md5(target_user::text||':'||category_name)::uuid,kind,data);
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER notification_preferences_sync_insert
AFTER INSERT ON notification_preferences FOR EACH ROW
EXECUTE FUNCTION momentia_sync_notification_preference_change();
CREATE TRIGGER notification_preferences_sync_update
AFTER UPDATE ON notification_preferences FOR EACH ROW
EXECUTE FUNCTION momentia_sync_notification_preference_change();
CREATE TRIGGER notification_preferences_sync_delete
AFTER DELETE ON notification_preferences FOR EACH ROW
EXECUTE FUNCTION momentia_sync_notification_preference_change();

INSERT INTO schema_migrations(version) VALUES ('0042_sync_user_preferences_and_devices')
ON CONFLICT(version) DO NOTHING;
COMMIT;
