CREATE TABLE space_albums (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 name varchar(120) NOT NULL,
 description varchar(500),
 visibility text NOT NULL DEFAULT 'members' CHECK (visibility IN ('members','admins')),
 event_starts_at timestamptz,
 event_ends_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (event_ends_at IS NULL OR event_starts_at IS NULL OR event_ends_at >= event_starts_at)
);
CREATE INDEX space_albums_space_created_idx ON space_albums(space_id,created_at DESC);
CREATE TABLE space_album_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 album_id uuid NOT NULL REFERENCES space_albums(id) ON DELETE CASCADE,
 media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
 added_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 caption varchar(500),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
 removed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(album_id,media_asset_id),
 CHECK ((status='removed') = (removed_at IS NOT NULL))
);
CREATE INDEX space_album_items_album_time_idx ON space_album_items(album_id,occurred_at DESC,id);
CREATE INDEX space_album_items_media_idx ON space_album_items(media_asset_id);
