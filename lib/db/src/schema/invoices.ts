import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
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
  /** Lob letter id once a "Print & Mail" request has been sent */
  lobLetterId: text("lob_letter_id"),
  /** Lob delivery status: 'requested' | 'mailed' | 'delivered' | 'returned' | 'failed' */
  lobStatus: text("lob_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
