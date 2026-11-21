import { pgTable, text, serial, timestamp, integer, real, doublePrecision, jsonb, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { propertiesTable } from "./properties";
import { jobsTable } from "./jobs";
import { inventoryItemsTable } from "./inventory";

export const blueprintsTable = pgTable("blueprints", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("general"),
  jobId: integer("job_id").references(() => jobsTable.id),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  canvasData: jsonb("canvas_data").default("{}"),
  overageBufferPercent: real("overage_buffer_percent").notNull().default(10),
  totalEstimate: real("total_estimate"),
  /** Service-level P4P payout %. null = use tenant p4pMasterPercentage. */
  p4pPercentage: real("p4p_percentage"),
  /** Suggested parts for this blueprint: [{inventoryItemId, name, estimatedQuantity}] */
  suggestedParts: jsonb("suggested_parts").default("[]"),
  /** True = reusable business design-rule template (not tied to a specific job/property); false = one-off instance. */
  isTemplate: boolean("is_template").notNull().default(false),
  /** FK to the template this blueprint was created from, when applicable. */
  templateId: integer("template_id"),
  /** Real-world scale for area/length math: pixels per foot on the canvas. Null until the user calibrates it against the map. */
  scalePxPerFt: real("scale_px_per_ft"),
  /** AI-assisted generation: the free-text description the user gave (if any) to auto-generate this layout. */
  aiGenerationPrompt: text("ai_generation_prompt"),
  /** 'canvas' = drawn/AI-generated on the SVG canvas (default); 'pdf' = view-only import of an existing PDF design. */
  sourceType: text("source_type").notNull().default("canvas"),
  /** Object storage path for the uploaded PDF. Only set when sourceType === 'pdf'. */
  pdfObjectPath: text("pdf_object_path"),
  /** Original uploaded file name, for display. */
  pdfFileName: text("pdf_file_name"),
  /** Snapshot of the last computed estimate: {parts: EstimatedPart[], subtotal, overageAmount, total, computedAt}.
   *  Persisted so the materials breakdown a price was based on stays visible after leaving the canvas editor,
   *  instead of only existing transiently in the editor's local state right after clicking Calculate Estimate. */
  lastEstimate: jsonb("last_estimate"),
  /** True once the linked job is completed or the linked estimate/quote is declined. Hidden from the main Blueprints list but still visible on its property page. */
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /** Property outline, work areas, and features collected before a plan is calculated. */
  planningInputs: jsonb("planning_inputs").notNull().default({}),
  /** Version the customer or office selected. Other versions stay archived. */
  chosenPlanVersionId: integer("chosen_plan_version_id"),
  /** Set when an estimate from this blueprint is accepted or its job is completed. */
  planningLocked: boolean("planning_locked").notNull().default(false),
  planningLockedReason: text("planning_locked_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** One measured use of inventory on a blueprint. Editing or removing it puts the deducted amount back. */
export const blueprintInventoryUsesTable = pgTable("blueprint_inventory_uses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  blueprintId: integer("blueprint_id").notNull().references(() => blueprintsTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  /** Amount entered in the use's unit. */
  amount: doublePrecision("amount").notNull(),
  unit: text("unit").notNull(),
  /** Amount removed from on-hand quantity, in the stock's measure. */
  deductedQuantity: doublePrecision("deducted_quantity").notNull(),
  deductedUnit: text("deducted_unit").notNull(),
  /** Canvas element this use belongs to, when it was entered on a placed item. */
  elementId: text("element_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBlueprintSchema = createInsertSchema(blueprintsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBlueprint = z.infer<typeof insertBlueprintSchema>;
export type Blueprint = typeof blueprintsTable.$inferSelect;

/** Spacing, material density, and which sprinkler heads cannot share a zone. */
export const blueprintPlanningSettingsTable = pgTable("blueprint_planning_settings", {
  tenantId: integer("tenant_id").primaryKey().references(() => tenantsTable.id),
  sprinklerMinSpacingFt: doublePrecision("sprinkler_min_spacing_ft"),
  sprinklerMaxSpacingFt: doublePrecision("sprinkler_max_spacing_ft"),
  tonsPerYard: doublePrecision("tons_per_yard"),
  yardsPerTruckLoad: doublePrecision("yards_per_truck_load"),
  bufferPercent: doublePrecision("buffer_percent").notNull().default(10),
  zoneExclusions: jsonb("zone_exclusions").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Pass-through charges the blueprint can offer. Kept separate from estimate line JSON. */
export const blueprintPassthroughDefaultsTable = pgTable("blueprint_passthrough_defaults", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  unit: text("unit"),
  unitPrice: doublePrecision("unit_price").notNull().default(0),
  internalCost: doublePrecision("internal_cost"),
  availableForBlueprint: boolean("available_for_blueprint").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Kits and services marked available on blueprints. Inventory and pass-throughs keep their own flags. */
export const blueprintCatalogAvailabilityTable = pgTable("blueprint_catalog_availability", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  sourceKind: text("source_kind").notNull(),
  sourceId: integer("source_id").notNull(),
  available: boolean("available").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("blueprint_catalog_availability_source").on(t.tenantId, t.sourceKind, t.sourceId),
]);

/** A catalog row assigned to a role the plan needs, such as pipe or valve kit. */
export const blueprintCatalogLinksTable = pgTable("blueprint_catalog_links", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  roleKey: text("role_key").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceId: integer("source_id").notNull(),
  customerLabel: text("customer_label"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("blueprint_catalog_links_source").on(t.tenantId, t.roleKey, t.sourceKind, t.sourceId),
]);

/** One priced take of a blueprint. Unchosen versions are archived, not deleted. */
export const blueprintPlanVersionsTable = pgTable("blueprint_plan_versions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  blueprintId: integer("blueprint_id").notNull().references(() => blueprintsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("open"),
  inputs: jsonb("inputs").notNull().default({}),
  plan: jsonb("plan").notNull().default({}),
  lines: jsonb("lines").notNull().default([]),
  orderList: jsonb("order_list").notNull().default([]),
  total: doublePrecision("total"),
  estimateId: integer("estimate_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  index("blueprint_plan_versions_blueprint_idx").on(t.tenantId, t.blueprintId),
]);
