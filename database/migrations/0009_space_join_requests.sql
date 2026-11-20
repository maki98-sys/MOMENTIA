-- Join requests for approval-based public/unlisted circles.
BEGIN;
CREATE TABLE space_join_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status='pending' AND reviewed_at IS NULL) OR (status<>'pending' AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX space_join_requests_pending_uq
 ON space_join_requests(space_id,requester_id) WHERE status='pending';
CREATE INDEX space_join_requests_queue_idx
 ON space_join_requests(space_id,created_at) WHERE status='pending';
CREATE TRIGGER space_join_requests_updated_at BEFORE UPDATE ON space_join_requests
 FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO schema_migrations(version) VALUES ('0009_space_join_requests');
COMMIT;
