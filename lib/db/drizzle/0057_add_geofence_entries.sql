CREATE TABLE IF NOT EXISTS "geofence_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "job_id" integer REFERENCES "jobs"("id"),
  "visit_id" integer REFERENCES "visits"("id"),
  "lat" real NOT NULL,
  "lng" real NOT NULL,
  "distance_meters" real NOT NULL,
  "entered_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "geofence_entries_tenant_user_entered_idx"
  ON "geofence_entries" ("tenant_id", "user_id", "entered_at");
CREATE INDEX IF NOT EXISTS "geofence_entries_tenant_property_entered_idx"
  ON "geofence_entries" ("tenant_id", "property_id", "entered_at");