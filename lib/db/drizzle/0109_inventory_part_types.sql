CREATE TABLE IF NOT EXISTS inventory_part_types (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_types_tenant_name
  ON inventory_part_types (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS inventory_part_sizes (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  type_id integer NOT NULL REFERENCES inventory_part_types(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_sizes_type_name
  ON inventory_part_sizes (type_id, lower(name));

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS type_id integer REFERENCES inventory_part_types(id) ON DELETE SET NULL;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS size_id integer REFERENCES inventory_part_sizes(id) ON DELETE SET NULL;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inventory_group_by text NOT NULL DEFAULT 'type';
