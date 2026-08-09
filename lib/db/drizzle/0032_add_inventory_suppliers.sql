-- Add inventory_suppliers table and link inventory_items to it
-- idempotent: safe to run multiple times

CREATE TABLE IF NOT EXISTS inventory_suppliers (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  contact text,
  account_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS supplier_id integer REFERENCES inventory_suppliers(id) ON DELETE SET NULL;
