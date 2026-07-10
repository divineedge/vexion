import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { customersTable } from "./customers";

export const customerOtpSessionsTable = pgTable("customer_otp_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  email: text("email").notNull(),
  /** bcrypt/sha256 hash of the 6-digit OTP */
  otpHash: text("otp_hash").notNull(),
  /** signed session token returned after OTP verification; null until verified */
  sessionToken: text("session_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CustomerOtpSession = typeof customerOtpSessionsTable.$inferSelect;
