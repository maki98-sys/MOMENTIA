BEGIN;
CREATE OR REPLACE FUNCTION momentia_sync_log_post_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT recipients.user_id,'post',NEW.id,'upsert',
         jsonb_build_object(
           'id',NEW.id,'author_id',NEW.author_id,'space_id',NEW.space_id,
           'media_asset_id',NEW.media_asset_id,'body',NEW.body,'audience',NEW.audience,
           'status',NEW.status,'created_at',NEW.created_at,'published_at',NEW.published_at
         )
  FROM (
    SELECT NEW.author_id AS user_id
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE NEW.space_id IS NOT NULL AND sm.space_id=NEW.space_id AND sm.state='active'
  ) recipients;
  RETURN NEW;
END;
$$;
CREATE TRIGGER posts_sync_insert
AFTER INSERT ON posts
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_post_insert();

CREATE OR REPLACE FUNCTION momentia_sync_log_timeline_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
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
CREATE TRIGGER timeline_entries_sync_insert
AFTER INSERT ON timeline_entries
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_timeline_insert();

INSERT INTO schema_migrations(version) VALUES ('0019_sync_change_triggers')
ON CONFLICT (version) DO NOTHING;
COMMIT;
