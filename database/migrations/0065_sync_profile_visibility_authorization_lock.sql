-- Profile visibility is part of follow-request authorization and must be
-- serialized with social relationship changes and sync snapshot reads.
BEGIN;

CREATE TRIGGER sync_authorization_lock_profile_visibility
BEFORE UPDATE OF visibility ON user_profiles
FOR EACH STATEMENT
EXECUTE FUNCTION momentia_sync_authorization_write_lock();

INSERT INTO schema_migrations(version)
VALUES ('0065_sync_profile_visibility_authorization_lock')
ON CONFLICT (version) DO NOTHING;

COMMIT;
