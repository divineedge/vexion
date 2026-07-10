import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const crewsTable = pgTable("crews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  name: text("name").notNull(),
  description: text("description"),
  managerId: integer("manager_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const crewMembersTable = pgTable("crew_members", {
  id: serial("id").primaryKey(),
  crewId: integer("crew_id").notNull().references(() => crewsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCrewSchema = createInsertSchema(crewsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrew = z.infer<typeof insertCrewSchema>;
export type Crew = typeof crewsTable.$inferSelect;

export const insertCrewMemberSchema = createInsertSchema(crewMembersTable).omit({ id: true, joinedAt: true });
export type InsertCrewMember = z.infer<typeof insertCrewMemberSchema>;
export type CrewMember = typeof crewMembersTable.$inferSelect;
