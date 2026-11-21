BEGIN;
CREATE OR REPLACE FUNCTION momentia_sync_log_post_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE was_visible boolean; is_visible boolean;
BEGIN
  was_visible:=OLD.status='published';
  is_visible:=NEW.status='published';
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT DISTINCT recipients.user_id,'post',NEW.id,
    CASE WHEN is_visible THEN 'upsert' ELSE 'delete' END,
    CASE WHEN is_visible THEN jsonb_build_object(
      'id',NEW.id,'author_id',NEW.author_id,'space_id',NEW.space_id,
      'media_asset_id',NEW.media_asset_id,'body',NEW.body,'audience',NEW.audience,
      'status',NEW.status,'created_at',NEW.created_at,'published_at',NEW.published_at
    ) ELSE NULL END
  FROM (
    SELECT NEW.author_id AS user_id
    UNION
    SELECT r.requester_id FROM user_relationships r
    WHERE r.target_id=NEW.author_id AND r.state='accepted'
      AND NEW.audience IN ('followers','public')
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE NEW.space_id IS NOT NULL AND NEW.audience='space'
      AND sm.space_id=NEW.space_id AND sm.state='active'
    UNION
    SELECT r.requester_id FROM user_relationships r
    WHERE was_visible AND r.target_id=OLD.author_id AND r.state='accepted'
      AND OLD.audience IN ('followers','public')
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE was_visible AND OLD.space_id IS NOT NULL AND OLD.audience='space'
      AND sm.space_id=OLD.space_id AND sm.state='active'
  ) recipients
  WHERE NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id=NEW.author_id AND b.blocked_id=recipients.user_id)
       OR (b.blocker_id=recipients.user_id AND b.blocked_id=NEW.author_id)
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER posts_sync_update
AFTER UPDATE OF body,media_asset_id,audience,space_id,status ON posts
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_post_update();

CREATE OR REPLACE FUNCTION momentia_sync_log_comment_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p_author uuid; p_space uuid; p_audience text;
BEGIN
  SELECT author_id,space_id,audience INTO p_author,p_space,p_audience FROM posts WHERE id=NEW.post_id;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT DISTINCT recipients.user_id,'comment',NEW.id,
    CASE WHEN NEW.status='visible' THEN 'upsert' ELSE 'delete' END,
    CASE WHEN NEW.status='visible' THEN jsonb_build_object(
      'id',NEW.id,'post_id',NEW.post_id,'author_id',NEW.author_id,
      'body',NEW.body,'status',NEW.status,'created_at',NEW.created_at
    ) ELSE NULL END
  FROM (
    SELECT NEW.author_id AS user_id
    UNION SELECT p_author WHERE p_author IS NOT NULL
    UNION
    SELECT r.requester_id FROM user_relationships r
    WHERE r.target_id=p_author AND r.state='accepted' AND p_audience IN ('followers','public')
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE p_space IS NOT NULL AND p_audience='space' AND sm.space_id=p_space AND sm.state='active'
  ) recipients
  WHERE NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id=NEW.author_id AND b.blocked_id=recipients.user_id)
       OR (b.blocker_id=recipients.user_id AND b.blocked_id=NEW.author_id)
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER post_comments_sync_update
AFTER UPDATE OF body,status ON post_comments
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_comment_update();

INSERT INTO schema_migrations(version) VALUES ('0023_sync_content_updates')
ON CONFLICT (version) DO NOTHING;
COMMIT;
