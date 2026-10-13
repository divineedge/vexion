import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { equipmentTable } from "./equipment";

/** Recorded inspections are not executable/assigned tasks. */
export const equipmentInspectionsTable = pgTable("equipment_inspections", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  contextId: integer("equipment_id").notNull().references(() => equipmentTable.id),
  contextType: text("context_type").notNull().default("equipment"),
  taskType: text("inspection_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  idempotencyKey: text("idempotency_key").notNull(),
  preTripRequestFingerprint: text("request_fingerprint").notNull(),
  preTripFuelLogId: integer("fuel_log_id"),
  preTripReadingLogId: integer("reading_log_id"),
  preTripChecklistSnapshot: jsonb("checklist_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("equipment_inspections_retry_unique").on(t.tenantId, t.idempotencyKey)]);

/** Append-only manager reviews, including preserved legacy inspection records. */
export const equipmentInspectionReviewsTable = pgTable("equipment_inspection_reviews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  inspectionRef: text("inspection_ref").notNull(),
  reviewedById: integer("reviewed_by_id").notNull().references(() => usersTable.id),
  notes: text("notes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
