-- Hide a customer from the default list without archiving their jobs, invoices, or blueprints.
-- Existing rows stay visible: hidden_at is null until someone hides that customer.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS merged_into_customer_id integer REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS customers_tenant_hidden_idx ON customers (tenant_id) WHERE hidden_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_merge_records (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  source_id integer NOT NULL REFERENCES customers(id),
  primary_id integer NOT NULL REFERENCES customers(id),
  actor_id integer NOT NULL REFERENCES users(id),
  source_snapshot jsonb NOT NULL,
  primary_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_merge_records_tenant_id_source_id_key
  ON customer_merge_records (tenant_id, source_id);

-- Opening a customer loads payment standing from this table. It existed only in
-- the Drizzle schema, so a database built from these SQL files rejected
-- GET /customers/:id and the office page showed "Customer not found."
CREATE TABLE IF NOT EXISTS stop_service_flags (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  invoice_id integer NOT NULL REFERENCES invoices(id),
  days_overdue integer NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  resolved_by integer,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stop_service_flags_customer_idx ON stop_service_flags (tenant_id, customer_id);
