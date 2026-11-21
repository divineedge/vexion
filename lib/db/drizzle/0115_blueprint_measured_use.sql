ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS length_amount double precision;
ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS length_unit text;

CREATE TABLE IF NOT EXISTS blueprint_inventory_uses (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  blueprint_id integer NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
  inventory_item_id integer NOT NULL REFERENCES inventory_items(id),
  amount double precision NOT NULL,
  unit text NOT NULL,
  deducted_quantity double precision NOT NULL,
  deducted_unit text NOT NULL,
  element_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blueprint_inventory_uses_blueprint_idx
  ON blueprint_inventory_uses (tenant_id, blueprint_id);
