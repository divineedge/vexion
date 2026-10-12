import { pgTable, serial, integer, text, timestamp, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";
import { invoicesTable } from "./invoices";

/** Append-only money movements. Positive = received/released; negative = reserved on an invoice. */
export const customerCreditsTable = pgTable("customer_credits", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  reference: text("reference").notNull(),
  requestId: text("request_id").notNull(),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("customer_credits_request_unique").on(t.tenantId, t.requestId)]);
