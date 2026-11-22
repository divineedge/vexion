-- Saved pass-through defaults. Existing estimate and invoice rows are not rewritten.
CREATE TABLE IF NOT EXISTS line_catalog_items (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  description text NOT NULL,
  unit text,
  internal_cost double precision,
  unit_price double precision NOT NULL DEFAULT 0,
  markup_pct double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS line_catalog_items_tenant_idx
  ON line_catalog_items (tenant_id);

COMMENT ON COLUMN estimates.line_items IS 'Line item JSON array. Existing objects stay as stored. A custom pass-through line may add catalogId, markup, unit, and internalCost. A kit line uses kind kit and an inventory item id. A multi-part line stores components as inventory item id and quantity. Drafting an estimate or invoice does not deduct stock.';
COMMENT ON COLUMN invoices.line_items IS 'Line item JSON array. Existing objects stay as stored. A custom pass-through line may add catalogId, markup, unit, and internalCost. A kit line uses kind kit and an inventory item id. A multi-part line stores components as inventory item id and quantity. Saving an invoice does not deduct stock.';
