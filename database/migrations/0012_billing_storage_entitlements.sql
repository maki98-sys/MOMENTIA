BEGIN;
CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  display_name varchar(80) NOT NULL,
  monthly_price_minor integer NOT NULL DEFAULT 0 CHECK (monthly_price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  storage_quota_bytes bigint NOT NULL CHECK (storage_quota_bytes > 0),
  max_upload_bytes bigint NOT NULL CHECK (max_upload_bytes > 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('trialing','active','past_due','cancelled','expired')),
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);
CREATE UNIQUE INDEX user_subscriptions_provider_id_uq
  ON user_subscriptions(provider,provider_subscription_id)
  WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL;
CREATE INDEX user_subscriptions_user_status_idx
  ON user_subscriptions(user_id,status,current_period_end DESC);
CREATE UNIQUE INDEX user_subscriptions_one_current_idx
  ON user_subscriptions(user_id)
  WHERE status IN ('trialing','active','past_due');
CREATE TABLE billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processing','processed','failed','ignored')),
  processing_error varchar(1000),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider,provider_event_id)
);
CREATE INDEX billing_webhook_events_pending_idx
  ON billing_webhook_events(received_at)
  WHERE processing_status IN ('received','failed');
CREATE TABLE storage_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('uploaded','deleted','restored','adjustment')),
  bytes_delta bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX storage_usage_user_time_idx ON storage_usage_events(user_id,created_at DESC);
INSERT INTO subscription_plans(code,display_name,monthly_price_minor,storage_quota_bytes,max_upload_bytes,features)
VALUES
 ('free','Gratis',0,2147483648,52428800,'{"events":true,"circles":true,"couple_journal":true,"social_audio":true,"max_spaces":5}'::jsonb),
 ('plus','Plus',499,107374182400,104857600,'{"events":true,"circles":true,"couple_journal":true,"social_audio":true,"max_spaces":30,"original_quality":true}'::jsonb),
 ('family','Familia',999,536870912000,209715200,'{"events":true,"circles":true,"couple_journal":true,"social_audio":true,"max_spaces":100,"original_quality":true,"family_sharing":true}'::jsonb)
ON CONFLICT(code) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES ('0012_billing_storage_entitlements');
COMMIT;
