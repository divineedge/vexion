import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const LINE_CATALOG_SQL = [
  `CREATE TABLE IF NOT EXISTS line_catalog_items (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL REFERENCES tenants(id),
    description text NOT NULL,
    unit text,
    internal_cost double precision,
    unit_price double precision NOT NULL DEFAULT 0,
    markup_pct double precision NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS line_catalog_items_tenant_idx ON line_catalog_items (tenant_id)`,
];

/** Idempotent. Existing catalog rows and line-item JSON are left in place. */
export async function installLineCatalogSchema(): Promise<void> {
  for (const statement of LINE_CATALOG_SQL) {
    await db.execute(sql.raw(statement));
  }
}
