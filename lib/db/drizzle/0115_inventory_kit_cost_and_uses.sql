ALTER TABLE inventory_part_links ADD COLUMN IF NOT EXISTS cost_override double precision;

CREATE TABLE IF NOT EXISTS inventory_kit_uses (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  use_key text NOT NULL,
  inventory_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  units double precision NOT NULL,
  job_id integer,
  blueprint_id integer,
  parent_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  kit_usage jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_kit_uses_key
  ON inventory_kit_uses (tenant_id, use_key);
