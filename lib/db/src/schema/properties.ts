import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";

export const propertiesTable = pgTable("properties", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lat: real("lat"),
  lng: real("lng"),
  geofenceLat: real("geofence_lat"),
  geofenceLng: real("geofence_lng"),
  geofenceRadius: integer("geofence_radius").notNull().default(100),
  notes: text("notes"),
  type: text("type"),
  /** Property size for chemical rate calculations */
  size: real("size"),
  sizeUnit: text("size_unit").default("sqft"), // sqft | acres
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPropertySchema = createInsertSchema(propertiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof propertiesTable.$inferSelect;
