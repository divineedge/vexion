import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { propertiesTable } from "./properties";
import { blueprintsTable } from "./blueprints";

export const quotesTable = pgTable("quotes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  /** Blueprint this quote was generated from, if any */
  blueprintId: integer("blueprint_id").references(() => blueprintsTable.id),
  /** Unique signed URL token for the public quote link */
  token: text("token").notNull().unique(),
  serviceId: integer("service_id"),
  serviceName: text("service_name").notNull(),
  serviceDescription: text("service_description"),
  /** Labels of the measurement zones included in this quote */
  selectedZoneLabels: jsonb("selected_zone_labels").default("[]"),
  /** Total area in sqft for the selected zones */
  totalAreaSqft: real("total_area_sqft"),
  /** Calculated price based on service base price × area (or flat rate) */
  calculatedPrice: real("calculated_price").notNull().default(0),
  /** Pricing type for this quote: 'flat' | 'per_sqft' */
  priceType: text("price_type").notNull().default("flat"),
  /** 'pending' | 'approved' | 'declined' */
  status: text("status").notNull().default("pending"),
  /** When this quote link expires */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** When the customer responded */
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  /** Customer notes on respond */
  customerNote: text("customer_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertQuoteSchema = createInsertSchema(quotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotesTable.$inferSelect;
