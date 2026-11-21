BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_log_media_asset_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.status='deleted' THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    VALUES(CASE WHEN TG_OP='DELETE' THEN OLD.owner_id ELSE NEW.owner_id END,
      'media_asset',CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,'delete',NULL);
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.width IS DISTINCT FROM NEW.width
     OR OLD.height IS DISTINCT FROM NEW.height
     OR OLD.mime_type_detected IS DISTINCT FROM NEW.mime_type_detected THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    VALUES(NEW.owner_id,'media_asset',NEW.id,'upsert',
      jsonb_build_object(
        'id',NEW.id,'mime_type',NEW.mime_type_detected,
        'size_bytes',NEW.size_bytes,'width',NEW.width,'height',NEW.height,
        'status',NEW.status,'created_at',NEW.created_at,
        'processing_completed_at',NEW.processing_completed_at
      ));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER media_assets_sync_insert
AFTER INSERT ON media_assets
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_media_asset_change();

CREATE TRIGGER media_assets_sync_update
AFTER UPDATE OF status,width,height,mime_type_detected,processing_completed_at ON media_assets
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_media_asset_change();

CREATE TRIGGER media_assets_sync_delete
AFTER DELETE ON media_assets
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_media_asset_change();

INSERT INTO schema_migrations(version) VALUES ('0039_sync_media_asset_lifecycle')
ON CONFLICT(version) DO NOTHING;
COMMIT;
