BEGIN;
CREATE OR REPLACE FUNCTION enqueue_notification_push()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM notification_preferences p
    WHERE p.user_id=NEW.user_id AND p.category=NEW.category AND p.push_enabled=false
  ) THEN
    INSERT INTO notification_outbox(notification_id,user_id,device_id,channel)
    SELECT NEW.id,NEW.user_id,d.id,'push'
    FROM devices d
    WHERE d.user_id=NEW.user_id AND d.revoked_at IS NULL
    ON CONFLICT(notification_id,device_id,channel) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notifications_push_outbox
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION enqueue_notification_push();

CREATE OR REPLACE FUNCTION notify_relationship_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient uuid; actor uuid; category_name text; notification_key text;
BEGIN
  IF TG_OP='INSERT' AND NEW.state='pending' THEN
    recipient:=NEW.target_id; actor:=NEW.requester_id;
    category_name:='social.follow_request';
    notification_key:='follow-request:'||NEW.id::text;
  ELSIF TG_OP='UPDATE' AND OLD.state IS DISTINCT FROM NEW.state AND NEW.state='accepted' THEN
    recipient:=NEW.requester_id; actor:=NEW.target_id;
    category_name:='social.follow_accepted';
    notification_key:='follow-accepted:'||NEW.id::text;
  ELSE
    RETURN NEW;
  END IF;
  IF recipient<>actor THEN
    INSERT INTO notifications(user_id,category,payload,dedupe_key)
    VALUES(recipient,category_name,jsonb_build_object('actorId',actor,'relationshipId',NEW.id),notification_key)
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_relationship_notification
AFTER INSERT OR UPDATE OF state ON user_relationships
FOR EACH ROW EXECUTE FUNCTION notify_relationship_change();

CREATE OR REPLACE FUNCTION notify_new_comment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient uuid;
BEGIN
  IF NEW.status<>'visible' THEN RETURN NEW; END IF;
  SELECT author_id INTO recipient FROM posts WHERE id=NEW.post_id;
  IF recipient IS NOT NULL AND recipient<>NEW.author_id THEN
    INSERT INTO notifications(user_id,category,payload,dedupe_key)
    VALUES(recipient,'social.comment',jsonb_build_object('actorId',NEW.author_id,'postId',NEW.post_id,'commentId',NEW.id),
      'comment:'||NEW.id::text)
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER post_comment_notification
AFTER INSERT ON post_comments
FOR EACH ROW EXECUTE FUNCTION notify_new_comment();

CREATE OR REPLACE FUNCTION notify_new_reaction()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient uuid; target_post uuid;
BEGIN
  IF NEW.target_type='post' THEN
    SELECT author_id INTO recipient FROM posts WHERE id=NEW.target_id;
    target_post:=NEW.target_id;
  ELSE
    SELECT c.author_id,c.post_id INTO recipient,target_post
    FROM post_comments c WHERE c.id=NEW.target_id;
  END IF;
  IF recipient IS NOT NULL AND recipient<>NEW.user_id THEN
    INSERT INTO notifications(user_id,category,payload,dedupe_key)
    VALUES(recipient,'social.reaction',jsonb_build_object(
      'actorId',NEW.user_id,'targetType',NEW.target_type,'targetId',NEW.target_id,
      'postId',target_post,'reaction',NEW.reaction_type
    ),'reaction:'||NEW.id::text)
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_reaction_notification
AFTER INSERT ON content_reactions
FOR EACH ROW EXECUTE FUNCTION notify_new_reaction();

INSERT INTO schema_migrations(version) VALUES ('0014_notification_domain_triggers');
COMMIT;
