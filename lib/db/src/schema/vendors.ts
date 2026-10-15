import { pgTable, text, serial, timestamp, integer, real, boolean, index, jsonb, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// ─── Vendors ────────────────────────────────────────────────────────────────

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  category: text("category"),
  contact: text("contact"),
  contactName: text("contact_name"),
  officePhone: text("office_phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_vendors_tenant").on(t.tenantId),
]);

export const insertVendorSchema = createInsertSchema(vendorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorsTable.$inferSelect;

// Stable keys preserve financial classifications when display names are edited.
export const expenseCategoriesTable = pgTable("expense_categories", {
  deletedAt: timestamp("deleted_at", {withTimezone:true}),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  key: text("key").notNull(),
  name: text("name").notNull(),
}, t => [primaryKey({columns:[t.tenantId,t.key]})]);

// ─── Expense Entries (Vendor & Expense Ledger) ─────────────────────────────
// Feed into the P&L statement as operating costs.

export const expenseEntriesTable = pgTable("expense_entries", {
  subtotal: real("subtotal"),
  salesTaxPct: real("sales_tax_pct").notNull().default(0),
  salesTaxAmount: real("sales_tax_amount").notNull().default(0),
  capitalizeSalesTax: boolean("capitalize_sales_tax").notNull().default(false),
  requestId: text("request_id"),
  requestFingerprint: text("request_fingerprint"),
  inventoryReceipts: jsonb("inventory_receipts").default([]),
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  /** ISO date string YYYY-MM-DD — the expense date, not the entry creation date */
  date: text("date").notNull(),
  amount: real("amount").notNull().default(0),
  category: text("category").notNull().default("other"),
  description: text("description"),
  /** Optional receipt upload — objectPath/serving URL from the storage service */
  receiptUrl: text("receipt_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_expense_entries_tenant_date").on(t.tenantId, t.date),
  index("idx_expense_entries_vendor").on(t.vendorId),
  uniqueIndex("expense_request_once").on(t.tenantId, t.requestId),
]);

export const insertExpenseEntrySchema = createInsertSchema(expenseEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpenseEntry = z.infer<typeof insertExpenseEntrySchema>;
export type ExpenseEntry = typeof expenseEntriesTable.$inferSelect;
