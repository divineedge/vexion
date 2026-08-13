import { pgTable, text, serial, timestamp, integer, jsonb, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const invoiceTemplatesTable = pgTable("invoice_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  /** Visual layout variant applied to the public invoice page: 'clean' | 'detailed' | 'compact' */
  layout: text("layout").notNull().default("clean"),
  /** Pre-filled line items copied onto new invoices that use this template */
  lineItems: jsonb("line_items").notNull().default("[]"),
  /** Terms and conditions text shown at the bottom of invoices using this template */
  termsText: text("terms_text"),
  /** When true, a late-fee notice is shown on overdue public invoice pages */
  lateFeeEnabled: boolean("late_fee_enabled").notNull().default(false),
  /** 'percent' — percentage of total | 'flat' — fixed dollar amount */
  lateFeeType: text("late_fee_type"),
  /** Late fee value (% or $) — null when lateFeeEnabled is false */
  lateFeeAmount: real("late_fee_amount"),
  /** Number of grace-period days after the due date before the fee applies */
  lateFeeDaysGrace: integer("late_fee_days_grace").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInvoiceTemplateSchema = createInsertSchema(invoiceTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoiceTemplate = z.infer<typeof insertInvoiceTemplateSchema>;
export type InvoiceTemplate = typeof invoiceTemplatesTable.$inferSelect;
