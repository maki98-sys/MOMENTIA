BEGIN;

ALTER TABLE auth_sessions
  ADD COLUMN family_id uuid,
  ADD COLUMN last_used_at timestamptz,
  ADD COLUMN user_agent varchar(500),
  ADD COLUMN ip_address inet;

UPDATE auth_sessions SET family_id=gen_random_uuid() WHERE family_id IS NULL;
ALTER TABLE auth_sessions ALTER COLUMN family_id SET NOT NULL;
CREATE INDEX auth_sessions_family_active_idx ON auth_sessions(family_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_session_refresh_tokens (
  token_hash char(64) PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  replaced_by_hash char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (replaced_by_hash IS NULL OR consumed_at IS NOT NULL)
);
CREATE INDEX auth_session_refresh_family_idx
  ON auth_session_refresh_tokens(family_id,created_at DESC);
CREATE INDEX auth_session_refresh_expiry_idx
  ON auth_session_refresh_tokens(expires_at);

INSERT INTO schema_migrations(version) VALUES ('0050_momentia_refresh_sessions')
ON CONFLICT(version) DO NOTHING;

COMMIT;
