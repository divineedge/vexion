import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/** A staff member's Expo device. Tokens are globally unique because Expo tokens identify an installation. */
export const staffNotificationDevicesTable = pgTable("staff_notification_devices", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  expoPushToken: text("expo_push_token").notNull().unique(),
  platform: text("platform").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("staff_notification_devices_tenant_user_enabled_idx").on(t.tenantId, t.userId, t.isEnabled),
]);

/**
 * An outbox/claim row for one device and semantic event.  The unique key is the
 * idempotency boundary: a retried business mutation cannot send a second push.
 */
export const staffPushDeliveriesTable = pgTable("staff_push_deliveries", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  deviceId: integer("device_id").notNull().references(() => staffNotificationDevicesTable.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data").notNull().default({}),
  status: text("status").notNull().default("claimed"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  /** A failed delivery is not eligible until this time. */
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  /** Leases prevent a crashed API process from permanently owning a claim. */
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  /** Expo ticket returned by /push/send; used to resolve delayed receipts. */
  expoTicketId: text("expo_ticket_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  receiptCheckedAt: timestamp("receipt_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("staff_push_deliveries_device_event_uidx").on(t.deviceId, t.eventKey),
  index("staff_push_deliveries_tenant_event_idx").on(t.tenantId, t.eventKey),
  index("staff_push_deliveries_receipt_idx").on(t.status, t.expoTicketId),
  index("staff_push_deliveries_retry_idx").on(t.status, t.nextAttemptAt, t.claimExpiresAt),
]);

export type StaffNotificationDevice = typeof staffNotificationDevicesTable.$inferSelect;
export type StaffPushDelivery = typeof staffPushDeliveriesTable.$inferSelect;