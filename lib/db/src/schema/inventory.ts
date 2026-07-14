import { pgTable, text, serial, timestamp, integer, real, boolean, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// ─── Inventory Locations ──────────────────────────────────────────────────────

export const inventoryLocationsTable = pgTable("inventory_locations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("warehouse"), // 'warehouse' | 'trailer' | 'other'
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInventoryLocationSchema = createInsertSchema(inventoryLocationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryLocation = z.infer<typeof insertInventoryLocationSchema>;
export type InventoryLocation = typeof inventoryLocationsTable.$inferSelect;

// ─── Inventory Location Stock ─────────────────────────────────────────────────
// Per-location quantity and reorder point for each inventory item

export const inventoryLocationStockTable = pgTable("inventory_location_stock", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
  locationId: integer("location_id").notNull().references(() => inventoryLocationsTable.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(0),
  reorderPoint: integer("reorder_point").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("uq_location_stock_item").on(t.tenantId, t.inventoryItemId, t.locationId),
]);

export const insertInventoryLocationStockSchema = createInsertSchema(inventoryLocationStockTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryLocationStock = z.infer<typeof insertInventoryLocationStockSchema>;
export type InventoryLocationStock = typeof inventoryLocationStockTable.$inferSelect;

// ─── Stock Transfer Log ───────────────────────────────────────────────────────

export const inventoryTransfersTable = pgTable("inventory_transfers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  fromLocationId: integer("from_location_id").references(() => inventoryLocationsTable.id),
  toLocationId: integer("to_location_id").references(() => inventoryLocationsTable.id),
  quantity: integer("quantity").notNull(),
  reason: text("reason"),
  transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInventoryTransferSchema = createInsertSchema(inventoryTransfersTable).omit({ id: true, createdAt: true });
export type InsertInventoryTransfer = z.infer<typeof insertInventoryTransferSchema>;
export type InventoryTransfer = typeof inventoryTransfersTable.$inferSelect;

// ─── Inventory Items ──────────────────────────────────────────────────────────

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  description: text("description"),
  category: text("category"),
  unitPrice: real("unit_price").notNull().default(0),
  markedUpPrice: real("marked_up_price").notNull().default(0),
  quantity: integer("quantity").notNull().default(0),
  reorderPoint: integer("reorder_point").notNull().default(5),
  unit: text("unit").notNull().default("each"),
  isLowStock: boolean("is_low_stock").notNull().default(false),
  /** When true, this item is offered as a pickable option in the Blueprint canvas palette / can be linked to a placed element. */
  availableForBlueprint: boolean("available_for_blueprint").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
