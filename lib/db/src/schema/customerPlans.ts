import { pgTable, text, serial, timestamp, integer, real, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { propertiesTable } from "./properties";
import { planTemplatesTable } from "./planTemplates";

/**
 * A plan sold to a specific customer/property, instantiated from a plan_templates row.
 * Drives automated job scheduling (via serviceState) and per-cycle billing.
 */
export const customerPlansTable = pgTable("customer_plans", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  templateId: integer("template_id").notNull().references(() => planTemplatesTable.id),
  templateName: text("template_name").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  /** End of the CURRENT billing period; advances forward on renewal. */
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  customCycleDays: integer("custom_cycle_days"),
  billingPrice: real("billing_price").notNull().default(0),
  autoRenew: boolean("auto_renew").notNull().default(true),
  /** 'active' | 'paused' | 'cancelled' | 'pending_renewal' */
  status: text("status").notNull().default("active"),
  /** Date the next invoice for this plan should be generated (yyyy-mm-dd). */
  nextBillingDate: text("next_billing_date").notNull(),
  lastBilledAt: timestamp("last_billed_at", { withTimezone: true }),
  /**
   * Per-service scheduling cursor, seeded from the template at sale time and
   * advanced by the plan job-generation worker as visits are scheduled:
   * [{ serviceId, serviceName, frequencyDays, lastScheduledAt: string | null }]
   */
  serviceState: jsonb("service_state").notNull().default("[]"),
  /** Days before nextBillingDate a renewal reminder is sent when autoRenew is off. */
  renewalReminderDaysBefore: integer("renewal_reminder_days_before").notNull().default(14),
  renewalReminderSentAt: timestamp("renewal_reminder_sent_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerPlanSchema = createInsertSchema(customerPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomerPlan = z.infer<typeof insertCustomerPlanSchema>;
export type CustomerPlan = typeof customerPlansTable.$inferSelect;
