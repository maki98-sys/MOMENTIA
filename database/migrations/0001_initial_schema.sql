-- MOMENTIA PostgreSQL 15+ baseline. Apply to a fresh database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email_normalized text UNIQUE,
 phone_e164 text UNIQUE,
 email_verified_at timestamptz,
 phone_verified_at timestamptz,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','deletion_pending','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 CHECK (email_normalized IS NOT NULL OR phone_e164 IS NOT NULL),
 CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE TABLE auth_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL,
 provider_subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider, provider_subject),
 UNIQUE(user_id, provider)
);

CREATE TABLE user_profiles (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 display_name varchar(80) NOT NULL,
 bio varchar(500),
 avatar_media_id uuid,
 visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','followers','private')),
 preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 platform text NOT NULL CHECK (platform IN ('ios','android','web')),
 push_token_encrypted text,
 last_seen_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_active_idx ON devices(user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
 refresh_token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE user_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state text NOT NULL CHECK (state IN ('pending','accepted','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (requester_id <> target_id),
 UNIQUE(requester_id, target_id)
);
CREATE INDEX user_relationships_target_idx ON user_relationships(target_id, state);

CREATE TABLE user_blocks (
 blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(blocker_id, blocked_id),
 CHECK (blocker_id <> blocked_id)
);

CREATE TABLE spaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 type text NOT NULL CHECK (type IN ('EVENT','COUPLE','CIRCLE')),
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 name varchar(120) NOT NULL,
 visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','unlisted','private')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','closed')),
 settings jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz
);
CREATE INDEX spaces_owner_idx ON spaces(owner_id, status, created_at DESC);

CREATE TABLE space_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 role text NOT NULL CHECK (role IN ('owner','admin','moderator','member','guest')),
 state text NOT NULL DEFAULT 'invited' CHECK (state IN ('invited','active','left','removed','banned')),
 joined_at timestamptz,
 left_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(space_id, user_id),
 CHECK ((state = 'active' AND joined_at IS NOT NULL AND left_at IS NULL) OR (state <> 'active' AND joined_at IS NULL AND left_at IS NULL) OR (state IN ('left','removed','banned') AND joined_at IS NOT NULL AND left_at IS NOT NULL))
);
CREATE INDEX space_memberships_user_active_idx ON space_memberships(user_id, space_id) WHERE state = 'active';
CREATE INDEX space_memberships_space_role_idx ON space_memberships(space_id, role) WHERE state = 'active';

CREATE TABLE space_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 token_hash text NOT NULL UNIQUE,
 role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','moderator','member','guest')),
 expires_at timestamptz NOT NULL,
 max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
 uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
 approval_required boolean NOT NULL DEFAULT false,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > created_at)
);
CREATE INDEX space_invitations_active_idx ON space_invitations(space_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE event_details (
 space_id uuid PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
 starts_at timestamptz,
 ends_at timestamptz,
 timezone text NOT NULL,
 moderation_mode text NOT NULL DEFAULT 'host' CHECK (moderation_mode IN ('host','approval','community')),
 download_policy text NOT NULL DEFAULT 'members' CHECK (download_policy IN ('host_only','members','disabled')),
 CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);
CREATE TABLE couple_details (
 space_id uuid PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
 anniversary_date date,
 settings jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE circle_details (
 space_id uuid PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
 description varchar(500),
 join_policy text NOT NULL DEFAULT 'invite' CHECK (join_policy IN ('invite','approval'))
);

CREATE TABLE media_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 storage_key_original text NOT NULL UNIQUE,
 mime_type_detected text NOT NULL,
 size_bytes bigint NOT NULL CHECK (size_bytes > 0),
 width integer CHECK (width IS NULL OR width > 0),
 height integer CHECK (height IS NULL OR height > 0),
 checksum_sha256 char(64) NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','quarantined','failed','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE INDEX media_assets_owner_idx ON media_assets(owner_id, created_at DESC);
CREATE INDEX media_assets_checksum_idx ON media_assets(owner_id, checksum_sha256);
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_avatar_fk FOREIGN KEY (avatar_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE TABLE media_variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
 variant_type text NOT NULL CHECK (variant_type IN ('thumbnail','preview','display','video_poster')),
 storage_key text NOT NULL UNIQUE,
 mime_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK (size_bytes > 0),
 width integer CHECK (width IS NULL OR width > 0),
 height integer CHECK (height IS NULL OR height > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(media_asset_id, variant_type)
);
CREATE TABLE media_metadata (
 media_asset_id uuid PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
 captured_at timestamptz,
 captured_timezone text,
 device_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 gps_ciphertext bytea,
 gps_consent_at timestamptz,
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 CHECK (gps_ciphertext IS NULL OR gps_consent_at IS NOT NULL)
);
CREATE TABLE media_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
 uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'created' CHECK (state IN ('created','uploading','uploaded','processing','completed','failed','cancelled')),
 multipart_upload_id text,
 bytes_received bigint NOT NULL DEFAULT 0 CHECK (bytes_received >= 0),
 last_error_code text,
 idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(uploader_id, idempotency_key)
);
CREATE INDEX media_uploads_state_idx ON media_uploads(state, updated_at);

CREATE TABLE posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 space_id uuid REFERENCES spaces(id) ON DELETE CASCADE,
 media_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
 body text,
 audience text NOT NULL CHECK (audience IN ('public','followers','space','private')),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden','removed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (body IS NOT NULL OR media_asset_id IS NOT NULL),
 CHECK ((audience = 'space' AND space_id IS NOT NULL) OR audience <> 'space')
);
CREATE INDEX posts_author_feed_idx ON posts(author_id, published_at DESC) WHERE status = 'published';
CREATE INDEX posts_space_feed_idx ON posts(space_id, published_at DESC) WHERE status = 'published';
CREATE INDEX posts_public_feed_idx ON posts(published_at DESC) WHERE status = 'published' AND audience = 'public';

CREATE TABLE post_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 body varchar(3000) NOT NULL,
 status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','removed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_comments_post_idx ON post_comments(post_id, created_at);

CREATE TABLE content_reactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_type text NOT NULL CHECK (target_type IN ('post','comment')),
 target_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reaction_type text NOT NULL CHECK (reaction_type IN ('like','love','laugh','wow','support')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(target_type, target_id, user_id)
);
CREATE INDEX content_reactions_target_idx ON content_reactions(target_type, target_id);

CREATE TABLE timeline_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
 media_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
 occurred_at timestamptz NOT NULL,
 source text NOT NULL CHECK (source IN ('capture','post','upload','import')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (num_nonnulls(post_id, media_asset_id) = 1)
);
CREATE INDEX timeline_entries_space_time_idx ON timeline_entries(space_id, occurred_at DESC, id);

CREATE TABLE space_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid REFERENCES spaces(id) ON DELETE SET NULL,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL,
 resource_type text NOT NULL,
 resource_id uuid,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX space_audit_events_space_time_idx ON space_audit_events(space_id, occurred_at DESC);

CREATE TABLE user_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 target_type text NOT NULL CHECK (target_type IN ('user','post','comment','space','media')),
 target_id uuid NOT NULL,
 reason text NOT NULL,
 details varchar(2000),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
 assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);
