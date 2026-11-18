-- Durable, retryable media processing queue. Workers claim jobs with SKIP LOCKED.
BEGIN;

CREATE TABLE media_processing_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 media_asset_id uuid NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'queued'
   CHECK (status IN ('queued','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
 available_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 locked_by text,
 last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status = 'processing' AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
     OR (status <> 'processing' AND locked_at IS NULL AND locked_by IS NULL))
);

CREATE INDEX media_processing_jobs_ready_idx
 ON media_processing_jobs(available_at, created_at)
 WHERE status = 'queued';
CREATE INDEX media_processing_jobs_stale_idx
 ON media_processing_jobs(locked_at)
 WHERE status = 'processing';

INSERT INTO schema_migrations(version) VALUES ('0005_media_processing_queue');
COMMIT;
