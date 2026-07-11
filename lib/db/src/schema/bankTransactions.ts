import { pgTable, text, serial, timestamp, integer, real, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { vendorsTable, expenseEntriesTable } from "./vendors";

// ─── Bank Transaction Sync (staging) ────────────────────────────────────────
// Transactions pulled from the connected bank feed. Each one can be imported
// into the Vendor & Expense Ledger (creating an expenseEntriesTable row) or ignored.

export const bankTransactionsTable = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  /** Id from the bank provider — used to dedupe repeated syncs */
  externalId: text("external_id").notNull(),
  /** ISO date string YYYY-MM-DD */
  date: text("date").notNull(),
  amount: real("amount").notNull(),
  description: text("description").notNull(),
  merchantName: text("merchant_name"),
  /** Best-guess expense category from the bank feed, editable on import */
  guessedCategory: text("guessed_category").notNull().default("other"),
  guessedVendorId: integer("guessed_vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  /** 'pending' | 'imported' | 'ignored' */
  status: text("status").notNull().default("pending"),
  importedExpenseId: integer("imported_expense_id").references(() => expenseEntriesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_bank_transactions_tenant_status").on(t.tenantId, t.status),
  unique("uq_bank_transactions_tenant_external").on(t.tenantId, t.externalId),
]);

export const insertBankTransactionSchema = createInsertSchema(bankTransactionsTable).omit({ id: true, createdAt: true });
export type InsertBankTransaction = z.infer<typeof insertBankTransactionSchema>;
export type BankTransaction = typeof bankTransactionsTable.$inferSelect;
