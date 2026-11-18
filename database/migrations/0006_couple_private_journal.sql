BEGIN;
CREATE TABLE couple_journal_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 65536),
 nonce bytea NOT NULL CHECK (octet_length(nonce) BETWEEN 12 AND 24),
 encryption_version smallint NOT NULL DEFAULT 1 CHECK (encryption_version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE INDEX couple_journal_space_created_idx ON couple_journal_entries(space_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX couple_journal_author_idx ON couple_journal_entries(author_id,space_id);
INSERT INTO schema_migrations(version) VALUES ('0006_couple_private_journal');
COMMIT;
