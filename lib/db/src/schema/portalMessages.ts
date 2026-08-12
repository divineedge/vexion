import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";

export const portalMessagesTable = pgTable("portal_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  /** 'inbound' = customer → staff, 'outbound' = staff → customer */
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  /**
   * For inbound messages: set when staff reads it.
   * For outbound messages: set when the customer reads it (on GET /portal/messages).
   */
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PortalMessage = typeof portalMessagesTable.$inferSelect;