CREATE INDEX user_reports_queue_idx ON user_reports(status, created_at);

CREATE TABLE audio_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 host_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'created' CHECK (state IN ('created','playing','paused','ended')),
 source_provider text NOT NULL,
 provider_context_id text,
 current_item_id uuid,
 position_ms bigint NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
 playback_state text NOT NULL DEFAULT 'paused' CHECK (playback_state IN ('playing','paused','buffering','ended')),
 scheduled_at timestamptz,
 server_version bigint NOT NULL DEFAULT 1 CHECK (server_version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audio_sessions_space_idx ON audio_sessions(space_id, state, updated_at DESC);
CREATE TABLE audio_queue_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL REFERENCES audio_sessions(id) ON DELETE CASCADE,
 added_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 provider_track_reference text NOT NULL,
 position integer NOT NULL CHECK (position >= 0),
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','current','played','skipped','removed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id, position)
);
ALTER TABLE audio_sessions ADD CONSTRAINT audio_sessions_current_item_fk FOREIGN KEY(current_item_id) REFERENCES audio_queue_items(id) ON DELETE SET NULL;

CREATE TABLE audio_participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL REFERENCES audio_sessions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
 role text NOT NULL DEFAULT 'listener' CHECK (role IN ('host','cohost','listener')),
 joined_at timestamptz NOT NULL DEFAULT now(),
 last_heartbeat_at timestamptz,
 left_at timestamptz,
 UNIQUE(session_id, user_id, device_id)
);
CREATE INDEX audio_participants_active_idx ON audio_participants(session_id, last_heartbeat_at) WHERE left_at IS NULL;
CREATE TABLE audio_votes (
 queue_item_id uuid NOT NULL REFERENCES audio_queue_items(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 vote smallint NOT NULL CHECK (vote IN (-1,1)),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(queue_item_id, user_id)
);

CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE idempotency_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 idempotency_key text NOT NULL,
 request_hash char(64) NOT NULL,
 response_status integer,
 response_body jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 UNIQUE(actor_id, idempotency_key),
 CHECK (expires_at > created_at)
);

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER spaces_updated_at BEFORE UPDATE ON spaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER uploads_updated_at BEFORE UPDATE ON media_uploads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER posts_updated_at BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER audio_sessions_updated_at BEFORE UPDATE ON audio_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Deferred integrity: each COUPLE space must commit with exactly two active members.
-- Create the space and both memberships in the same transaction.
CREATE FUNCTION assert_couple_member_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_space uuid; target_type text; active_count integer;
BEGIN
 target_space := COALESCE(NEW.space_id, OLD.space_id);
 SELECT type INTO target_type FROM spaces WHERE id = target_space FOR UPDATE;
 IF target_type IS NULL OR target_type <> 'COUPLE' THEN RETURN NULL; END IF;
 SELECT count(*) INTO active_count FROM space_memberships
  WHERE space_id = target_space AND state = 'active';
 IF active_count <> 2 THEN
  RAISE EXCEPTION 'COUPLE space % requires exactly 2 active members; found %', target_space, active_count
   USING ERRCODE = 'check_violation';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER couple_member_count_guard
AFTER INSERT OR UPDATE OR DELETE ON space_memberships
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_couple_member_count();

-- Application services must authorize every read/write, including generic target_id references.
-- Never expose object keys directly; issue short-lived signed URLs after authorization.
