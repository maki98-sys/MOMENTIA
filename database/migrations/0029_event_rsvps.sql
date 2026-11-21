BEGIN;
CREATE TABLE event_rsvps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 response text NOT NULL CHECK (response IN ('going','interested','declined')),
 guest_count integer NOT NULL DEFAULT 0 CHECK (guest_count BETWEEN 0 AND 20),
 note varchar(500),
 responded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(space_id,user_id)
);
CREATE INDEX event_rsvps_space_response_idx ON event_rsvps(space_id,response,responded_at DESC);
INSERT INTO schema_migrations(version) VALUES ('0029_event_rsvps')
ON CONFLICT(version) DO NOTHING;
COMMIT;
