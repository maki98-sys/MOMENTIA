BEGIN;
CREATE OR REPLACE FUNCTION momentia_sync_log_reaction_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reaction_row content_reactions%ROWTYPE;
  parent_post uuid;
  post_author uuid;
  post_space uuid;
  post_audience text;
  event_kind text;
BEGIN
  IF TG_OP='DELETE' THEN reaction_row:=OLD; event_kind:='delete';
  ELSE reaction_row:=NEW; event_kind:='upsert';
  END IF;

  IF reaction_row.target_type='post' THEN
    parent_post:=reaction_row.target_id;
  ELSIF reaction_row.target_type='comment' THEN
    SELECT post_id INTO parent_post FROM post_comments WHERE id=reaction_row.target_id;
  END IF;

  SELECT author_id,space_id,audience INTO post_author,post_space,post_audience
  FROM posts WHERE id=parent_post AND status='published';

  IF post_author IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT DISTINCT recipients.user_id,'reaction',reaction_row.id,event_kind,
    CASE WHEN event_kind='upsert' THEN jsonb_build_object(
      'id',reaction_row.id,'target_type',reaction_row.target_type,
      'target_id',reaction_row.target_id,'user_id',reaction_row.user_id,
      'reaction_type',reaction_row.reaction_type,'created_at',reaction_row.created_at
    ) ELSE NULL END
  FROM (
    SELECT reaction_row.user_id AS user_id
    UNION SELECT post_author
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
    WHERE (b.blocker_id=reaction_row.user_id AND b.blocked_id=recipients.user_id)
       OR (b.blocker_id=recipients.user_id AND b.blocked_id=reaction_row.user_id)
       OR (b.blocker_id=post_author AND b.blocked_id=recipients.user_id)
       OR (b.blocker_id=recipients.user_id AND b.blocked_id=post_author)
  );
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER content_reactions_sync_insert
AFTER INSERT ON content_reactions
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_reaction_change();
CREATE TRIGGER content_reactions_sync_update
AFTER UPDATE OF reaction_type ON content_reactions
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_reaction_change();
CREATE TRIGGER content_reactions_sync_delete
AFTER DELETE ON content_reactions
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_reaction_change();

INSERT INTO schema_migrations(version) VALUES ('0028_sync_reaction_changes')
ON CONFLICT(version) DO NOTHING;
COMMIT;
