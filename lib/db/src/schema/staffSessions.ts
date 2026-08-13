import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Server-side staff authentication sessions.
 * Created on login; the raw token is given to the client once and never stored
 * here — only the SHA-256 hash is persisted so a DB leak cannot impersonate users.
 */
export const staffSessionsTable = pgTable("staff_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  /** SHA-256(rawToken) — the raw token is given to the client at login time only */
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StaffSession = typeof staffSessionsTable.$inferSelect;
