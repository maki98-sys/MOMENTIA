BEGIN;

CREATE INDEX auth_session_refresh_expired_cleanup_idx
  ON auth_session_refresh_tokens(expires_at,token_hash);

CREATE INDEX auth_sessions_expired_cleanup_idx
  ON auth_sessions(expires_at,id);

CREATE INDEX auth_sessions_revoked_cleanup_idx
  ON auth_sessions(revoked_at,id)
  WHERE revoked_at IS NOT NULL;

INSERT INTO schema_migrations(version)
VALUES ('0060_auth_session_retention_indexes')
ON CONFLICT(version) DO NOTHING;

COMMIT;
