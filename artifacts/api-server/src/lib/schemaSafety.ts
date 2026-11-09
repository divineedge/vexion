import { getTableColumns } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, pool, tenantsTable } from "@workspace/db";
import { logger } from "./logger";
import { isMissingColumnError } from "./settingsFallback";

export { isMissingColumnError };

/** Additive statements only. Each one keeps every existing row and settings key. */
const ADDITIVE_SETTINGS_SQL = [
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS estimate_reminder_settings jsonb DEFAULT '{"enabled":false,"rules":[]}'::jsonb`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_reminders_mode text NOT NULL DEFAULT 'enabled'`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS excluded_reminder_service_ids integer[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_card_on_acceptance boolean NOT NULL DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_prepayment_on_acceptance boolean NOT NULL DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS chemical_record_config jsonb DEFAULT '{}'::jsonb`,
  `ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS safety_notes text`,
  `ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS humidity real`,
  `ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS precipitation_chance real`,
  `ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS rain_status text`,
  `ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS dilution_rate text`,
  `ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS custom_field_values jsonb DEFAULT '{}'::jsonb`,
  `ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS clock_in_at timestamptz`,
  `ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS clock_out_at timestamptz`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pre_trip_enabled boolean NOT NULL DEFAULT true`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS post_trip_enabled boolean NOT NULL DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS prompt_equipment_hours boolean NOT NULL DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS prompt_fuel_fillup boolean NOT NULL DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS equipment_category_thresholds jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `CREATE TABLE IF NOT EXISTS service_categories (id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS service_categories_tenant_name ON service_categories (tenant_id, lower(name))`,
];

export async function installAdditiveSettingsSchema(): Promise<void> {
  for (const statement of ADDITIVE_SETTINGS_SQL) {
    try {
      await pool.query(statement);
    } catch (error) {
      logger.error({ err: error, statement }, "Additive settings migration failed. Existing tenant rows were not rewritten.");
    }
  }
}

export async function runStartupSchemaStep(name: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (error) {
    logger.error({ err: error, step: name }, "Startup schema step failed. Existing customers, properties, schedules, services, inventory, and settings were left in place.");
  }
}

/** Reads one tenant. A column the database has not added yet is filled with null instead of failing the request. */
export async function selectTenantById(tenantId: number): Promise<typeof tenantsTable.$inferSelect | null> {
  try {
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    return tenant ?? null;
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    logger.error({ err: error, tenantId }, "Tenant select referenced a column that is not in the database yet. Stored columns were kept and the missing ones defaulted.");
    const result = await pool.query<{ row: Record<string, unknown> }>("SELECT to_jsonb(tenants) AS row FROM tenants WHERE id = $1", [tenantId]);
    const stored = result.rows[0]?.row;
    if (!stored || typeof stored !== "object") return null;
    const row: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(getTableColumns(tenantsTable))) {
      row[key] = Object.prototype.hasOwnProperty.call(stored, column.name) ? stored[column.name] : null;
    }
    return row as typeof tenantsTable.$inferSelect;
  }
}
