import { pgTable, text, serial, timestamp, integer, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";

export const marketingCampaignsTable = pgTable("marketing_campaigns", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  channel: text("channel").notNull(), // google_ads | facebook | mailer | door_hanger | yard_sign | referral | other
  budget: numeric("budget", { precision: 10, scale: 2 }).notNull().default("0"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Links a customer acquisition to a specific campaign
export const campaignCustomersTable = pgTable("campaign_customers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  campaignId: integer("campaign_id").notNull().references(() => marketingCampaignsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const insertMarketingCampaignSchema = createInsertSchema(marketingCampaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCampaignCustomerSchema = createInsertSchema(campaignCustomersTable).omit({ id: true });
export type InsertMarketingCampaign = z.infer<typeof insertMarketingCampaignSchema>;
export type InsertCampaignCustomer = z.infer<typeof insertCampaignCustomerSchema>;
export type MarketingCampaign = typeof marketingCampaignsTable.$inferSelect;
export type CampaignCustomer = typeof campaignCustomersTable.$inferSelect;
