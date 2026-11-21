-- Fix JSONB inference for block-trigger tombstones emitted through UNION ALL.
-- Forward-only: replace the trigger function without rewriting migration 0030.
BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_block_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  blocker uuid;
  blocked uuid;
  change_kind text;
BEGIN
  IF TG_OP='DELETE' THEN
    blocker:=OLD.blocker_id; blocked:=OLD.blocked_id; change_kind:='delete';
  ELSE
    blocker:=NEW.blocker_id; blocked:=NEW.blocked_id; change_kind:='upsert';
  END IF;

  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  VALUES
    (blocker,'block',md5(blocker::text || ':' || blocked::text)::uuid,
      change_kind,CASE WHEN change_kind='upsert' THEN jsonb_build_object('blocker_id',blocker,'blocked_id',blocked) ELSE NULL::jsonb END),
    (blocked,'block',md5(blocker::text || ':' || blocked::text)::uuid,
      change_kind,CASE WHEN change_kind='upsert' THEN jsonb_build_object('blocker_id',blocker,'blocked_id',blocked) ELSE NULL::jsonb END);

  IF TG_OP<>'DELETE' THEN
    -- Remove each account's content from the other account's offline cache.
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT blocker,'post',p.id,'delete',NULL::jsonb FROM posts p
    WHERE p.author_id=blocked AND p.status='published'
    UNION ALL
    SELECT blocked,'post',p.id,'delete',NULL::jsonb FROM posts p
    WHERE p.author_id=blocker AND p.status='published';

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT blocker,'comment',c.id,'delete',NULL::jsonb FROM post_comments c
      JOIN posts p ON p.id=c.post_id WHERE p.author_id=blocked AND c.status='visible'
    UNION ALL
    SELECT blocked,'comment',c.id,'delete',NULL::jsonb FROM post_comments c
      JOIN posts p ON p.id=c.post_id WHERE p.author_id=blocker AND c.status='visible';
  ELSE
    -- On unblock, restore only public posts and followers-only posts where
    -- an accepted follow relationship still grants access.
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT blocker,'post',p.id,'upsert',
      jsonb_build_object('id',p.id,'author_id',p.author_id,'space_id',p.space_id,
        'media_asset_id',p.media_asset_id,'body',p.body,'audience',p.audience,
        'status',p.status,'created_at',p.created_at,'published_at',p.published_at)
    FROM posts p WHERE p.author_id=blocked AND p.status='published'
      AND (p.audience='public' OR (p.audience='followers' AND EXISTS(
        SELECT 1 FROM user_relationships r WHERE r.requester_id=blocker
          AND r.target_id=blocked AND r.state='accepted')))
    UNION ALL
    SELECT blocked,'post',p.id,'upsert',
      jsonb_build_object('id',p.id,'author_id',p.author_id,'space_id',p.space_id,
        'media_asset_id',p.media_asset_id,'body',p.body,'audience',p.audience,
        'status',p.status,'created_at',p.created_at,'published_at',p.published_at)
    FROM posts p WHERE p.author_id=blocker AND p.status='published'
      AND (p.audience='public' OR (p.audience='followers' AND EXISTS(
        SELECT 1 FROM user_relationships r WHERE r.requester_id=blocked
          AND r.target_id=blocker AND r.state='accepted')));

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT blocker,'comment',c.id,'upsert',
      jsonb_build_object('id',c.id,'post_id',c.post_id,'author_id',c.author_id,
        'body',c.body,'status',c.status,'created_at',c.created_at)
    FROM post_comments c JOIN posts p ON p.id=c.post_id
    WHERE p.author_id=blocked AND c.status='visible' AND p.status='published'
      AND (p.audience='public' OR (p.audience='followers' AND EXISTS(
        SELECT 1 FROM user_relationships r WHERE r.requester_id=blocker
          AND r.target_id=blocked AND r.state='accepted')))
    UNION ALL
    SELECT blocked,'comment',c.id,'upsert',
      jsonb_build_object('id',c.id,'post_id',c.post_id,'author_id',c.author_id,
        'body',c.body,'status',c.status,'created_at',c.created_at)
    FROM post_comments c JOIN posts p ON p.id=c.post_id
    WHERE p.author_id=blocker AND c.status='visible' AND p.status='published'
      AND (p.audience='public' OR (p.audience='followers' AND EXISTS(
        SELECT 1 FROM user_relationships r WHERE r.requester_id=blocked
          AND r.target_id=blocker AND r.state='accepted')));
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

INSERT INTO schema_migrations(version) VALUES ('0062_sync_block_payload_jsonb_cast')
ON CONFLICT(version) DO NOTHING;

COMMIT;
