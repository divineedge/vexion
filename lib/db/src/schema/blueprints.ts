import { pgTable, text, serial, timestamp, integer, real, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { propertiesTable } from "./properties";
import { jobsTable } from "./jobs";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBlueprintSchema = createInsertSchema(blueprintsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBlueprint = z.infer<typeof insertBlueprintSchema>;
export type Blueprint = typeof blueprintsTable.$inferSelect;
