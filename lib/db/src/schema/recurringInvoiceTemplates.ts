import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";

export const recurringInvoiceTemplatesTable = pgTable("recurring_invoice_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  name: text("name").notNull(),
  /** Line items JSONB: [{description, quantity, unitPrice, total}] */
  lineItems: jsonb("line_items").notNull().default("[]"),
  /** Day of month (1-28) or day of week (0=Sun..6=Sat) depending on billingCycleType */
  billingCycleDay: integer("billing_cycle_day").notNull().default(1),
  /** 'monthly' | 'weekly' */
  billingCycleType: text("billing_cycle_type").notNull().default("monthly"),
  /** Next date to run billing (stored as date string yyyy-mm-dd for day-precision) */
  nextBillingDate: text("next_billing_date").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRecurringInvoiceTemplateSchema = createInsertSchema(recurringInvoiceTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecurringInvoiceTemplate = z.infer<typeof insertRecurringInvoiceTemplateSchema>;
export type RecurringInvoiceTemplate = typeof recurringInvoiceTemplatesTable.$inferSelect;
