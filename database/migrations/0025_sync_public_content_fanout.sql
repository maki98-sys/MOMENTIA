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
    SELECT u.id FROM users u WHERE NEW.audience='public' AND u.status='active'
    UNION
    SELECT r.requester_id FROM user_relationships r
    WHERE r.target_id=NEW.author_id AND r.state='accepted'
      AND NEW.audience='followers'
    UNION
    SELECT sm.user_id FROM space_memberships sm
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
    SELECT u.id FROM users u WHERE (NEW.audience='public' OR (was_visible AND OLD.audience='public')) AND u.status='active'
    UNION
    SELECT r.requester_id FROM user_relationships r
    WHERE r.target_id=NEW.author_id AND r.state='accepted'
      AND (NEW.audience='followers' OR (was_visible AND OLD.audience='followers'))
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE sm.space_id IN (NEW.space_id,OLD.space_id) AND sm.state='active'
      AND (NEW.audience='space' OR (was_visible AND OLD.audience='space'))
  ) recipients
  WHERE NOT EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id=NEW.author_id AND b.blocked_id=recipients.user_id)
       OR (b.blocker_id=recipients.user_id AND b.blocked_id=NEW.author_id)
  );
  RETURN NEW;
END;
$$;

INSERT INTO schema_migrations(version) VALUES ('0025_sync_public_content_fanout')
ON CONFLICT (version) DO NOTHING;
COMMIT;
