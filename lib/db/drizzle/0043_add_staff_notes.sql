CREATE TABLE IF NOT EXISTS "staff_notes" (
  "id" SERIAL PRIMARY KEY,
  "tenant_id" INTEGER NOT NULL REFERENCES "tenants"("id"),
  "author_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "staff_notes_tenant_entity_idx"
  ON "staff_notes"("tenant_id", "entity_type", "entity_id");
