BEGIN;
CREATE OR REPLACE FUNCTION notify_space_membership_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE space_owner uuid; space_kind text; space_name text;
BEGIN
  IF NEW.state<>'active' OR (TG_OP='UPDATE' AND OLD.state='active') THEN
    RETURN NEW;
  END IF;
  SELECT owner_id,type,name INTO space_owner,space_kind,space_name
  FROM spaces WHERE id=NEW.space_id;
  IF space_owner IS NOT NULL AND space_owner<>NEW.user_id THEN
    INSERT INTO notifications(user_id,category,payload,dedupe_key)
    VALUES(
      space_owner,
      CASE WHEN space_kind='EVENT' THEN 'event.member_joined' ELSE 'space.member_joined' END,
      jsonb_build_object('spaceId',NEW.space_id,'spaceName',space_name,'memberId',NEW.user_id),
      'space-member-joined:'||NEW.id::text
    )
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER space_membership_join_notification
AFTER INSERT OR UPDATE OF state ON space_memberships
FOR EACH ROW EXECUTE FUNCTION notify_space_membership_change();

INSERT INTO schema_migrations(version) VALUES ('0024_space_membership_notifications')
ON CONFLICT (version) DO NOTHING;
COMMIT;
