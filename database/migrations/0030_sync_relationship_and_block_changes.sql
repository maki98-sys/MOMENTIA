BEGIN;

-- Keep relationship state itself available to both participants.
CREATE OR REPLACE FUNCTION momentia_sync_relationship_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rel user_relationships%ROWTYPE;
  previous_state text;
  change_kind text;
BEGIN
  IF TG_OP='DELETE' THEN
    rel:=OLD;
    previous_state:=OLD.state;
    change_kind:='delete';
  ELSE
    rel:=NEW;
    previous_state:=CASE WHEN TG_OP='UPDATE' THEN OLD.state ELSE NULL END;
    change_kind:='upsert';
  END IF;

  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT rel.requester_id,'relationship',rel.id,change_kind,
    CASE WHEN change_kind='upsert' THEN jsonb_build_object(
      'id',rel.id,'requester_id',rel.requester_id,'target_id',rel.target_id,
      'state',rel.state,'created_at',rel.created_at,'updated_at',rel.updated_at
    ) ELSE NULL END
  UNION ALL
  SELECT rel.target_id,'relationship',rel.id,change_kind,
    CASE WHEN change_kind='upsert' THEN jsonb_build_object(
      'id',rel.id,'requester_id',rel.requester_id,'target_id',rel.target_id,
      'state',rel.state,'created_at',rel.created_at,'updated_at',rel.updated_at
    ) ELSE NULL END;

  -- A follower gains or loses access to the target's followers-only posts.
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND previous_state='accepted' AND rel.state<>'accepted') THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT rel.requester_id,'post',p.id,'delete',NULL
    FROM posts p
    WHERE p.author_id=rel.target_id AND p.audience='followers' AND p.status='published';
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT rel.requester_id,'comment',c.id,'delete',NULL
    FROM post_comments c JOIN posts p ON p.id=c.post_id
    WHERE p.author_id=rel.target_id AND p.audience='followers'
      AND p.status='published' AND c.status='visible';
  ELSIF TG_OP='INSERT' OR (TG_OP='UPDATE' AND previous_state<>'accepted' AND rel.state='accepted') THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT rel.requester_id,'post',p.id,'upsert',
      jsonb_build_object('id',p.id,'author_id',p.author_id,'space_id',p.space_id,
        'media_asset_id',p.media_asset_id,'body',p.body,'audience',p.audience,
        'status',p.status,'created_at',p.created_at,'published_at',p.published_at)
    FROM posts p
    WHERE p.author_id=rel.target_id AND p.audience='followers' AND p.status='published'
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
        (b.blocker_id=rel.requester_id AND b.blocked_id=rel.target_id) OR
        (b.blocker_id=rel.target_id AND b.blocked_id=rel.requester_id));
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT rel.requester_id,'comment',c.id,'upsert',
      jsonb_build_object('id',c.id,'post_id',c.post_id,'author_id',c.author_id,
        'body',c.body,'status',c.status,'created_at',c.created_at)
    FROM post_comments c JOIN posts p ON p.id=c.post_id
    WHERE p.author_id=rel.target_id AND p.audience='followers'
      AND p.status='published' AND c.status='visible'
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
        (b.blocker_id=rel.requester_id AND b.blocked_id=rel.target_id) OR
        (b.blocker_id=rel.target_id AND b.blocked_id=rel.requester_id));
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER user_relationships_sync_insert
AFTER INSERT ON user_relationships
FOR EACH ROW EXECUTE FUNCTION momentia_sync_relationship_change();
CREATE TRIGGER user_relationships_sync_update
AFTER UPDATE OF state ON user_relationships
FOR EACH ROW EXECUTE FUNCTION momentia_sync_relationship_change();
CREATE TRIGGER user_relationships_sync_delete
AFTER DELETE ON user_relationships
FOR EACH ROW EXECUTE FUNCTION momentia_sync_relationship_change();

-- Block/unblock changes immediately invalidate or restore content visibility
-- between the two accounts without exposing either account to other recipients.
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
      change_kind,CASE WHEN change_kind='upsert' THEN jsonb_build_object('blocker_id',blocker,'blocked_id',blocked) ELSE NULL END),
    (blocked,'block',md5(blocker::text || ':' || blocked::text)::uuid,
      change_kind,CASE WHEN change_kind='upsert' THEN jsonb_build_object('blocker_id',blocker,'blocked_id',blocked) ELSE NULL END);

  IF TG_OP<>'DELETE' THEN
    -- Remove each account's content from the other account's offline cache.
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT blocker,'post',p.id,'delete',NULL FROM posts p
    WHERE p.author_id=blocked AND p.status='published'
    UNION ALL
    SELECT blocked,'post',p.id,'delete',NULL FROM posts p
    WHERE p.author_id=blocker AND p.status='published';
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT blocker,'comment',c.id,'delete',NULL FROM post_comments c
      JOIN posts p ON p.id=c.post_id WHERE p.author_id=blocked AND c.status='visible'
    UNION ALL
    SELECT blocked,'comment',c.id,'delete',NULL FROM post_comments c
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
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER user_blocks_sync_insert
AFTER INSERT ON user_blocks
FOR EACH ROW EXECUTE FUNCTION momentia_sync_block_change();
CREATE TRIGGER user_blocks_sync_delete
AFTER DELETE ON user_blocks
FOR EACH ROW EXECUTE FUNCTION momentia_sync_block_change();

INSERT INTO schema_migrations(version) VALUES ('0030_sync_relationship_and_block_changes')
ON CONFLICT (version) DO NOTHING;
COMMIT;
