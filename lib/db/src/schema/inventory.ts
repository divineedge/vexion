import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, real, doublePrecision, boolean, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { vendorsTable } from "./vendors";

// ─── Inventory Suppliers ──────────────────────────────────────────────────────
// Shared supplier/vendor lookup scoped to a tenant. One supplier ties across many items.

export const inventorySuppliersTable = pgTable("inventory_suppliers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  contact: text("contact"),       // e.g. phone, email, or rep name
  accountNumber: text("account_number"), // our account # with this supplier
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInventorySupplierSchema = createInsertSchema(inventorySuppliersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventorySupplier = z.infer<typeof insertInventorySupplierSchema>;
export type InventorySupplier = typeof inventorySuppliersTable.$inferSelect;

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

// ─── Inventory part types and sizes ───────────────────────────────────────────
// Type is the parent (Pipe, Fitting). A size name is shared across types; type_id records where it was first added.

export const inventoryPartTypesTable = pgTable("inventory_part_types", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("inventory_part_types_tenant_name").on(t.tenantId, sql`lower(${t.name})`),
]);

export const insertInventoryPartTypeSchema = createInsertSchema(inventoryPartTypesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryPartType = z.infer<typeof insertInventoryPartTypeSchema>;
export type InventoryPartType = typeof inventoryPartTypesTable.$inferSelect;

export const inventoryPartSizesTable = pgTable("inventory_part_sizes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  typeId: integer("type_id").notNull().references(() => inventoryPartTypesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Chemical in one unit of an item that uses this size. Null when the size has no volume. */
  volumeAmount: doublePrecision("volume_amount"),
  /** gal, oz, l, or lb. Gallons and ounces convert. Pounds stay weight. */
  volumeUnit: text("volume_unit"),
  /** Area one unit of this size covers, such as 100 square feet per roll. */
  coverageAmount: doublePrecision("coverage_amount"),
  /** sqft. Area is not converted to gallons or pounds. */
  coverageUnit: text("coverage_unit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("inventory_part_sizes_type_name").on(t.typeId, sql`lower(${t.name})`),
]);

export const insertInventoryPartSizeSchema = createInsertSchema(inventoryPartSizesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryPartSize = z.infer<typeof insertInventoryPartSizeSchema>;
export type InventoryPartSize = typeof inventoryPartSizesTable.$inferSelect;

// ─── Inventory Items ──────────────────────────────────────────────────────────

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  description: text("description"),
  category: text("category"),
  /** Parent grouping. Null on parts created before types existed. */
  typeId: integer("type_id").references(() => inventoryPartTypesTable.id, { onDelete: "set null" }),
  /** Shared size. Null when the part has no size. The size does not have to be the one first added under typeId. */
  sizeId: integer("size_id").references(() => inventoryPartSizesTable.id, { onDelete: "set null" }),
  unitPrice: real("unit_price").notNull().default(0),
  markedUpPrice: real("marked_up_price").notNull().default(0),
  /**
   * Explicit item markup percent. Null means the company standard applies when the
   * stored sell price still equals the buy price (or the raw per-foot price).
   * 0 is a real markup of zero and is not the company standard.
   */
  markupPct: real("markup_pct"),
  quantity: doublePrecision("quantity").notNull().default(0),
  reorderPoint: integer("reorder_point").notNull().default(5),
  unit: text("unit").notNull().default("each"),
  /** When false, the item stays in inventory but is left out of low-stock and reorder alerts. */
  stockAlerts: boolean("stock_alerts").notNull().default(true),
  isLowStock: boolean("is_low_stock").notNull().default(false),
  /** When true, this item is offered as a pickable option in the Blueprint canvas palette / can be linked to a placed element. */
  availableForBlueprint: boolean("available_for_blueprint").notNull().default(false),
  /** Percentage of the markup (sell - buy) awarded to the salesperson as commission. Null means 0%. */
  commissionPct: real("commission_pct"),
  /** Optional FK to the shared inventory supplier lookup. */
  supplierId: integer("supplier_id").references(() => inventorySuppliersTable.id, { onDelete: "set null" }),
  /** Feet of pipe recorded when this stock arrived. */
  lengthReceived: real("length_received"),
  /** Per-foot price before inventory markup. The charged sell price adds the same markup a normal part adds to its cost. */
  pricePerFoot: real("price_per_foot"),
  /** Supplier chosen from the vendor list. */
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  /**
   * When set, on-hand quantity lives on that item. Copies stay separate catalog
   * rows and share one stock pile instead of keeping a second quantity.
   */
  stockItemId: integer("stock_item_id").references((): any => inventoryItemsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;

// ─── Linked parts ─────────────────────────────────────────────────────────────
// Using parentQuantity of the parent item also uses each component's quantity, scaled.
// 100 of the parent with 10 of a component means 50 uses 5. Components are inventory items.

export const inventoryPartLinksTable = pgTable("inventory_part_links", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  parentItemId: integer("parent_item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
  parentQuantity: doublePrecision("parent_quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("inventory_part_links_parent").on(t.tenantId, t.parentItemId),
]);

export const insertInventoryPartLinkSchema = createInsertSchema(inventoryPartLinksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryPartLink = z.infer<typeof insertInventoryPartLinkSchema>;
export type InventoryPartLink = typeof inventoryPartLinksTable.$inferSelect;

export const inventoryPartLinkComponentsTable = pgTable("inventory_part_link_components", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  linkId: integer("link_id").notNull().references(() => inventoryPartLinksTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
  quantity: doublePrecision("quantity").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  uniqueIndex("inventory_part_link_components_item").on(t.linkId, t.inventoryItemId),
]);

export const insertInventoryPartLinkComponentSchema = createInsertSchema(inventoryPartLinkComponentsTable).omit({ id: true });
export type InsertInventoryPartLinkComponent = z.infer<typeof insertInventoryPartLinkComponentSchema>;
export type InventoryPartLinkComponent = typeof inventoryPartLinkComponentsTable.$inferSelect;
