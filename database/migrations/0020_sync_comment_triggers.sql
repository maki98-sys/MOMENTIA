BEGIN;
CREATE OR REPLACE FUNCTION momentia_sync_log_comment_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  post_author uuid;
  post_space uuid;
BEGIN
  SELECT author_id,space_id INTO post_author,post_space
  FROM posts WHERE id=NEW.post_id;
  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT recipients.user_id,'comment',NEW.id,'upsert',
         jsonb_build_object(
           'id',NEW.id,'post_id',NEW.post_id,'author_id',NEW.author_id,
           'body',NEW.body,'status',NEW.status,'created_at',NEW.created_at
         )
  FROM (
    SELECT NEW.author_id AS user_id
    UNION SELECT post_author WHERE post_author IS NOT NULL
    UNION
    SELECT sm.user_id FROM space_memberships sm
    WHERE post_space IS NOT NULL AND sm.space_id=post_space AND sm.state='active'
  ) recipients;
  RETURN NEW;
END;
$$;
CREATE TRIGGER post_comments_sync_insert
AFTER INSERT ON post_comments
FOR EACH ROW EXECUTE FUNCTION momentia_sync_log_comment_insert();

INSERT INTO schema_migrations(version) VALUES ('0020_sync_comment_triggers')
ON CONFLICT (version) DO NOTHING;
COMMIT;
