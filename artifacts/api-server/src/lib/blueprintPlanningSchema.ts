import { readFileSync } from "node:fs";
import { pool } from "@workspace/db";

/** Same statements as lib/db/drizzle/0116_blueprint_planning.sql. Kept inline so the server bundle can apply them. */
export const BLUEPRINT_PLANNING_MIGRATION = `CREATE TABLE IF NOT EXISTS blueprint_planning_settings (
  tenant_id integer PRIMARY KEY REFERENCES tenants(id),
  sprinkler_min_spacing_ft double precision,
  sprinkler_max_spacing_ft double precision,
  tons_per_yard double precision,
  yards_per_truck_load double precision,
  buffer_percent double precision NOT NULL DEFAULT 10,
  zone_exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blueprint_passthrough_defaults (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  unit text,
  unit_price double precision NOT NULL DEFAULT 0,
  internal_cost double precision,
  available_for_blueprint boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blueprint_catalog_availability (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  source_kind text NOT NULL,
  source_id integer NOT NULL,
  available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS blueprint_catalog_availability_source
  ON blueprint_catalog_availability (tenant_id, source_kind, source_id);

CREATE TABLE IF NOT EXISTS blueprint_catalog_links (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  role_key text NOT NULL,
  source_kind text NOT NULL,
  source_id integer NOT NULL,
  customer_label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS blueprint_catalog_links_source
  ON blueprint_catalog_links (tenant_id, role_key, source_kind, source_id);

CREATE TABLE IF NOT EXISTS blueprint_plan_versions (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  blueprint_id integer NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  total double precision,
  estimate_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS blueprint_plan_versions_blueprint_idx
  ON blueprint_plan_versions (tenant_id, blueprint_id);

ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS planning_inputs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS chosen_plan_version_id integer;
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS planning_locked boolean NOT NULL DEFAULT false;
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS planning_locked_reason text;
`;

export function blueprintPlanningMigrationSql(): string {
  return BLUEPRINT_PLANNING_MIGRATION;
}

export function drizzleMigrationMatchesInlineSql(): boolean {
  const file = readFileSync(new URL("../../../../lib/db/drizzle/0116_blueprint_planning.sql", import.meta.url), "utf8");
  const normalize = (sql: string) => sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
  return normalize(file) === normalize(BLUEPRINT_PLANNING_MIGRATION);
}

export const BLUEPRINT_HEAD_RULES_MIGRATION = `ALTER TABLE blueprint_planning_settings ADD COLUMN IF NOT EXISTS head_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS planning_rules jsonb;
ALTER TABLE blueprint_catalog_links ADD COLUMN IF NOT EXISTS head_type text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS nozzle text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS throw_ft double precision;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS arc_degrees double precision;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pattern text;
`;

export async function installBlueprintPlanningSchema(): Promise<void> {
  await pool.query(BLUEPRINT_PLANNING_MIGRATION);
  await pool.query(BLUEPRINT_HEAD_RULES_MIGRATION);
}
