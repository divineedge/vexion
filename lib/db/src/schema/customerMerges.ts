import {pgTable,serial,integer,jsonb,timestamp,uniqueIndex} from 'drizzle-orm/pg-core';
import {customersTable} from './customers';
import {tenantsTable} from './tenants';
import {usersTable} from './users';
export const customerMergeRecordsTable=pgTable('customer_merge_records',{
 id:serial('id').primaryKey(),
 tenantId:integer('tenant_id').notNull().references(()=>tenantsTable.id),
 sourceId:integer('source_id').notNull().references(()=>customersTable.id),
 primaryId:integer('primary_id').notNull().references(()=>customersTable.id),
 actorId:integer('actor_id').notNull().references(()=>usersTable.id),
 sourceSnapshot:jsonb('source_snapshot').notNull(),
 primarySnapshot:jsonb('primary_snapshot').notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('customer_merge_records_tenant_id_source_id_key').on(t.tenantId,t.sourceId)]);
