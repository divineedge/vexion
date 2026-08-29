CREATE TABLE IF NOT EXISTS job_requests (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  requester_id integer NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending',
  customer_id integer REFERENCES customers(id),
  property_id integer REFERENCES properties(id),
  service_id integer,
  requested_start_date timestamp with time zone NOT NULL,
  requested_end_date timestamp with time zone,
  notes text,
  admin_response text,
  reviewed_by_id integer REFERENCES users(id),
  reviewed_at timestamp with time zone,
  approved_job_id integer,
  idempotency_key text NOT NULL,
  amendment_idempotency_key text,
  review_idempotency_key text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_requests_tenant_requester_idempotency_key_unique
  ON job_requests (tenant_id, requester_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS job_requests_tenant_review_idempotency_key_unique
  ON job_requests (tenant_id, review_idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS job_requests_tenant_requester_amendment_idempotency_key_unique
  ON job_requests (tenant_id, requester_id, amendment_idempotency_key);