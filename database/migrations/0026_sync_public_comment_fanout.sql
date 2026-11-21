BEGIN;
CREATE OR REPLACE FUNCTION momentia_sync_log_comment_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE post_author uuid; post_space uuid; post_audience text;
BEGIN
  SELECT author_id,space_id,audience INTO post_author,post_space,post_audience
  FROM posts WHERE id=NEW.post_id;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT DISTINCT recipients.user_id,'comment',NEW.id,'upsert',
         jsonb_build_object(
           'id',NEW.id,'post_id',NEW.post_id,'author_id',NEW.author_id,
           'body',NEW.body,'status',NEW.status,'created_at',NEW.created_at
         )
  FROM (
    SELECT NEW.author_id AS user_id
    UNION SELECT post_author WHERE post_author IS NOT NULL
    UNION SELECT u.id FROM users u WHERE post_audience='public' AND u.status='active'
    UNION
    SELECT r.requester_id FROM user_relationships r
    WHERE r.target_id=post_author AND r.state='accepted' AND post_audience='followers'
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE post_space IS NOT NULL AND post_audience='space'
      AND sm.space_id=post_space AND sm.state='active'
  ) recipients
  WHERE NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id=NEW.author_id AND b.blocked_id=recipients.user_id)
       OR (b.blocker_id=recipients.user_id AND b.blocked_id=NEW.author_id)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION momentia_sync_log_comment_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p_author uuid; p_space uuid; p_audience text;
BEGIN
  SELECT author_id,space_id,audience INTO p_author,p_space,p_audience
  FROM posts WHERE id=NEW.post_id;
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
    UNION SELECT u.id FROM users u WHERE p_audience='public' AND u.status='active'
    UNION
    SELECT r.requester_id FROM user_relationships r
    WHERE r.target_id=p_author AND r.state='accepted' AND p_audience='followers'
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE p_space IS NOT NULL AND p_audience='space'
      AND sm.space_id=p_space AND sm.state='active'
  ) recipients
  WHERE NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id=NEW.author_id AND b.blocked_id=recipients.user_id)
       OR (b.blocker_id=recipients.user_id AND b.blocked_id=NEW.author_id)
  );
  RETURN NEW;
END;
$$;
INSERT INTO schema_migrations(version) VALUES ('0026_sync_public_comment_fanout')
ON CONFLICT (version) DO NOTHING;
COMMIT;
