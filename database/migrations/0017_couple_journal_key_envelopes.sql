BEGIN;
ALTER TABLE couple_journal_entries ADD COLUMN key_version integer NOT NULL DEFAULT 1 CHECK (key_version>0);
CREATE TABLE couple_space_key_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version integer NOT NULL CHECK (key_version>0),
  algorithm text NOT NULL CHECK (algorithm IN ('X25519-HKDF-SHA256-AES256GCM','P256-HKDF-SHA256-AES256GCM')),
  encrypted_key bytea NOT NULL CHECK (octet_length(encrypted_key) BETWEEN 32 AND 4096),
  nonce bytea NOT NULL CHECK (octet_length(nonce) BETWEEN 12 AND 24),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id,user_id,key_version)
);
CREATE INDEX couple_space_key_envelopes_user_idx
  ON couple_space_key_envelopes(user_id,space_id,key_version DESC);
CREATE TRIGGER couple_space_key_envelopes_updated_at
  BEFORE UPDATE ON couple_space_key_envelopes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO schema_migrations(version) VALUES ('0017_couple_journal_key_envelopes');
COMMIT;
