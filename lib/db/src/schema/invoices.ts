import { pgTable, text, serial, timestamp, integer, real, jsonb, uniqueIndex, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { jobsTable } from "./jobs";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  invoiceNumber: text("invoice_number").notNull(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  jobId: integer("job_id").references(() => jobsTable.id),
  /** Set when this invoice bills a customer_plans period (one invoice per cycle, not per job). */
  planId: integer("plan_id"),
  status: text("status").notNull().default("draft"),
  subtotal: real("subtotal").notNull().default(0),
  tax: real("tax").notNull().default(0),
  total: real("total").notNull().default(0),
  dueDate: timestamp("due_date", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  lineItems: jsonb("line_items").default("[]"),
  stripePaymentUrl: text("stripe_payment_url"),
  /** FK to recurring_invoice_templates when this invoice was auto-generated */
  generatedFromTemplateId: integer("generated_from_template_id"),
  /**
   * Calendar date (UTC) of the billing cycle that produced this invoice.
   * Set to today when the scheduler auto-generates from a recurring template.
   * Combined with generatedFromTemplateId and customerId it forms a unique
   * key that prevents the scheduler from billing the same template+customer
   * twice on the same day.
   */
  billingDate: date("billing_date"),
  /** Lob letter id once a "Print & Mail" request has been sent */
  lobLetterId: text("lob_letter_id"),
  /** Lob delivery status: 'requested' | 'mailed' | 'delivered' | 'returned' | 'failed' */
  lobStatus: text("lob_status"),
  /** Token for the public no-login invoice view page, generated when the invoice is first sent */
  publicToken: text("public_token").unique(),
  /** Array of offsetDays values (from tenant.paymentReminderSchedule) already sent for this invoice */
  paymentRemindersSent: jsonb("payment_reminders_sent").default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  /**
   * Unique index preventing the billing scheduler from inserting a second invoice
   * for the same recurring template + customer on the same billing date.
   * billingDate is set to today (UTC) by the scheduler on every auto-generated
   * invoice. This is a partial index — only rows where generatedFromTemplateId
   * is not null participate, so manually created invoices are never affected.
   */
  uniqueIndex("invoices_template_customer_billing_date_uidx")
    .on(table.generatedFromTemplateId, table.customerId, table.billingDate)
    .where(sql`generated_from_template_id IS NOT NULL AND billing_date IS NOT NULL`),
  /**
   * Unique index ensuring at most one invoice is linked to any given job.
   *
   * Without this constraint the P&L and job-profitability reports would
   * silently double-count revenue: both queries do a LEFT JOIN from jobs to
   * invoices on invoices.job_id = jobs.id, so two invoice rows sharing the
   * same job_id would produce two result rows for that job — doubling the
   * reported revenue, parts cost, and labor cost for it with no error or
   * warning.
   *
   * Plan-cycle invoices legitimately have job_id = NULL, so this is a
   * partial index that only covers non-null job_id values.
   */
  uniqueIndex("invoices_job_id_uidx")
    .on(table.jobId)
    .where(sql`job_id IS NOT NULL`),
]);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
