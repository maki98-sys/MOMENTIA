-- Serialize authorization-changing writes against sync snapshot materialization.
-- Snapshots take a shared transaction lock; these row triggers take the matching
-- exclusive transaction lock before changing data used by snapshot authorization.
BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_authorization_write_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('momentia.sync.authorization', 0)
  );

  -- Statement-level locking happens before PostgreSQL locks individual rows,
  -- avoiding row-lock/advisory-lock inversion between concurrent transactions.
  RETURN NULL;
END;
$$;

CREATE TRIGGER sync_authorization_lock_memberships
BEFORE INSERT OR UPDATE OR DELETE ON space_memberships
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_relationships
BEFORE INSERT OR UPDATE OR DELETE ON user_relationships
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_blocks
BEFORE INSERT OR DELETE ON user_blocks
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_spaces
BEFORE INSERT OR DELETE OR UPDATE OF status, visibility, type, owner_id ON spaces
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_posts
BEFORE INSERT OR DELETE OR UPDATE OF audience, status, author_id, space_id ON posts
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_comments
BEFORE INSERT OR DELETE OR UPDATE OF status, author_id, post_id ON post_comments
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_albums
BEFORE INSERT OR DELETE OR UPDATE OF visibility, space_id ON space_albums
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_album_items
BEFORE INSERT OR DELETE OR UPDATE OF status, album_id, media_asset_id ON space_album_items
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_media
BEFORE DELETE OR UPDATE OF status, owner_id ON media_assets
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

CREATE TRIGGER sync_authorization_lock_user_status
BEFORE DELETE OR UPDATE OF status ON users
FOR EACH STATEMENT EXECUTE FUNCTION momentia_sync_authorization_write_lock();

INSERT INTO schema_migrations(version)
VALUES ('0064_sync_snapshot_authorization_write_lock')
ON CONFLICT (version) DO NOTHING;

COMMIT;
