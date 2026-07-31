import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

/**
 * Central tag library for the tenant.
 * Tags are defined here once, then applied to customers / jobs / properties
 * using the tags text[] column on each entity.
 *
 * slug is a normalised key (lowercase, no punctuation) used to detect near-
 * duplicates before the row is inserted (e.g. "Commercial" and "commercial"
 * would both slug to "commercial" and be blocked).
 */
export const businessTagsTable = pgTable("business_tags", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  /** Display label shown throughout the app */
  name: text("name").notNull(),
  /** Normalised slug for duplicate detection — lowercase, alphanumeric + hyphens only */
  slug: text("slug").notNull(),
  /** Hex colour, e.g. "#ef4444" */
  color: text("color").notNull().default("#6b7280"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBusinessTagSchema = createInsertSchema(businessTagsTable).omit({ id: true, createdAt: true });
export type InsertBusinessTag = z.infer<typeof insertBusinessTagSchema>;
export type BusinessTag = typeof businessTagsTable.$inferSelect;
