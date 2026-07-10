import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { propertiesTable } from "./properties";
import { customersTable } from "./customers";
import { usersTable } from "./users";

export const propertyOwnershipHistoryTable = pgTable("property_ownership_history", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  previousCustomerId: integer("previous_customer_id").references(() => customersTable.id),
  newCustomerId: integer("new_customer_id").references(() => customersTable.id),
  transferredByUserId: integer("transferred_by_user_id").references(() => usersTable.id),
  notes: text("notes"),
  transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPropertyOwnershipHistorySchema = createInsertSchema(propertyOwnershipHistoryTable).omit({ id: true });
export type InsertPropertyOwnershipHistory = z.infer<typeof insertPropertyOwnershipHistorySchema>;
export type PropertyOwnershipHistory = typeof propertyOwnershipHistoryTable.$inferSelect;
