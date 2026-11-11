import { pgTable, text, serial, timestamp, integer, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { servicesTable } from "./services";

export const broadcastTemplatesTable = pgTable("broadcast_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const communicationTemplatesTable = pgTable("communication_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  category: text("category").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const websiteFormTemplatesTable = pgTable("website_form_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  purpose: text("purpose").notNull(),
  serviceId: integer("service_id").references(() => servicesTable.id),
  embedToken: text("embed_token").notNull(),
  fields: jsonb("fields").notNull().default("[]"),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("website_form_templates_slug").on(table.tenantId, table.slug),
  uniqueIndex("website_form_templates_token").on(table.embedToken),
]);

export const websiteFormSubmissionsTable = pgTable("website_form_submissions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  formId: integer("form_id").notNull().references(() => websiteFormTemplatesTable.id),
  purpose: text("purpose").notNull(),
  answers: jsonb("answers").notNull().default("{}"),
  customerId: integer("customer_id"),
  estimateId: integer("estimate_id"),
  applicationId: integer("application_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
