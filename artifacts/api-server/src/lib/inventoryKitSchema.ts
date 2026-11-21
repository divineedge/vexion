import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const INVENTORY_KIT_SQL = [
  `CREATE TABLE IF NOT EXISTS inventory_part_links (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL REFERENCES tenants(id),
    parent_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    parent_quantity double precision NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_links_parent
    ON inventory_part_links (tenant_id, parent_item_id)`,
  `CREATE TABLE IF NOT EXISTS inventory_part_link_components (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL REFERENCES tenants(id),
    link_id integer NOT NULL REFERENCES inventory_part_links(id) ON DELETE CASCADE,
    inventory_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    quantity double precision NOT NULL,
    sort_order integer NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_link_components_item
    ON inventory_part_link_components (link_id, inventory_item_id)`,
  `ALTER TABLE inventory_part_links ADD COLUMN IF NOT EXISTS cost_override double precision`,
  `CREATE TABLE IF NOT EXISTS inventory_kit_uses (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inventory_kit_uses_key
    ON inventory_kit_uses (tenant_id, use_key)`,
];

/** Idempotent. Safe to run before a job use so linked parts exist even if startup skipped a step. */
export async function installInventoryKitSchema(): Promise<void> {
  for (const statement of INVENTORY_KIT_SQL) {
    await db.execute(sql.raw(statement));
  }
}
