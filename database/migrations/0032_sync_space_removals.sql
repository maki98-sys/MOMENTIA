BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_log_membership_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT OLD.user_id,'membership',OLD.id,'delete',NULL
  UNION
  SELECT sm.user_id,'membership',OLD.id,'delete',NULL
  FROM space_memberships sm
  WHERE sm.space_id=OLD.space_id AND sm.state='active';
  RETURN OLD;
END;
$$;

CREATE TRIGGER space_memberships_sync_delete
AFTER DELETE ON space_memberships
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_membership_delete();

CREATE OR REPLACE FUNCTION momentia_sync_log_space_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT DISTINCT sm.user_id,'space',OLD.id,'delete',NULL
  FROM space_memberships sm
  WHERE sm.space_id=OLD.id AND sm.state='active';
  RETURN OLD;
END;
$$;

CREATE TRIGGER spaces_sync_delete
BEFORE DELETE ON spaces
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_space_delete();

INSERT INTO schema_migrations(version) VALUES ('0032_sync_space_removals')
ON CONFLICT (version) DO NOTHING;
COMMIT;
