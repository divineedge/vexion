ALTER TABLE "estimates"
  ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "estimates_tenant_archived_idx"
  ON "estimates" ("tenant_id", "archived_at");

CREATE INDEX IF NOT EXISTS "invoices_tenant_archived_idx"
  ON "invoices" ("tenant_id", "archived_at");

CREATE INDEX IF NOT EXISTS "jobs_tenant_archived_idx"
  ON "jobs" ("tenant_id", "archived_at");