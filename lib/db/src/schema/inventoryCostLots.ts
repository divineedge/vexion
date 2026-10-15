import {pgTable,serial,integer,doublePrecision,text,timestamp} from 'drizzle-orm/pg-core';
import {inventoryItemsTable} from './inventory';
import {tenantsTable} from './tenants';
import {expenseEntriesTable} from './vendors';
export const inventoryCostLotsTable=pgTable('inventory_cost_lots',{
 id:serial('id').primaryKey(),
 tenantId:integer('tenant_id').notNull().references(()=>tenantsTable.id),
 inventoryItemId:integer('inventory_item_id').notNull().references(()=>inventoryItemsTable.id),
 expenseId:integer('expense_id').references(()=>expenseEntriesTable.id),
 receivedQuantity:integer('received_quantity').notNull(),
 remainingQuantity:integer('remaining_quantity').notNull(),
 unitCost:doublePrecision('unit_cost').notNull(),
 source:text('source').notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
