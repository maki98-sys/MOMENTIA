-- MOMENTIA additive integrity and collaborative event albums.
BEGIN;

CREATE TABLE event_albums (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 title varchar(120) NOT NULL,
 sort_mode text NOT NULL DEFAULT 'captured_at' CHECK (sort_mode IN ('captured_at','uploaded_at','added_at')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_albums_space_idx ON event_albums(space_id, created_at);

CREATE TABLE event_album_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES event_albums(id) ON DELETE CASCADE,
 media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
 added_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 position integer NOT NULL CHECK (position >= 0),
 added_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(album_id, position),
 UNIQUE(album_id, media_asset_id)
);
CREATE INDEX event_album_items_media_idx ON event_album_items(media_asset_id);

-- A space must have exactly one matching subtype row. Create/update/delete
-- the space and subtype in a single transaction.
CREATE FUNCTION assert_space_subtype_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_space uuid; target_type text; event_count integer; couple_count integer; circle_count integer;
BEGIN
 IF TG_TABLE_NAME = 'spaces' THEN
  target_space := COALESCE(NEW.id, OLD.id);
 ELSE
  target_space := COALESCE(NEW.space_id, OLD.space_id);
 END IF;
 SELECT type INTO target_type FROM spaces WHERE id = target_space;
 IF target_type IS NULL THEN RETURN NULL; END IF;
 SELECT count(*) INTO event_count FROM event_details WHERE space_id = target_space;
 SELECT count(*) INTO couple_count FROM couple_details WHERE space_id = target_space;
 SELECT count(*) INTO circle_count FROM circle_details WHERE space_id = target_space;
 IF (target_type = 'EVENT' AND (event_count <> 1 OR couple_count <> 0 OR circle_count <> 0))
 OR (target_type = 'COUPLE' AND (couple_count <> 1 OR event_count <> 0 OR circle_count <> 0))
 OR (target_type = 'CIRCLE' AND (circle_count <> 1 OR event_count <> 0 OR couple_count <> 0)) THEN
  RAISE EXCEPTION 'space % must have exactly one subtype matching type %', target_space, target_type
   USING ERRCODE = 'check_violation';
 END IF;
 RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER spaces_subtype_guard
AFTER INSERT OR UPDATE ON spaces DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_space_subtype_complete();
CREATE CONSTRAINT TRIGGER event_details_subtype_guard
AFTER INSERT OR UPDATE OR DELETE ON event_details DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_space_subtype_complete();
CREATE CONSTRAINT TRIGGER couple_details_subtype_guard
AFTER INSERT OR UPDATE OR DELETE ON couple_details DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_space_subtype_complete();
CREATE CONSTRAINT TRIGGER circle_details_subtype_guard
AFTER INSERT OR UPDATE OR DELETE ON circle_details DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_space_subtype_complete();

-- Event albums are only valid inside EVENT spaces.
CREATE FUNCTION assert_event_album_space_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_space uuid; target_type text;
BEGIN
 target_space := COALESCE(NEW.space_id, OLD.space_id);
 SELECT type INTO target_type FROM spaces WHERE id = target_space;
 IF target_type IS NOT NULL AND target_type <> 'EVENT' THEN
  RAISE EXCEPTION 'event albums require EVENT spaces' USING ERRCODE = 'check_violation';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER event_album_space_type_guard
AFTER INSERT OR UPDATE ON event_albums DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_event_album_space_type();

-- NULL device IDs are not equal in a normal UNIQUE constraint; this partial
-- index prevents duplicate active sessions for a user with no device row.
CREATE UNIQUE INDEX audio_participants_active_user_no_device_uq
ON audio_participants(session_id, user_id)
WHERE left_at IS NULL AND device_id IS NULL;

INSERT INTO schema_migrations(version) VALUES ('0002_space_integrity_and_event_albums');
COMMIT;
