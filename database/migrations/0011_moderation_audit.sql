BEGIN;
CREATE TABLE moderation_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 moderator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 report_id uuid NOT NULL REFERENCES user_reports(id) ON DELETE RESTRICT,
 target_type text NOT NULL CHECK (target_type IN ('user','post','comment','space','media')),
 target_id uuid NOT NULL,
 decision text NOT NULL CHECK (decision IN ('reviewing','resolved','dismissed')),
 action text NOT NULL CHECK (action IN ('none','hide','restore','suspend_user','unsuspend_user','remove_media')),
 note varchar(2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_audit_report_time_idx ON moderation_audit_events(report_id,created_at DESC);
CREATE INDEX moderation_audit_moderator_time_idx ON moderation_audit_events(moderator_id,created_at DESC);
INSERT INTO schema_migrations(version) VALUES ('0011_moderation_audit');
COMMIT;
