import { readFileSync } from "node:fs";
import { pool } from "@workspace/db";

/** Same statements as lib/db/drizzle/0118_daily_route_board.sql. Inlined so the server bundle can apply them. */
export const DAILY_ROUTE_SQL = `ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id integer REFERENCES users(id);
ALTER TABLE crews ADD COLUMN IF NOT EXISTS shift_start_minutes integer NOT NULL DEFAULT 420;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_time_window boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS route_payout double precision;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_callback boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS callback_deduction double precision NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_minutes integer;

CREATE TABLE IF NOT EXISTS drive_legs (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  crew_id integer REFERENCES crews(id) ON DELETE CASCADE,
  route_date text NOT NULL,
  sequence integer NOT NULL,
  from_job_id integer REFERENCES jobs(id) ON DELETE SET NULL,
  to_job_id integer REFERENCES jobs(id) ON DELETE SET NULL,
  duration_minutes integer NOT NULL DEFAULT 0,
  distance_miles double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drive_legs_crew_date_idx ON drive_legs (tenant_id, crew_id, route_date);
CREATE INDEX IF NOT EXISTS jobs_tenant_crew_scheduled_idx ON jobs (tenant_id, crew_id, scheduled_at);`;

function statements(sql: string): string[] {
  return sql.split(";").map(part => part.trim()).filter(Boolean);
}

/** Applies the daily-route migration. Every statement is additive. */
export async function installDailyRouteSchema(): Promise<void> {
  let sql = DAILY_ROUTE_SQL;
  try {
    sql = readFileSync(new URL("../../../../lib/db/drizzle/0118_daily_route_board.sql", import.meta.url), "utf8");
  } catch {
    sql = DAILY_ROUTE_SQL;
  }
  for (const statement of statements(sql)) {
    await pool.query(statement);
  }
}
