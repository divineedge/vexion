import { pgTable, serial, integer, text, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { propertiesTable } from "./properties";
import { jobsTable } from "./jobs";
import { blueprintsTable } from "./blueprints";
import { usersTable } from "./users";
import { tenantsTable } from "./tenants";
import { inventoryItemsTable } from "./inventory";

/**
 * Tracks every repair or replacement event on an irrigation system element
 * (sprinkler head, valve, pipe, controller, etc.) tied to a property.
 *
 * Key design:
 * - elementId references the canvas Point/Line id stored in blueprint canvasData (jsonb string uuid).
 *   It is a plain text field — no FK — so old repair records survive element deletion.
 * - Nozzle detail fields are nullable so non-nozzle replacements (pipes, valves) can skip them.
 * - replacedWithInventoryItemId links to the specific inventory SKU installed
 *   (especially useful for popup nozzles which are distinct inventory parts).
 */
export const repairLogsTable = pgTable("repair_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id),
  propertyId: integer("property_id")
    .notNull()
    .references(() => propertiesTable.id),
  /** The job this repair was performed on, if any. */
  jobId: integer("job_id").references(() => jobsTable.id),
  /** Blueprint the element lives on, so we can navigate back to it on the map. */
  blueprintId: integer("blueprint_id").references(() => blueprintsTable.id),
  /** Canvas element ID (Point/Line id string from canvasData). Plain text, no FK. */
  elementId: text("element_id"),
  /** High-level component category for grouping and filtering. */
  componentType: text("component_type").notNull().default("other"),
  // ── What was removed / failed ──────────────────────────────────────────────
  /** Free-text description of what was removed/failed, e.g. "Hunter PGP rotor cracked". */
  replacedWhat: text("replaced_what"),
  // ── What was installed ─────────────────────────────────────────────────────
  /** Free-text name of the replacement part/material installed. */
  replacedWithName: text("replaced_with_name"),
  /** Inventory SKU linked to the replacement — especially for popup nozzles. */
  replacedWithInventoryItemId: integer("replaced_with_inventory_item_id").references(
    () => inventoryItemsTable.id,
  ),
  // ── Nozzle detail (only for sprinkler-head replacements) ──────────────────
  nozzleBrand: text("nozzle_brand"),
  /** rotor = gear-driven rotor; popup = fixed-spray popup; drip / bubbler / other */
  nozzleType: text("nozzle_type"),
  /** Gallons per minute output of the installed nozzle. */
  nozzleGpm: real("nozzle_gpm"),
  /** Throw radius in feet. */
  nozzleRadiusFt: real("nozzle_radius_ft"),
  /** Arc in degrees (e.g. 90, 180, 270, 360). */
  nozzleArcDegrees: real("nozzle_arc_degrees"),
  // ── Cost breakdown ─────────────────────────────────────────────────────────
  /** Cost of parts used (materials only, no labour). */
  partsCost: real("parts_cost").notNull().default(0),
  /** Labour cost for this repair. */
  laborCost: real("labor_cost").notNull().default(0),
  // ── Metadata ───────────────────────────────────────────────────────────────
  notes: text("notes"),
  performedByUserId: integer("performed_by_user_id").references(() => usersTable.id),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
