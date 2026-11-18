-- A media asset appears once in a space timeline, even when shared across multiple albums.
BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY space_id, media_asset_id
           ORDER BY occurred_at ASC, id ASC
         ) AS duplicate_rank
  FROM timeline_entries
  WHERE media_asset_id IS NOT NULL
)
DELETE FROM timeline_entries t
USING ranked r
WHERE t.id = r.id AND r.duplicate_rank > 1;

CREATE UNIQUE INDEX timeline_entries_space_media_uidx
 ON timeline_entries(space_id, media_asset_id)
 WHERE media_asset_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('0006_timeline_media_uniqueness');
COMMIT;
