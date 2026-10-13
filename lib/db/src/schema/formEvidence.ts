import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const formEvidenceTable = pgTable("form_evidence", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  actorId: integer("actor_id").notNull().references(() => usersTable.id),
  scope: text("scope").notNull(),
  scopeId: integer("scope_id").notNull(),
  employeeId: integer("employee_id"),
  fieldId: text("field_id").notNull(),
  label: text("label").notNull(),
  kind: text("kind").notNull(),
  uploadPath: text("upload_path").notNull(),
  objectPath: text("object_path"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sha256: text("sha256"),
  sizeBytes: integer("size_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
});
