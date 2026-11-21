BEGIN;
CREATE OR REPLACE FUNCTION momentia_sync_log_media_asset_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    VALUES(OLD.owner_id,'media_asset',OLD.id,'delete',NULL);
    RETURN OLD;
  END IF;

  IF NEW.status='deleted' THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    VALUES(NEW.owner_id,'media_asset',NEW.id,'delete',NULL);
    RETURN NEW;
  END IF;

  IF TG_OP='INSERT' THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    VALUES(NEW.owner_id,'media_asset',NEW.id,'upsert',
      jsonb_build_object(
        'id',NEW.id,'mime_type',NEW.mime_type_detected,
        'size_bytes',NEW.size_bytes,'width',NEW.width,'height',NEW.height,
        'status',NEW.status,'created_at',NEW.created_at,
        'processing_completed_at',NEW.processing_completed_at
      ));
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.width IS DISTINCT FROM NEW.width
     OR OLD.height IS DISTINCT FROM NEW.height
     OR OLD.mime_type_detected IS DISTINCT FROM NEW.mime_type_detected
     OR OLD.processing_completed_at IS DISTINCT FROM NEW.processing_completed_at THEN
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
COMMIT;
