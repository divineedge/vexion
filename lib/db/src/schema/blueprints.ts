import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { propertiesTable } from "./properties";
import { jobsTable } from "./jobs";

export const blueprintsTable = pgTable("blueprints", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("general"),
  jobId: integer("job_id").references(() => jobsTable.id),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  canvasData: jsonb("canvas_data").default("{}"),
  overageBufferPercent: real("overage_buffer_percent").notNull().default(10),
  totalEstimate: real("total_estimate"),
  /** Service-level P4P payout %. null = use tenant p4pMasterPercentage. */
  p4pPercentage: real("p4p_percentage"),
  /** Suggested parts for this blueprint: [{inventoryItemId, name, estimatedQuantity}] */
  suggestedParts: jsonb("suggested_parts").default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBlueprintSchema = createInsertSchema(blueprintsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBlueprint = z.infer<typeof insertBlueprintSchema>;
export type Blueprint = typeof blueprintsTable.$inferSelect;
