import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

/**
 * Itemized shrinkage report lines, generated when a Warehouse Inventory Count
 * task item's counted stock doesn't match the database's expected stock level.
 * `countEventId` groups all lines produced by a single count submission
 * (currently the task_bundle_completions.id that produced the count).
 */
export const shrinkageReportsTable = pgTable("shrinkage_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  countEventId: text("count_event_id").notNull(),
  taskBundleCompletionId: integer("task_bundle_completion_id"),
  inventoryItemId: integer("inventory_item_id").notNull(),
  itemName: text("item_name").notNull(),
  sku: text("sku").notNull(),
  expectedStock: integer("expected_stock").notNull(),
  actualCount: integer("actual_count").notNull(),
  variance: integer("variance").notNull(),
  unitCost: real("unit_cost").notNull().default(0),
  totalLoss: real("total_loss").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertShrinkageReportSchema = createInsertSchema(shrinkageReportsTable).omit({ id: true, createdAt: true });
export type InsertShrinkageReport = z.infer<typeof insertShrinkageReportSchema>;
export type ShrinkageReport = typeof shrinkageReportsTable.$inferSelect;
