BEGIN;
ALTER TABLE public.account_deletion_requests
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN processing_worker_id text,
  ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0 CHECK (processing_attempts>=0),
  ADD COLUMN last_error_code varchar(120);

-- 0027 created this index with only scheduled_for. Replace it rather than
-- using IF NOT EXISTS, which would silently preserve the outdated definition.
DROP INDEX IF EXISTS public.account_deletion_due_idx;
CREATE INDEX account_deletion_due_idx
  ON public.account_deletion_requests(scheduled_for,requested_at)
  WHERE status='pending';

CREATE INDEX account_deletion_processing_idx
  ON public.account_deletion_requests(processing_started_at)
  WHERE status='pending' AND processing_started_at IS NOT NULL;

INSERT INTO public.schema_migrations(version) VALUES ('0036_account_deletion_worker_leases')
ON CONFLICT(version) DO NOTHING;
COMMIT;
