import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * One row per committed bulk import. `rowActions` captures enough detail to
 * undo the batch: for created rows, the new record id; for updated rows, the
 * record id plus the values that were in place immediately before the import
 * overwrote them.
 */
export const importBatchesTable = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
    userId: integer("user_id").references(() => usersTable.id),
    entityKey: text("entity_key").notNull(),
    fileName: text("file_name"),
    status: text("status").notNull().default("committed"), // committed | rolled_back
    totalRows: integer("total_rows").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    /** Array of { row, action: 'created'|'updated', recordId, priorValues? } */
    rowActions: jsonb("row_actions").notNull().default("[]"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rolledBackBy: integer("rolled_back_by").references(() => usersTable.id),
  },
  (t) => [index("idx_import_batches_tenant").on(t.tenantId, t.createdAt)],
);

export const insertImportBatchSchema = createInsertSchema(importBatchesTable).omit({ id: true, createdAt: true });
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ImportBatch = typeof importBatchesTable.$inferSelect;
