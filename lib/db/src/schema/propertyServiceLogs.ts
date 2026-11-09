import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { propertiesTable } from "./properties";

/** Land-level service dates kept when a property changes owners. Amounts and customer notes are not stored. */
export const propertyServiceLogsTable = pgTable("property_service_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  serviceId: integer("service_id"),
  serviceName: text("service_name").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull(),
  sourceJobId: integer("source_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("property_service_logs_source_job").on(table.propertyId, table.sourceJobId),
]);

export type PropertyServiceLog = typeof propertyServiceLogsTable.$inferSelect;
