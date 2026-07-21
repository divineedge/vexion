import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Internal to-do system — separate from customer-facing jobs. Lets any role flag
 * something for another role (office, manager, technician) with optional links
 * back to a customer/job/property/equipment record.
 *
 * Assignment is either to a specific person (assignedToUserId) OR to a role
 * bucket (assignedToRole: 'admin_office' | 'manager' | 'technician') that any
 * matching user can claim by setting assignedToUserId to themselves.
 */
export const internalTasksTable = pgTable("internal_tasks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  /** 'invoice_job' | 'call_customer' | 'follow_up' | 'equipment_repair' | 'custom' | null (system-generated) */
  taskType: text("task_type"),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  /** Specific assignee, if assigned to a person rather than a role bucket */
  assignedToUserId: integer("assigned_to_user_id").references(() => usersTable.id),
  /** Role bucket assignee: 'admin_office' | 'manager' | 'technician' */
  assignedToRole: text("assigned_to_role"),
  /** low | normal | high | urgent */
  priority: text("priority").notNull().default("normal"),
  /** open | in_progress | done | rejected */
  status: text("status").notNull().default("open"),
  dueDate: text("due_date"), // ISO date string YYYY-MM-DD
  /** 'customer' | 'job' | 'property' | 'equipment' | null */
  contextType: text("context_type"),
  contextId: integer("context_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  /** Set when an admin soft-archives a task; archived tasks are hidden from all default list views. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInternalTaskSchema = createInsertSchema(internalTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInternalTask = z.infer<typeof insertInternalTaskSchema>;
export type InternalTask = typeof internalTasksTable.$inferSelect;

/**
 * In-app notifications generated when a task is assigned / completed / rejected,
 * or when a system event (missed call, voicemail) warrants immediate staff attention.
 *
 * taskId is nullable for non-task notifications (e.g. missed call / voicemail alerts).
 * linkPath is the client-side navigation path for non-task notifications.
 */
export const taskNotificationsTable = pgTable("task_notifications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  recipientUserId: integer("recipient_user_id").notNull().references(() => usersTable.id),
  /** Null for system notifications not tied to a specific task (e.g. missed call alerts). */
  taskId: integer("task_id").references(() => internalTasksTable.id),
  /** 'assigned' | 'completed' | 'rejected' | 'missed_call' | 'voicemail' */
  type: text("type").notNull(),
  message: text("message").notNull(),
  /**
   * Optional client-side navigation path used when taskId is null.
   * e.g. "/communications?customerId=42"
   */
  linkPath: text("link_path"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskNotificationSchema = createInsertSchema(taskNotificationsTable).omit({ id: true, createdAt: true });
export type InsertTaskNotification = z.infer<typeof insertTaskNotificationSchema>;
export type TaskNotification = typeof taskNotificationsTable.$inferSelect;
