BEGIN;
CREATE TABLE account_deletion_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled','completed')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 scheduled_for timestamptz NOT NULL DEFAULT (now()+interval '30 days'),
 cancelled_at timestamptz,
 completed_at timestamptz,
 CHECK (scheduled_for>requested_at)
);
CREATE UNIQUE INDEX account_deletion_one_pending_per_user
 ON account_deletion_requests(user_id) WHERE status='pending';
CREATE INDEX account_deletion_due_idx
 ON account_deletion_requests(scheduled_for) WHERE status='pending';
ALTER TABLE users ADD COLUMN deletion_requested_at timestamptz;
INSERT INTO schema_migrations(version) VALUES ('0027_account_lifecycle')
ON CONFLICT(version) DO NOTHING;
COMMIT;
