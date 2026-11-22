BEGIN;
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS last_provider_event_at timestamptz;

CREATE INDEX IF NOT EXISTS user_subscriptions_provider_event_order_idx
  ON public.user_subscriptions(provider, provider_subscription_id, last_provider_event_at DESC)
  WHERE provider_subscription_id IS NOT NULL;

INSERT INTO public.schema_migrations(version)
VALUES ('0056_subscription_event_ordering')
ON CONFLICT(version) DO NOTHING;
COMMIT;
