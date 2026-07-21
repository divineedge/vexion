CREATE TABLE IF NOT EXISTS "equipment_lifecycle_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "equipment_id" integer NOT NULL REFERENCES "equipment"("id") ON DELETE CASCADE,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "event_type" text NOT NULL,
  "performed_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "performed_by_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
