import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";
import { routinesTable } from "./routines";

export const timeEntriesTable = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  clockedInAt: timestamp("clocked_in_at", { withTimezone: true }).notNull(),
  clockedOutAt: timestamp("clocked_out_at", { withTimezone: true }),
  totalMinutes: integer("total_minutes").notNull().default(0),
  isMasterClock: boolean("is_master_clock").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subTimersTable = pgTable("sub_timers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  label: text("label").notNull(),
  type: text("type").notNull().default("other"),
  jobId: integer("job_id").references(() => jobsTable.id),
  routineId: integer("routine_id").references(() => routinesTable.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  elapsedSeconds: integer("elapsed_seconds").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit({ id: true, createdAt: true });
export const insertSubTimerSchema = createInsertSchema(subTimersTable).omit({ id: true, createdAt: true });
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type InsertSubTimer = z.infer<typeof insertSubTimerSchema>;
export type TimeEntry = typeof timeEntriesTable.$inferSelect;
export type SubTimer = typeof subTimersTable.$inferSelect;
