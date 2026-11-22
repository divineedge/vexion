import { pgTable, text, serial, timestamp, integer, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

/** Saved Custom / Pass-Through defaults. Selecting one fills an estimate or invoice line. */
export const lineCatalogItemsTable = pgTable("line_catalog_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  description: text("description").notNull(),
  unit: text("unit"),
  internalCost: doublePrecision("internal_cost"),
  unitPrice: doublePrecision("unit_price").notNull().default(0),
  markupPct: doublePrecision("markup_pct").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("line_catalog_items_tenant_idx").on(t.tenantId),
]);

export const insertLineCatalogItemSchema = createInsertSchema(lineCatalogItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLineCatalogItem = z.infer<typeof insertLineCatalogItemSchema>;
export type LineCatalogItem = typeof lineCatalogItemsTable.$inferSelect;
