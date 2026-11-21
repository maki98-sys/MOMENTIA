BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_event_details_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE sid uuid; kind text; data jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    sid:=OLD.space_id; kind:='delete'; data:=NULL;
  ELSE
    sid:=NEW.space_id; kind:='upsert';
    data:=jsonb_build_object('space_id',NEW.space_id,'starts_at',NEW.starts_at,
      'ends_at',NEW.ends_at,'timezone',NEW.timezone,
      'moderation_mode',NEW.moderation_mode,'download_policy',NEW.download_policy);
  END IF;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT sm.user_id,'event_details',sid,kind,data
  FROM space_memberships sm
  WHERE sm.space_id=sid AND sm.state='active';
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER event_details_sync_insert
AFTER INSERT ON event_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_event_details_change();
CREATE TRIGGER event_details_sync_update
AFTER UPDATE ON event_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_event_details_change();
CREATE TRIGGER event_details_sync_delete
AFTER DELETE ON event_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_event_details_change();

CREATE OR REPLACE FUNCTION momentia_sync_circle_details_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE sid uuid; kind text; data jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    sid:=OLD.space_id; kind:='delete'; data:=NULL;
  ELSE
    sid:=NEW.space_id; kind:='upsert';
    data:=jsonb_build_object('space_id',NEW.space_id,'description',NEW.description,
      'join_policy',NEW.join_policy);
  END IF;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT sm.user_id,'circle_details',sid,kind,data
  FROM space_memberships sm WHERE sm.space_id=sid AND sm.state='active';
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER circle_details_sync_insert
AFTER INSERT ON circle_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_circle_details_change();
CREATE TRIGGER circle_details_sync_update
AFTER UPDATE ON circle_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_circle_details_change();
CREATE TRIGGER circle_details_sync_delete
AFTER DELETE ON circle_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_circle_details_change();

CREATE OR REPLACE FUNCTION momentia_sync_couple_details_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE sid uuid; kind text; data jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    sid:=OLD.space_id; kind:='delete'; data:=NULL;
  ELSE
    sid:=NEW.space_id; kind:='upsert';
    data:=jsonb_build_object('space_id',NEW.space_id,'anniversary_date',NEW.anniversary_date,
      'settings',NEW.settings);
  END IF;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT sm.user_id,'couple_details',sid,kind,data
  FROM space_memberships sm WHERE sm.space_id=sid AND sm.state='active';
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER couple_details_sync_insert
AFTER INSERT ON couple_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_couple_details_change();
CREATE TRIGGER couple_details_sync_update
AFTER UPDATE ON couple_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_couple_details_change();
CREATE TRIGGER couple_details_sync_delete
AFTER DELETE ON couple_details FOR EACH ROW EXECUTE FUNCTION momentia_sync_couple_details_change();

INSERT INTO schema_migrations(version) VALUES ('0041_sync_space_subtype_details')
ON CONFLICT(version) DO NOTHING;
COMMIT;
