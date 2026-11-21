BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_log_album_item_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_album uuid;
  target_space uuid;
  target_visibility text;
  target_item uuid;
  target_media uuid;
  target_caption text;
  target_occurred timestamptz;
  target_created timestamptz;
  target_status text;
  target_added_by uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    target_album:=OLD.album_id; target_item:=OLD.id;
    target_media:=OLD.media_asset_id; target_caption:=OLD.caption;
    target_occurred:=OLD.occurred_at; target_created:=OLD.created_at;
    target_status:='removed'; target_added_by:=OLD.added_by;
  ELSE
    target_album:=NEW.album_id; target_item:=NEW.id;
    target_media:=NEW.media_asset_id; target_caption:=NEW.caption;
    target_occurred:=NEW.occurred_at; target_created:=NEW.created_at;
    target_status:=NEW.status; target_added_by:=NEW.added_by;
  END IF;

  SELECT a.space_id,a.visibility INTO target_space,target_visibility
  FROM space_albums a WHERE a.id=target_album;

  IF target_space IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT sm.user_id,'album_item',target_item,
    CASE WHEN TG_OP='DELETE' OR target_status='removed' THEN 'delete' ELSE 'upsert' END,
    CASE WHEN TG_OP='DELETE' OR target_status='removed' THEN NULL
      ELSE jsonb_build_object(
        'id',target_item,'album_id',target_album,'space_id',target_space,
        'media_asset_id',target_media,'added_by',target_added_by,
        'caption',target_caption,'occurred_at',target_occurred,
        'created_at',target_created,'status',target_status
      ) END
  FROM space_memberships sm
  WHERE sm.space_id=target_space AND sm.state='active'
    AND (target_visibility='members' OR sm.role IN ('owner','admin','moderator'));

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER space_album_items_sync_insert
AFTER INSERT ON space_album_items
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_album_item_change();

CREATE TRIGGER space_album_items_sync_update
AFTER UPDATE OF album_id,media_asset_id,caption,occurred_at,status ON space_album_items
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_album_item_change();

CREATE TRIGGER space_album_items_sync_delete
AFTER DELETE ON space_album_items
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_album_item_change();

INSERT INTO schema_migrations(version) VALUES ('0038_sync_album_item_changes')
ON CONFLICT(version) DO NOTHING;
COMMIT;
