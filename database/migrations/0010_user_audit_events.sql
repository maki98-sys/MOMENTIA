-- Account-level audit trail for actions that happen before a space exists.
BEGIN;
CREATE TABLE user_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL,
 target_type text NOT NULL,
 target_id uuid,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_audit_events_actor_time_idx ON user_audit_events(actor_id,occurred_at DESC);
CREATE INDEX user_audit_events_subject_time_idx ON user_audit_events(subject_user_id,occurred_at DESC);
INSERT INTO schema_migrations(version) VALUES ('0010_user_audit_events');
COMMIT;
