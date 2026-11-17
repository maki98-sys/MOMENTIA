-- MOMENTIA operational, billing, retention and ownership invariants.
CREATE TABLE billing_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE,
 name varchar(100) NOT NULL,
 price_minor_units bigint NOT NULL CHECK (price_minor_units >= 0),
 currency char(3) NOT NULL,
 billing_interval text NOT NULL CHECK (billing_interval IN ('one_time','month','year')),
 entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 plan_id uuid NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT,
 provider text NOT NULL,
 provider_subscription_ref text,
 status text NOT NULL CHECK (status IN ('trialing','active','past_due','paused','cancelled','expired')),
 current_period_start timestamptz,
 current_period_end timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 cancelled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start),
 UNIQUE(provider, provider_subscription_ref)
);
CREATE INDEX subscriptions_user_status_idx ON subscriptions(user_id,status);

CREATE TABLE payment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
 provider text NOT NULL,
 provider_event_id text NOT NULL,
 event_type text NOT NULL,
 amount_minor_units bigint CHECK (amount_minor_units IS NULL OR amount_minor_units >= 0),
 currency char(3),
 processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processing','processed','failed','ignored')),
 payload_digest char(64),
 received_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 UNIQUE(provider,provider_event_id)
);
CREATE INDEX payment_events_processing_idx ON payment_events(processing_status,received_at);

CREATE TABLE user_data_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_type text NOT NULL CHECK (request_type IN ('export','delete')),
 status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','verified','processing','completed','rejected','failed')),
 result_storage_key text,
 result_expires_at timestamptz,
 failure_code text,
 requested_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CHECK (result_expires_at IS NULL OR result_storage_key IS NOT NULL)
);
CREATE INDEX user_data_requests_queue_idx ON user_data_requests(status,requested_at);

CREATE TABLE retention_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope text NOT NULL UNIQUE,
 retention_days integer CHECK (retention_days IS NULL OR retention_days >= 0),
 action text NOT NULL CHECK (action IN ('delete','anonymize','archive')),
 policy_version integer NOT NULL CHECK (policy_version > 0),
 enabled boolean NOT NULL DEFAULT false,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (enabled = false OR approved_at IS NOT NULL)
);

CREATE TABLE audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL,
 target_type text NOT NULL,
 target_id uuid,
 request_id text,
 ip_fingerprint text,
 user_agent_fingerprint text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_time_idx ON audit_logs(actor_id,occurred_at DESC);
CREATE INDEX audit_logs_subject_time_idx ON audit_logs(subject_user_id,occurred_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs(target_type,target_id,occurred_at DESC);

CREATE TABLE moderation_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid NOT NULL UNIQUE REFERENCES user_reports(id) ON DELETE RESTRICT,
 assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','actioned','dismissed')),
 decision text,
 internal_notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);
CREATE INDEX moderation_cases_queue_idx ON moderation_cases(status,created_at);

CREATE TABLE media_access_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
 subject_type text NOT NULL CHECK (subject_type IN ('user','space')),
 subject_id uuid NOT NULL,
 permission text NOT NULL CHECK (permission IN ('view','download')),
 expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(media_asset_id,subject_type,subject_id,permission)
);
CREATE INDEX media_access_grants_subject_idx ON media_access_grants(subject_type,subject_id,permission);

CREATE TABLE support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 subject varchar(160) NOT NULL,
 message text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending_user','resolved','closed')),
 assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);
CREATE INDEX support_tickets_queue_idx ON support_tickets(status,created_at);

-- Every active space must have its owner as its one active owner membership.
CREATE UNIQUE INDEX space_single_active_owner_uq
 ON space_memberships(space_id) WHERE role = 'owner' AND state = 'active';

CREATE FUNCTION assert_space_owner_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_space uuid; target_owner uuid; target_status text; owner_count integer;
BEGIN
 IF TG_TABLE_NAME = 'spaces' THEN
  target_space := COALESCE(NEW.id,OLD.id);
 ELSE
  target_space := COALESCE(NEW.space_id,OLD.space_id);
 END IF;
 SELECT owner_id,status INTO target_owner,target_status
  FROM spaces WHERE id = target_space FOR UPDATE;
 IF target_owner IS NULL OR target_status <> 'active' THEN RETURN NULL; END IF;
 SELECT count(*) INTO owner_count FROM space_memberships
  WHERE space_id = target_space AND user_id = target_owner
    AND role = 'owner' AND state = 'active';
 IF owner_count <> 1 THEN
  RAISE EXCEPTION 'active space % must have its owner as one active owner membership',target_space
   USING ERRCODE = 'check_violation';
 END IF;
 RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER spaces_owner_membership_guard
AFTER INSERT OR UPDATE ON spaces DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_space_owner_membership();
CREATE CONSTRAINT TRIGGER memberships_owner_membership_guard
AFTER INSERT OR UPDATE OR DELETE ON space_memberships
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_space_owner_membership();

CREATE TRIGGER billing_plans_updated_at BEFORE UPDATE ON billing_plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER moderation_cases_updated_at BEFORE UPDATE ON moderation_cases
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON support_tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
