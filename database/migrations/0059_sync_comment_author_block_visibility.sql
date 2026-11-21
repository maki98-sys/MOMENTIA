BEGIN;

-- A block also hides comments authored by the blocked account, even when
-- those comments live under a third party's post.
CREATE OR REPLACE FUNCTION momentia_sync_comment_author_block_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  blocker uuid;
  blocked uuid;
  viewer uuid;
  author uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    blocker:=OLD.blocker_id;
    blocked:=OLD.blocked_id;
  ELSE
    blocker:=NEW.blocker_id;
    blocked:=NEW.blocked_id;
  END IF;

  IF TG_OP<>'DELETE' THEN
    -- Remove comments written by the blocked account from the blocker's cache.
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT blocker,'comment',c.id,'delete',NULL
    FROM post_comments c
    JOIN posts p ON p.id=c.post_id
    WHERE c.author_id=blocked AND c.status='visible' AND p.status='published'
      AND (
        p.audience='public'
        OR (p.audience='followers' AND EXISTS(
          SELECT 1 FROM user_relationships r
          WHERE r.requester_id=blocker AND r.target_id=p.author_id AND r.state='accepted'))
        OR (p.audience='space' AND EXISTS(
          SELECT 1 FROM space_memberships sm
          WHERE sm.space_id=p.space_id AND sm.user_id=blocker AND sm.state='active'))
      )
    UNION ALL
    SELECT blocked,'comment',c.id,'delete',NULL
    FROM post_comments c
    JOIN posts p ON p.id=c.post_id
    WHERE c.author_id=blocker AND c.status='visible' AND p.status='published'
      AND (
        p.audience='public'
        OR (p.audience='followers' AND EXISTS(
          SELECT 1 FROM user_relationships r
          WHERE r.requester_id=blocked AND r.target_id=p.author_id AND r.state='accepted'))
        OR (p.audience='space' AND EXISTS(
          SELECT 1 FROM space_memberships sm
          WHERE sm.space_id=p.space_id AND sm.user_id=blocked AND sm.state='active'))
      );
  ELSE
    -- Restore only comments whose post and author are both still visible.
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT blocker,'comment',c.id,'upsert',
      jsonb_build_object('id',c.id,'post_id',c.post_id,'author_id',c.author_id,
        'body',c.body,'status',c.status,'created_at',c.created_at)
    FROM post_comments c
    JOIN posts p ON p.id=c.post_id
    WHERE c.author_id=blocked AND c.status='visible' AND p.status='published'
      AND (
        p.audience='public'
        OR (p.audience='followers' AND EXISTS(
          SELECT 1 FROM user_relationships r
          WHERE r.requester_id=blocker AND r.target_id=p.author_id AND r.state='accepted'))
        OR (p.audience='space' AND EXISTS(
          SELECT 1 FROM space_memberships sm
          WHERE sm.space_id=p.space_id AND sm.user_id=blocker AND sm.state='active'))
      )
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
        (b.blocker_id=blocker AND b.blocked_id=p.author_id) OR
        (b.blocker_id=p.author_id AND b.blocked_id=blocker))
    UNION ALL
    SELECT blocked,'comment',c.id,'upsert',
      jsonb_build_object('id',c.id,'post_id',c.post_id,'author_id',c.author_id,
        'body',c.body,'status',c.status,'created_at',c.created_at)
    FROM post_comments c
    JOIN posts p ON p.id=c.post_id
    WHERE c.author_id=blocker AND c.status='visible' AND p.status='published'
      AND (
        p.audience='public'
        OR (p.audience='followers' AND EXISTS(
          SELECT 1 FROM user_relationships r
          WHERE r.requester_id=blocked AND r.target_id=p.author_id AND r.state='accepted'))
        OR (p.audience='space' AND EXISTS(
          SELECT 1 FROM space_memberships sm
          WHERE sm.space_id=p.space_id AND sm.user_id=blocked AND sm.state='active'))
      )
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
        (b.blocker_id=blocked AND b.blocked_id=p.author_id) OR
        (b.blocker_id=p.author_id AND b.blocked_id=blocked));
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER user_blocks_sync_comment_author_changes
AFTER INSERT OR DELETE ON user_blocks
FOR EACH ROW EXECUTE FUNCTION momentia_sync_comment_author_block_change();

INSERT INTO schema_migrations(version) VALUES ('0059_sync_comment_author_block_visibility')
ON CONFLICT (version) DO NOTHING;

COMMIT;
