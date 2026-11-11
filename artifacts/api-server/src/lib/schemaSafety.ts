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
  `CREATE TABLE IF NOT EXISTS document_uploads (id uuid PRIMARY KEY, company_id integer NOT NULL REFERENCES tenants(id), file_url text NOT NULL, file_name text NOT NULL, file_type text NOT NULL CHECK (file_type IN ('pdf', 'image')), uploaded_at timestamptz NOT NULL DEFAULT now(), processed_status text NOT NULL DEFAULT 'pending' CHECK (processed_status IN ('pending', 'processed', 'error')))`,
  `CREATE INDEX IF NOT EXISTS document_uploads_company_idx ON document_uploads (company_id, uploaded_at DESC)`,
  `CREATE TABLE IF NOT EXISTS vendor_invoice_records (id uuid PRIMARY KEY, company_id integer NOT NULL REFERENCES tenants(id), document_id uuid NOT NULL REFERENCES document_uploads(id), vendor_id integer REFERENCES vendors(id), draft_vendor_name text, invoice_number text, invoice_date date, total_amount numeric(12, 2) NOT NULL DEFAULT 0, tax_amount numeric(12, 2) NOT NULL DEFAULT 0, shipping_amount numeric(12, 2) NOT NULL DEFAULT 0, payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'partially_paid')), vendor_confirmed boolean NOT NULL DEFAULT false, raw_ocr_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS vendor_invoice_records_company_idx ON vendor_invoice_records (company_id, invoice_date DESC)`,
  `CREATE TABLE IF NOT EXISTS vendor_invoice_line_items (id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES vendor_invoice_records(id) ON DELETE CASCADE, description text NOT NULL, quantity numeric(12, 3) NOT NULL DEFAULT 1, unit_price numeric(12, 4) NOT NULL DEFAULT 0, total_price numeric(12, 2) NOT NULL DEFAULT 0, destination_type text NOT NULL DEFAULT 'overhead' CHECK (destination_type IN ('inventory', 'bulk_fuel', 'equipment', 'job_direct_expense', 'overhead')), destination_id text, fill_date date, bbox jsonb NOT NULL DEFAULT '{}'::jsonb)`,
  `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false`,
  `ALTER TABLE bulk_fuel_tanks ADD COLUMN IF NOT EXISTS current_gallons numeric(12, 3)`,
  `ALTER TABLE bulk_fuel_tanks ADD COLUMN IF NOT EXISTS max_capacity numeric(12, 3)`,
  `ALTER TABLE bulk_fuel_tanks ADD COLUMN IF NOT EXISTS rolling_avg_cost_per_gallon numeric(12, 4)`,
  `ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reserved_for_job_id integer`,
  `CREATE TABLE IF NOT EXISTS inventory_reservations (id uuid PRIMARY KEY, company_id integer NOT NULL REFERENCES tenants(id), inventory_item_id integer NOT NULL REFERENCES inventory_items(id), job_id integer NOT NULL REFERENCES jobs(id), invoice_line_id uuid, quantity numeric(12, 3) NOT NULL, consumed_quantity numeric(12, 3) NOT NULL DEFAULT 0, unit_cost numeric(12, 4) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'reconciled')), created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS inventory_reservations_job_idx ON inventory_reservations (company_id, job_id, status)`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS budget_data jsonb`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS linear_rate real NOT NULL DEFAULT 0`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS p4p_percentage real`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'flat'`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS hourly_rate real`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS minimum_billable_minutes integer`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS pricing_matrix jsonb`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS linked_zone_type_id text`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS off_season_start text`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS off_season_end text`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS field_requirements jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE services ADD COLUMN IF NOT EXISTS payment_policy jsonb`,
  `CREATE TABLE IF NOT EXISTS matrix_pricing_rules (id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), service_id integer NOT NULL REFERENCES services(id) ON DELETE CASCADE, basis text NOT NULL DEFAULT 'area', price_rounding text NOT NULL DEFAULT 'none', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT matrix_pricing_rules_service_unique UNIQUE (service_id))`,
  `CREATE TABLE IF NOT EXISTS matrix_tiers (id serial PRIMARY KEY, rule_id integer NOT NULL REFERENCES matrix_pricing_rules(id) ON DELETE CASCADE, position integer NOT NULL, min_quantity real NOT NULL, max_quantity real, calculation_mode text NOT NULL DEFAULT 'flat', base_price real NOT NULL DEFAULT 0, unit_rate real, per_linear_ft_rate real, estimated_minutes integer, CONSTRAINT matrix_tiers_rule_position_unique UNIQUE (rule_id, position))`,
  `ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS label_pdf_url text`,
  `ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS quantity_on_hand real NOT NULL DEFAULT 0`,
  `ALTER TABLE chemical_mixtures ADD COLUMN IF NOT EXISTS tank_capacity_gallons real`,
  `ALTER TABLE chemical_mixtures ADD COLUMN IF NOT EXISTS coverage_sqft real`,
  `ALTER TABLE chemical_mixture_items ADD COLUMN IF NOT EXISTS rate_basis text NOT NULL DEFAULT 'per_gallon'`,
  `ALTER TABLE chemical_mixture_items ADD COLUMN IF NOT EXISTS rate_per_1000 real`,
  `ALTER TABLE plan_templates ADD COLUMN IF NOT EXISTS schedule_rule jsonb`,
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
