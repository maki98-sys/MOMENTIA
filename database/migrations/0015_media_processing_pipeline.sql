BEGIN;
CREATE TABLE media_processing_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
 job_type text NOT NULL CHECK (job_type IN ('inspect','image_variants','video_poster','virus_scan','finalize','delete_storage')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
 max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
 available_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 locked_by text,
 last_error_code varchar(120),
 result jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(media_asset_id,job_type)
);
CREATE INDEX media_processing_jobs_claim_idx
 ON media_processing_jobs(status,available_at,created_at)
 WHERE status IN ('pending','failed');
CREATE INDEX media_processing_jobs_asset_idx
 ON media_processing_jobs(media_asset_id,status);

CREATE TABLE media_storage_deletions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
 storage_key text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
 available_at timestamptz NOT NULL DEFAULT now(),
 last_error_code varchar(120),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(media_asset_id,storage_key)
);
CREATE INDEX media_storage_deletions_claim_idx
 ON media_storage_deletions(status,available_at)
 WHERE status IN ('pending','failed');

ALTER TABLE media_assets ADD COLUMN processing_completed_at timestamptz;
ALTER TABLE media_assets ADD COLUMN moderation_scan_status text NOT NULL DEFAULT 'pending'
 CHECK (moderation_scan_status IN ('pending','clean','rejected','unavailable'));
ALTER TABLE media_variants ADD COLUMN checksum_sha256 char(64);
ALTER TABLE media_variants ADD COLUMN storage_provider text NOT NULL DEFAULT 'local';
INSERT INTO schema_migrations(version) VALUES ('0015_media_processing_pipeline');
COMMIT;
