BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_event_rsvp_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rsvp event_rsvps%ROWTYPE;
  change_kind text;
BEGIN
  IF TG_OP='DELETE' THEN rsvp:=OLD; change_kind:='delete';
  ELSE rsvp:=NEW; change_kind:='upsert';
  END IF;

  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT DISTINCT recipients.user_id,'event_rsvp',rsvp.id,change_kind,
    CASE WHEN change_kind='upsert' THEN jsonb_build_object(
      'id',rsvp.id,'space_id',rsvp.space_id,'user_id',rsvp.user_id,
      'response',rsvp.response,'guest_count',rsvp.guest_count,
      'note',rsvp.note,'responded_at',rsvp.responded_at
    ) ELSE NULL END
  FROM (
    SELECT rsvp.user_id AS user_id
    UNION
    SELECT sm.user_id
    FROM space_memberships sm
    JOIN spaces s ON s.id=sm.space_id
    WHERE sm.space_id=rsvp.space_id AND sm.state='active'
      AND sm.role IN ('owner','admin','moderator')
      AND s.type='EVENT' AND s.status='active'
  ) recipients
  WHERE EXISTS (
    SELECT 1 FROM spaces s WHERE s.id=rsvp.space_id
      AND s.type='EVENT' AND s.status='active'
  );

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER event_rsvps_sync_insert
AFTER INSERT ON event_rsvps
FOR EACH ROW EXECUTE FUNCTION momentia_sync_event_rsvp_change();
CREATE TRIGGER event_rsvps_sync_update
AFTER UPDATE OF response,guest_count,note,responded_at ON event_rsvps
FOR EACH ROW EXECUTE FUNCTION momentia_sync_event_rsvp_change();
CREATE TRIGGER event_rsvps_sync_delete
AFTER DELETE ON event_rsvps
FOR EACH ROW EXECUTE FUNCTION momentia_sync_event_rsvp_change();

INSERT INTO schema_migrations(version) VALUES ('0033_sync_event_rsvp_changes')
ON CONFLICT(version) DO NOTHING;
COMMIT;
