import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Owner-created service credentials. `tokenHash` is deliberately the only token
 * material persisted; callers only receive the raw token at creation/rotation.
 */
export const externalConnectionsTable = pgTable("external_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  mode: text("mode").notNull(),
  provider: text("provider").notNull(),
  scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
  allowWrites: boolean("allow_writes").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("external_connections_token_hash_uidx").on(table.tokenHash),
  index("external_connections_tenant_idx").on(table.tenantId),
]);

/** Metadata-only immutable activity ledger. It intentionally contains no request payload or credentials. */
export const externalAccessAuditTable = pgTable("external_access_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").references(() => externalConnectionsTable.id, { onDelete: "set null" }),
  connectionName: text("connection_name").notNull().default("Unknown connection"),
  action: text("action").notNull(),
  transport: text("transport").notNull(),
  status: text("status").notNull(),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("external_access_audit_tenant_created_idx").on(table.tenantId, table.createdAt),
  index("external_access_audit_connection_created_idx").on(table.connectionId, table.createdAt),
]);

/** Fixed minute buckets enforce connection limits across all API instances. */
export const externalConnectionRateLimitsTable = pgTable("external_connection_rate_limits", {
  connectionId: uuid("connection_id").notNull().references(() => externalConnectionsTable.id, { onDelete: "cascade" }),
  minuteBucket: timestamp("minute_bucket", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.connectionId, table.minuteBucket], name: "external_connection_rate_limits_pkey" }),
]);

/** Idempotency reservation and its non-sensitive resource reference for external writes. */
export const externalWriteIdempotencyTable = pgTable("external_write_idempotency", {
  connectionId: uuid("connection_id").notNull().references(() => externalConnectionsTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  action: text("action").notNull(),
  fingerprint: text("fingerprint").notNull(),
  resourceId: integer("resource_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.connectionId, table.idempotencyKey, table.action], name: "external_write_idempotency_pkey" }),
]);

/** Prevents a provider retry from creating a second communications-log record. */
export const externalVoipEventsTable = pgTable("external_voip_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id").notNull().references(() => externalConnectionsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  communicationsLogId: integer("communications_log_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("external_voip_events_connection_provider_event_uidx").on(table.connectionId, table.provider, table.eventId),
]);

export const insertExternalConnectionSchema = createInsertSchema(externalConnectionsTable).omit({
  id: true, createdAt: true, updatedAt: true, lastUsedAt: true, revokedAt: true,
});
export type ExternalConnection = typeof externalConnectionsTable.$inferSelect;
export type ExternalAccessAudit = typeof externalAccessAuditTable.$inferSelect;
export type InsertExternalConnection = z.infer<typeof insertExternalConnectionSchema>;