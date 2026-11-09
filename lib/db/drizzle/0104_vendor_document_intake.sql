CREATE TABLE IF NOT EXISTS document_uploads (
  id uuid PRIMARY KEY,
  company_id integer NOT NULL REFERENCES tenants(id),
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('pdf', 'image')),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  processed_status text NOT NULL DEFAULT 'pending' CHECK (processed_status IN ('pending', 'processed', 'error'))
);
CREATE INDEX IF NOT EXISTS document_uploads_company_idx ON document_uploads (company_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS vendor_invoice_records (
  id uuid PRIMARY KEY,
  company_id integer NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES document_uploads(id),
  vendor_id integer REFERENCES vendors(id),
  draft_vendor_name text,
  invoice_number text,
  invoice_date date,
  total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  shipping_amount numeric(12, 2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'partially_paid')),
  vendor_confirmed boolean NOT NULL DEFAULT false,
  raw_ocr_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_invoice_records_company_idx ON vendor_invoice_records (company_id, invoice_date DESC);

CREATE TABLE IF NOT EXISTS vendor_invoice_line_items (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES vendor_invoice_records(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(12, 3) NOT NULL DEFAULT 1,
  unit_price numeric(12, 4) NOT NULL DEFAULT 0,
  total_price numeric(12, 2) NOT NULL DEFAULT 0,
  destination_type text NOT NULL DEFAULT 'overhead' CHECK (destination_type IN ('inventory', 'bulk_fuel', 'equipment', 'job_direct_expense', 'overhead')),
  destination_id text,
  fill_date date,
  bbox jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

ALTER TABLE bulk_fuel_tanks ADD COLUMN IF NOT EXISTS current_gallons numeric(12, 3);
ALTER TABLE bulk_fuel_tanks ADD COLUMN IF NOT EXISTS max_capacity numeric(12, 3);
ALTER TABLE bulk_fuel_tanks ADD COLUMN IF NOT EXISTS rolling_avg_cost_per_gallon numeric(12, 4);

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reserved_for_job_id integer;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY,
  company_id integer NOT NULL REFERENCES tenants(id),
  inventory_item_id integer NOT NULL REFERENCES inventory_items(id),
  job_id integer NOT NULL REFERENCES jobs(id),
  invoice_line_id uuid,
  quantity numeric(12, 3) NOT NULL,
  consumed_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  unit_cost numeric(12, 4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'reconciled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_reservations_job_idx ON inventory_reservations (company_id, job_id, status);
