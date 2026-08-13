import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const staffNotesTable = pgTable("staff_notes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  authorId: integer("author_id").notNull().references(() => usersTable.id),
  /** 'customer' or 'job' */
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when the note body is edited after initial creation */
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  /** Soft-delete timestamp; null = note is visible */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertStaffNoteSchema = createInsertSchema(staffNotesTable).omit({
  id: true, createdAt: true, deletedAt: true,
});
export type InsertStaffNote = z.infer<typeof insertStaffNoteSchema>;
export type StaffNote = typeof staffNotesTable.$inferSelect;
