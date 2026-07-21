import { pgTable, text, serial, timestamp, integer, real, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

// ── Chemical Products library ─────────────────────────────────────────────────

export const chemicalProductsTable = pgTable("chemical_products", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  epaRegNumber: text("epa_reg_number"),
  activeIngredients: text("active_ingredients"), // comma-separated list
  signalWord: text("signal_word"), // CAUTION | WARNING | DANGER
  rei: integer("rei"), // restricted entry interval in hours
  phi: integer("phi"), // pre-harvest interval in days
  labelSdsUrl: text("label_sds_url"),
  unit: text("unit").notNull().default("oz"), // oz, fl oz, lb, gal, etc.
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChemicalProductSchema = createInsertSchema(chemicalProductsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChemicalProduct = z.infer<typeof insertChemicalProductSchema>;
export type ChemicalProduct = typeof chemicalProductsTable.$inferSelect;

// ── Chemical Mixtures (named tank mixes) ─────────────────────────────────────

export const chemicalMixturesTable = pgTable("chemical_mixtures", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChemicalMixtureSchema = createInsertSchema(chemicalMixturesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChemicalMixture = z.infer<typeof insertChemicalMixtureSchema>;
export type ChemicalMixture = typeof chemicalMixturesTable.$inferSelect;

// ── Mixture Items (ratio of products within a mixture) ────────────────────────

export const chemicalMixtureItemsTable = pgTable("chemical_mixture_items", {
  id: serial("id").primaryKey(),
  mixtureId: integer("mixture_id").notNull().references(() => chemicalMixturesTable.id),
  productId: integer("product_id").notNull().references(() => chemicalProductsTable.id),
  /** Amount of this product per unit volume of mixture (e.g. 2 oz per gallon) */
  ratioAmount: real("ratio_amount").notNull(),
  ratioUnit: text("ratio_unit").notNull().default("oz"), // oz per gallon of total mix
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChemicalMixtureItemSchema = createInsertSchema(chemicalMixtureItemsTable).omit({ id: true, createdAt: true });
export type InsertChemicalMixtureItem = z.infer<typeof insertChemicalMixtureItemSchema>;
export type ChemicalMixtureItem = typeof chemicalMixtureItemsTable.$inferSelect;

// ── Chemical Applications (logged on a job) ───────────────────────────────────

export const chemicalApplicationsTable = pgTable("chemical_applications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  jobId: integer("job_id").references(() => jobsTable.id, { onDelete: "set null" }),
  applicatorId: integer("applicator_id").references(() => usersTable.id, { onDelete: "set null" }),
  applicatorName: text("applicator_name"), // stored for reporting even if user deleted
  applicatorLicenseNumber: text("applicator_license_number"),

  /** Either mixtureId OR productId is set (not both) */
  mixtureId: integer("mixture_id").references(() => chemicalMixturesTable.id),
  productId: integer("product_id").references(() => chemicalProductsTable.id),

  /** Name at time of application (denormalized for reporting) */
  mixtureName: text("mixture_name"),
  productName: text("product_name"),

  volumeApplied: real("volume_applied").notNull(),
  volumeUnit: text("volume_unit").notNull().default("gal"),

  /** Treated area (as entered by the technician). Used for rate calculation. */
  treatedArea: real("treated_area"),
  areaUnit: text("area_unit"), // sqft | acres

  /** Optional zone name (from property blueprint/measurement polygons) the technician selected */
  treatedZoneName: text("treated_zone_name"),

  targetPest: text("target_pest"),
  applicationMethod: text("application_method"), // spray | granular | drench | etc.

  windSpeed: real("wind_speed"), // mph
  windDirection: text("wind_direction"),
  temperature: real("temperature"), // °F

  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),

  /**
   * Auto-expanded breakdown: [{productId, productName, activeIngredients, amountApplied, unit, ratePerAcre, ratePer1000Sqft}]
   * Computed server-side on save and stored for reporting.
   */
  breakdown: jsonb("breakdown").default("[]"),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChemicalApplicationSchema = createInsertSchema(chemicalApplicationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChemicalApplication = z.infer<typeof insertChemicalApplicationSchema>;
export type ChemicalApplication = typeof chemicalApplicationsTable.$inferSelect;
