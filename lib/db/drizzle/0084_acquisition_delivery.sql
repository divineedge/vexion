ALTER TABLE tenants ADD COLUMN IF NOT EXISTS acquisition_settings jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS acquired_by_employee_id integer REFERENCES users(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS door_hanger_visit_id integer;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS acquisition_reward_snapshot jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_share_token text;
CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_share_token ON customers(referral_share_token) WHERE referral_share_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS door_hanger_visits (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), job_id integer REFERENCES jobs(id),
 employee_id integer NOT NULL REFERENCES users(id), address text NOT NULL, lat double precision, lng double precision,
 completed_at timestamptz NOT NULL DEFAULT now(), recorded_by integer NOT NULL REFERENCES users(id),
 converted_customer_id integer REFERENCES customers(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS acquisition_rewards (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), customer_id integer NOT NULL REFERENCES customers(id),
 kind text NOT NULL CHECK(kind IN ('employee_bonus','referral_credit')), recipient_user_id integer REFERENCES users(id),
 recipient_customer_id integer REFERENCES customers(id), invoice_id integer NOT NULL REFERENCES invoices(id),
 amount numeric(14,2) NOT NULL CHECK(amount > 0), earned_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,customer_id,kind)
);
CREATE INDEX IF NOT EXISTS acquisition_rewards_payroll ON acquisition_rewards(tenant_id,recipient_user_id,earned_at);
ALTER TABLE acquisition_rewards ADD COLUMN IF NOT EXISTS payroll_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS document_deliveries (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), document_type text NOT NULL CHECK(document_type IN ('invoice','estimate')),
 document_id integer NOT NULL, channel text NOT NULL CHECK(channel IN ('email','sms')), recipient text NOT NULL,
 subject text, status text NOT NULL DEFAULT 'sending', provider text, provider_message_id text, error text,
 open_token text NOT NULL UNIQUE, open_count integer NOT NULL DEFAULT 0, first_opened_at timestamptz, last_opened_at timestamptz,
 delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS document_deliveries_history ON document_deliveries(tenant_id,document_type,document_id,id DESC);
ALTER TABLE door_hanger_visits ADD COLUMN IF NOT EXISTS share_token text NOT NULL DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS door_hanger_share_token ON door_hanger_visits(share_token);
CREATE UNIQUE INDEX IF NOT EXISTS customer_door_hanger_attribution ON customers(door_hanger_visit_id) WHERE door_hanger_visit_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public_quote_requests (
 tenant_id integer NOT NULL REFERENCES tenants(id), request_id text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,request_id)
);
ALTER TABLE public_quote_requests ADD COLUMN IF NOT EXISTS request_hash text;
CREATE TABLE IF NOT EXISTS document_delivery_verifications (
 id serial PRIMARY KEY, delivery_id integer NOT NULL REFERENCES document_deliveries(id),
 tenant_id integer NOT NULL REFERENCES tenants(id), actor_id integer NOT NULL REFERENCES users(id),
 resolution text NOT NULL, evidence text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS provider_receipt jsonb;
ALTER TABLE document_deliveries ADD COLUMN IF NOT EXISTS provider_checked_at timestamptz;
CREATE TABLE IF NOT EXISTS document_delivery_opens (
 id serial PRIMARY KEY, delivery_id integer NOT NULL REFERENCES document_deliveries(id), opened_at timestamptz NOT NULL DEFAULT now()
);
