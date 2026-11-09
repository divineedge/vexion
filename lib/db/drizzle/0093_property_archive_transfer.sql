ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL;
UPDATE "properties" SET "is_archived" = true WHERE "archived_at" IS NOT NULL AND "is_archived" = false;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "detached_customer_id" integer;
CREATE TABLE IF NOT EXISTS "property_service_logs" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "service_id" integer,
  "service_name" text NOT NULL,
  "performed_at" timestamptz NOT NULL,
  "source_job_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "property_service_logs_source_job" ON "property_service_logs" ("property_id", "source_job_id");
