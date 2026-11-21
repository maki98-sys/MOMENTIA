BEGIN;
CREATE OR REPLACE FUNCTION momentia_sync_log_post_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT DISTINCT recipients.user_id,'post',NEW.id,'upsert',
         jsonb_build_object(
           'id',NEW.id,'author_id',NEW.author_id,'space_id',NEW.space_id,
           'media_asset_id',NEW.media_asset_id,'body',NEW.body,'audience',NEW.audience,
           'status',NEW.status,'created_at',NEW.created_at,'published_at',NEW.published_at
         )
  FROM (
    SELECT NEW.author_id AS user_id
    UNION
    SELECT r.requester_id
    FROM user_relationships r
    WHERE r.target_id=NEW.author_id AND r.state='accepted'
      AND NEW.audience IN ('followers','public')
    UNION
    SELECT sm.user_id
    FROM space_memberships sm
    WHERE NEW.space_id IS NOT NULL AND NEW.audience='space'
      AND sm.space_id=NEW.space_id AND sm.state='active'
  ) recipients
  WHERE NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id=NEW.author_id AND b.blocked_id=recipients.user_id)
       OR (b.blocker_id=recipients.user_id AND b.blocked_id=NEW.author_id)
  );
  RETURN NEW;
END;
$$;

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
    UNION
    SELECT r.requester_id FROM user_relationships r
    WHERE r.target_id=post_author AND r.state='accepted'
      AND post_audience IN ('followers','public')
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
INSERT INTO schema_migrations(version) VALUES ('0022_sync_visibility_filtering')
ON CONFLICT (version) DO NOTHING;
COMMIT;
