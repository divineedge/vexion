import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { servicesTable } from "./services";

export const recurringInvoiceTemplatesTable = pgTable("recurring_invoice_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  /**
   * Nullable so a template can instead (or additionally) be scoped by serviceId.
   * At least one of customerId/serviceId must be set (enforced at the route layer).
   */
  customerId: integer("customer_id").references(() => customersTable.id),
  /** Optional scope: only bill for this service. When customerId is also null, one invoice is generated per customer who has qualifying completed work. */
  serviceId: integer("service_id").references(() => servicesTable.id),
  name: text("name").notNull(),
  /** Line items JSONB: [{description, quantity, unitPrice, total}]. Only used when billingMode is 'static'. */
  lineItems: jsonb("line_items").notNull().default("[]"),
  /**
   * 'static' — use the hand-entered lineItems above (legacy behavior).
   * 'completed_work' — build line items from the customer's/service's jobs completed since the last billing run.
   */
  billingMode: text("billing_mode").notNull().default("static"),
  /** Day of month (1-28) or day of week (0=Sun..6=Sat); ignored for 'daily' cycles */
  billingCycleDay: integer("billing_cycle_day").notNull().default(1),
  /** 'daily' | 'weekly' | 'monthly' | 'bi_monthly' */
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
