import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/** Company-wide dashboard choices; installed additively before the API serves requests. */
export const tenantKpiSettingsTable = pgTable("tenant_kpi_settings", {
  tenantId: integer("tenant_id").primaryKey().references(() => tenantsTable.id),
  settings: jsonb("settings").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
