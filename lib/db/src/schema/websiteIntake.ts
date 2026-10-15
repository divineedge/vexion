import {pgTable,integer,text,jsonb,timestamp,serial,primaryKey,uniqueIndex,index} from 'drizzle-orm/pg-core';
import {tenantsTable} from './tenants';
import {usersTable} from './users';
export const websiteIntakeFormsTable=pgTable('website_intake_forms',{
  tenantId:integer('tenant_id').notNull().references(()=>tenantsTable.id),kind:text('kind').notNull(),
  draft:jsonb('draft').notNull(),published:jsonb('published'),revision:integer('revision').notNull().default(0),
  updatedBy:integer('updated_by').references(()=>usersTable.id),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.kind]})]);
export const websiteIntakeVersionsTable=pgTable('website_intake_versions',{
  id:serial('id').primaryKey(),tenantId:integer('tenant_id').notNull().references(()=>tenantsTable.id),kind:text('kind').notNull(),
  revision:integer('revision').notNull(),definition:jsonb('definition').notNull(),
  publishedBy:integer('published_by'),publisherName:text('publisher_name'),
  publishedAt:timestamp('published_at',{withTimezone:true}),legacy:integer('legacy').notNull().default(0),
},t=>[uniqueIndex('website_intake_version_revision').on(t.tenantId,t.kind,t.revision)]);
export const websiteIntakeSubmissionsTable=pgTable('website_intake_submissions',{
  id:serial('id').primaryKey(),tenantId:integer('tenant_id').notNull().references(()=>tenantsTable.id),kind:text('kind').notNull(),
  requestId:text('request_id').notNull(),requestHash:text('request_hash').notNull(),reference:text('reference').notNull(),
  status:text('status').notNull().default('pending'),payload:jsonb('payload').notNull(),snapshot:jsonb('snapshot').notNull(),
  preview:jsonb('preview'),path:jsonb('path').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  customerId:integer('customer_id'),propertyId:integer('property_id'),estimateId:integer('estimate_id'),applicationId:integer('application_id'),
  reviewNotes:text('review_notes'),reviewedBy:integer('reviewed_by'),reviewedAt:timestamp('reviewed_at',{withTimezone:true}),reviewData:jsonb('review_data'),
},t=>[uniqueIndex('website_intake_once').on(t.tenantId,t.kind,t.requestId),uniqueIndex('website_intake_reference').on(t.reference),index('website_intake_inbox').on(t.tenantId,t.kind,t.id)]);
