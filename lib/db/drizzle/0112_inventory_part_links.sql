CREATE TABLE IF NOT EXISTS inventory_part_links (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  parent_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  parent_quantity double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_links_parent
  ON inventory_part_links (tenant_id, parent_item_id);

CREATE TABLE IF NOT EXISTS inventory_part_link_components (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  link_id integer NOT NULL REFERENCES inventory_part_links(id) ON DELETE CASCADE,
  inventory_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity double precision NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_link_components_item
  ON inventory_part_link_components (link_id, inventory_item_id);
