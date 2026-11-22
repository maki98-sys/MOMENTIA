BEGIN;
ALTER TABLE space_albums
  ADD COLUMN sort_mode text NOT NULL DEFAULT 'added_at'
    CHECK (sort_mode IN ('captured_at','uploaded_at','added_at'));
INSERT INTO schema_migrations(version)
VALUES ('0067_space_album_sort_modes')
ON CONFLICT(version) DO NOTHING;
COMMIT;
