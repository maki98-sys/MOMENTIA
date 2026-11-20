-- Mutual-consent invitations for private couple spaces.
BEGIN;
CREATE TABLE couple_space_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 inviter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 invitee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 token_hash char(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 accepted_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (inviter_user_id <> invitee_user_id),
 CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX couple_invites_one_pending_pair_uq
 ON couple_space_invitations(inviter_user_id,invitee_user_id)
 WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX couple_invites_incoming_idx
 ON couple_space_invitations(invitee_user_id,created_at DESC)
 WHERE accepted_at IS NULL AND revoked_at IS NULL;
INSERT INTO schema_migrations(version) VALUES ('0008_couple_mutual_consent');
COMMIT;
