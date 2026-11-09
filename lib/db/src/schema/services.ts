import { pgTable, text, serial, timestamp, integer, real, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const servicesTable = pgTable("services", {
  paymentPolicy: jsonb("payment_policy"),
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  /** Standard base price charged to customer. Also the per-sqft rate for area_and_linear. */
  basePrice: real("base_price").notNull().default(0),
  /** Per-linear-foot rate used when pricingMode is area_and_linear. */
  linearRate: real("linear_rate").notNull().default(0),
  /** Estimated job duration in minutes */
  estimatedDuration: integer("estimated_duration"),
  /** Service-level P4P payout %. null = use tenant p4pMasterPercentage. */
  p4pPercentage: real("p4p_percentage"),
  isActive: boolean("is_active").notNull().default(true),
  /** 'flat' | 'per_sqft' | 'per_linear_ft' | 'area_and_linear' | 'matrix' | 'hourly' */
  pricingMode: text("pricing_mode").notNull().default("flat"),
  /** Customer rate per hour when pricingMode is hourly. */
  hourlyRate: real("hourly_rate"),
  /** Shortest time to bill, in minutes. Null means bill the exact clocked time. */
  minimumBillableMinutes: integer("minimum_billable_minutes"),
  /**
   * Measurement-based pricing tiers.
   * Array<{ minSqft: number, maxSqft: number | null, price: number, perSqftRate?: number }>
   * When maxSqft is null it is the catch-all "above X sqft" tier; perSqftRate is used if set.
   */
  pricingMatrix: jsonb("pricing_matrix"),
  /**
   * Optional tenant zone type id (from tenantsTable.measurementZoneTypes).
   * When set, the resolver uses the area or linear length of this zone type from the property's measurements.
   */
  linkedZoneTypeId: text("linked_zone_type_id"),
  /** Off-season window start as "MM-DD" (e.g. "11-15"). Null = no off-season. */
  offSeasonStart: text("off_season_start"),
  /** Off-season window end as "MM-DD" (e.g. "03-14"). Null = no off-season. */
  offSeasonEnd: text("off_season_end"),
  /**
   * Explicit field-work collection requirements. Keep this extensible rather
   * than deriving compliance workflows from a service name or category.
   */
  fieldRequirements: jsonb("field_requirements").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;
