import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const estimateTemplatesTable = pgTable("estimate_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  termsText: text("terms_text"),
  notes: text("notes"),
  /** Pre-filled line items including optional ones — same shape as estimates.lineItems */
  lineItems: jsonb("line_items").default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEstimateTemplateSchema = createInsertSchema(estimateTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEstimateTemplate = z.infer<typeof insertEstimateTemplateSchema>;
export type EstimateTemplate = typeof estimateTemplatesTable.$inferSelect;
