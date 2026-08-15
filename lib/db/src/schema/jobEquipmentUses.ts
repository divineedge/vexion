import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { jobsTable } from "./jobs";

/** Records how many hours a piece of equipment was used on a job. */
export const jobEquipmentUsesTable = pgTable("job_equipment_uses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  /** Name of the equipment (stored as text so it remains readable even if equipment is archived) */
  equipmentName: text("equipment_name").notNull(),
  /** FK to equipment table — nullable for backward-compat with manual entries */
  equipmentId: integer("equipment_id"),
  hoursUsed: real("hours_used").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobEquipmentUse = typeof jobEquipmentUsesTable.$inferSelect;
