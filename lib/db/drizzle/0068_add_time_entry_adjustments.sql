ALTER TABLE "time_entries"
  ADD COLUMN IF NOT EXISTS "adjusted_clocked_in_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "adjusted_clocked_out_at" timestamptz;

CREATE TABLE IF NOT EXISTS "time_entry_adjustments" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "time_entry_id" integer NOT NULL REFERENCES "time_entries"("id"),
  "actor_user_id" integer NOT NULL REFERENCES "users"("id"),
  "reason" text NOT NULL,
  "previous_clocked_in_at" timestamptz NOT NULL,
  "previous_clocked_out_at" timestamptz NOT NULL,
  "adjusted_clocked_in_at" timestamptz NOT NULL,
  "adjusted_clocked_out_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "time_entry_adjustments_tenant_entry_created_idx"
  ON "time_entry_adjustments" ("tenant_id", "time_entry_id", "created_at");