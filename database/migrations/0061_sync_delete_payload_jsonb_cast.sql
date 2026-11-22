-- Fix JSONB typing in sync tombstones emitted when memberships/spaces are deleted.
-- Keep this as a forward-only migration so already-applied migrations remain immutable.
BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_log_membership_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT OLD.user_id,'membership',OLD.id,'delete',NULL::jsonb
  UNION
  SELECT sm.user_id,'membership',OLD.id,'delete',NULL::jsonb
  FROM space_memberships sm
  WHERE sm.space_id=OLD.space_id AND sm.state='active';
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION momentia_sync_log_space_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT DISTINCT sm.user_id,'space',OLD.id,'delete',NULL::jsonb
  FROM space_memberships sm
  WHERE sm.space_id=OLD.id AND sm.state='active';
  RETURN OLD;
END;
$$;

INSERT INTO public.schema_migrations(version)
VALUES ('0061_sync_delete_payload_jsonb_cast')
ON CONFLICT(version) DO NOTHING;

COMMIT;
