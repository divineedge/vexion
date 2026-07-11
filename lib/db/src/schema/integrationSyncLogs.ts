import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// ─── Integration Sync Logs ──────────────────────────────────────────────────
// One row per connect/test/sync attempt against a third-party integration.

export const integrationSyncLogsTable = pgTable("integration_sync_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  /** 'bank' | 'mailchimp' | 'lob' | 'quickbooks' */
  integration: text("integration").notNull(),
  /** 'test' | 'sync' | 'connect' | 'disconnect' | 'push' */
  action: text("action").notNull().default("sync"),
  /** 'success' | 'error' */
  status: text("status").notNull(),
  message: text("message"),
  detail: jsonb("detail").default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_integration_sync_logs_tenant").on(t.tenantId, t.integration),
]);

export const insertIntegrationSyncLogSchema = createInsertSchema(integrationSyncLogsTable).omit({ id: true, createdAt: true });
export type InsertIntegrationSyncLog = z.infer<typeof insertIntegrationSyncLogSchema>;
export type IntegrationSyncLog = typeof integrationSyncLogsTable.$inferSelect;
