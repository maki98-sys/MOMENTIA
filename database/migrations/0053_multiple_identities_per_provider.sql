BEGIN;
-- One MOMENTIA account may link multiple external subjects from the configured
-- OIDC issuer. The provider+subject pair remains globally unique.
ALTER TABLE auth_identities
  DROP CONSTRAINT IF EXISTS auth_identities_user_id_provider_key;
CREATE INDEX IF NOT EXISTS auth_identities_user_provider_idx
  ON auth_identities(user_id,provider,created_at);
INSERT INTO schema_migrations(version)
VALUES ('0053_multiple_identities_per_provider')
ON CONFLICT(version) DO NOTHING;
COMMIT;
