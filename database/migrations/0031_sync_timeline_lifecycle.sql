BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_log_timeline_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT sm.user_id,'timeline_entry',OLD.id,'delete',NULL
  FROM space_memberships sm
  WHERE sm.space_id=OLD.space_id AND sm.state='active'
  UNION
  SELECT sm.user_id,'timeline_entry',NEW.id,'upsert',
    jsonb_build_object(
      'id',NEW.id,'space_id',NEW.space_id,'post_id',NEW.post_id,
      'media_asset_id',NEW.media_asset_id,'occurred_at',NEW.occurred_at,
      'source',NEW.source,'created_at',NEW.created_at
    )
  FROM space_memberships sm
  WHERE sm.space_id=NEW.space_id AND sm.state='active';
  RETURN NEW;
END;
$$;

CREATE TRIGGER timeline_entries_sync_update
AFTER UPDATE OF space_id,post_id,media_asset_id,occurred_at,source ON timeline_entries
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_timeline_update();

CREATE OR REPLACE FUNCTION momentia_sync_log_timeline_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT sm.user_id,'timeline_entry',OLD.id,'delete',NULL
  FROM space_memberships sm
  WHERE sm.space_id=OLD.space_id AND sm.state='active';
  RETURN OLD;
END;
$$;

CREATE TRIGGER timeline_entries_sync_delete
AFTER DELETE ON timeline_entries
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_timeline_delete();

INSERT INTO schema_migrations(version) VALUES ('0031_sync_timeline_lifecycle')
ON CONFLICT (version) DO NOTHING;
COMMIT;
