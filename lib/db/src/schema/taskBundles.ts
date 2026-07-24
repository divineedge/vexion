import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Daily Tasks Manager — structured, repeatable internal compliance routines
 * (safety checklists, mileage logs, tool inventory checks), distinct from
 * customer-facing Jobs and from the general Internal Tasks (#19) to-do system.
 */

// ── Task Bundles ──────────────────────────────────────────────────────────────

export const taskBundlesTable = pgTable("task_bundles", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  /** daily | per_shift | weekly | monthly */
  frequency: text("frequency").notNull().default("daily"),
  /** Assigned to a specific person, if not assigned to a role bucket or crew */
  assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id),
  /** Role bucket: 'admin_office' | 'manager' | 'technician' */
  assignedToRole: text("assigned_to_role"),
  /** Assigned to a specific crew (all members of that crew share this bundle) */
  assignedToCrewId: integer("assigned_to_crew_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaskBundleSchema = createInsertSchema(taskBundlesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaskBundle = z.infer<typeof insertTaskBundleSchema>;
export type TaskBundle = typeof taskBundlesTable.$inferSelect;

// ── Task Bundle Items ─────────────────────────────────────────────────────────

export const taskBundlesItemsTable = pgTable("task_bundle_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  bundleId: integer("bundle_id").notNull().references(() => taskBundlesTable.id, { onDelete: "cascade" }),
  /** checklist | safety_check | mileage_log | fuel_log | hour_meter_log | tool_inventory_check | warehouse_inventory_count | free_text */
  type: text("type").notNull(),
  label: text("label").notNull(),
  /** Sort order within the bundle */
  order: integer("order").notNull().default(0),
  /** Links this item's reading (mileage/fuel/hour-meter) to a specific equipment asset */
  linkedEquipmentId: integer("linked_equipment_id"),
  /** For warehouse_inventory_count items scoped to a single inventory item; null = counts every item */
  linkedInventoryItemId: integer("linked_inventory_item_id"),
  /** Free-form extra config for the item type (e.g. checklist sub-items) */
  config: jsonb("config").default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaskBundleItemSchema = createInsertSchema(taskBundlesItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaskBundleItem = z.infer<typeof insertTaskBundleItemSchema>;
export type TaskBundleItem = typeof taskBundlesItemsTable.$inferSelect;

// ── Task Bundle Completions ──────────────────────────────────────────────────
// One row per "run" of a bundle: started when a user hits Start, completed on submit.

export const taskBundleCompletionsTable = pgTable("task_bundle_completions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  bundleId: integer("bundle_id").notNull().references(() => taskBundlesTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  /** in_progress | completed */
  status: text("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  /**
   * Array of { itemId, type, label, value, status?, note? } — status is
   * 'pass' | 'fail' | 'concern' for checklist/safety_check items.
   */
  itemResults: jsonb("item_results").default("[]"),
  /** true if any item result has status 'fail' or 'concern' — surfaced in the completion log */
  hasFlags: boolean("has_flags").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskBundleCompletionSchema = createInsertSchema(taskBundleCompletionsTable).omit({ id: true, createdAt: true });
export type InsertTaskBundleCompletion = z.infer<typeof insertTaskBundleCompletionSchema>;
export type TaskBundleCompletion = typeof taskBundleCompletionsTable.$inferSelect;
