BEGIN;
CREATE OR REPLACE FUNCTION momentia_sync_log_space_insert_or_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT sm.user_id,'space',NEW.id,'upsert',
         jsonb_build_object('id',NEW.id,'type',NEW.type,'name',NEW.name,
           'visibility',NEW.visibility,'status',NEW.status,'updated_at',NEW.updated_at)
  FROM space_memberships sm
  WHERE sm.space_id=NEW.id AND sm.state='active'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER spaces_sync_upsert
AFTER INSERT OR UPDATE OF name,visibility,status,settings ON spaces
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_space_insert_or_update();

CREATE OR REPLACE FUNCTION momentia_sync_log_membership_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE sid uuid; target_user uuid;
BEGIN
  sid:=NEW.space_id;
  target_user:=NEW.user_id;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT recipients.user_id,'membership',NEW.id,'upsert',
         jsonb_build_object('id',NEW.id,'space_id',NEW.space_id,'user_id',NEW.user_id,
           'role',NEW.role,'state',NEW.state,'joined_at',NEW.joined_at,'left_at',NEW.left_at)
  FROM (
    SELECT target_user AS user_id
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE sm.space_id=sid AND sm.state='active'
  ) recipients
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER space_memberships_sync_upsert
AFTER INSERT OR UPDATE OF role,state,joined_at,left_at ON space_memberships
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_membership_change();

INSERT INTO schema_migrations(version) VALUES ('0021_sync_space_membership_triggers')
ON CONFLICT (version) DO NOTHING;
COMMIT;
