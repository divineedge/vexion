ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_applied real NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS customer_credits (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  amount numeric(14,2) NOT NULL,
  kind text NOT NULL,
  reference text NOT NULL,
  request_id text NOT NULL,
  invoice_id integer REFERENCES invoices(id),
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_credits_request_unique ON customer_credits(tenant_id, request_id);
