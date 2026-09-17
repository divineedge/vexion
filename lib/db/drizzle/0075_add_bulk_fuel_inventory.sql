CREATE TABLE IF NOT EXISTS "bulk_fuel_tanks" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "fuel_type" text NOT NULL,
  "capacity_thousandths" integer,
  "available_thousandths" integer NOT NULL DEFAULT 0,
  "inventory_value_cents" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "bulk_fuel_tanks_nonnegative_inventory" CHECK ("available_thousandths" >= 0 AND "inventory_value_cents" >= 0),
  CONSTRAINT "bulk_fuel_tanks_capacity_nonnegative" CHECK ("capacity_thousandths" IS NULL OR "capacity_thousandths" >= 0)
);
CREATE INDEX IF NOT EXISTS "bulk_fuel_tanks_tenant_active_idx" ON "bulk_fuel_tanks" ("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "bulk_fuel_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "tank_id" integer NOT NULL REFERENCES "bulk_fuel_tanks"("id"),
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "type" text NOT NULL CHECK ("type" IN ('delivery', 'opening_balance', 'dispense', 'reversal')),
  "date" text NOT NULL,
  "gallons_thousandths" integer NOT NULL,
  "total_cost_cents" integer NOT NULL,
  "supplier" text,
  "reference" text,
  "notes" text,
  "equipment_id" integer REFERENCES "equipment"("id") ON DELETE SET NULL,
  "equipment_name" text,
  "fuel_log_id" integer REFERENCES "equipment_fuel_logs"("id") ON DELETE SET NULL,
  "idempotency_key" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "bulk_fuel_transactions_tank_created_idx" ON "bulk_fuel_transactions" ("tank_id", "created_at");
CREATE INDEX IF NOT EXISTS "bulk_fuel_transactions_tenant_date_idx" ON "bulk_fuel_transactions" ("tenant_id", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "bulk_fuel_transactions_tank_idempotency_uidx" ON "bulk_fuel_transactions" ("tank_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "bulk_fuel_transactions_fuel_log_type_uidx" ON "bulk_fuel_transactions" ("fuel_log_id", "type") WHERE "fuel_log_id" IS NOT NULL;

ALTER TABLE "equipment_fuel_logs"
  ADD COLUMN IF NOT EXISTS "fuel_source" text NOT NULL DEFAULT 'purchased',
  ADD COLUMN IF NOT EXISTS "bulk_fuel_tank_id" integer REFERENCES "bulk_fuel_tanks"("id"),
  ADD COLUMN IF NOT EXISTS "bulk_fuel_tank_name" text,
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "equipment_fuel_logs"
  ADD CONSTRAINT "equipment_fuel_logs_source_tank_check"
  CHECK (("fuel_source" = 'bulk_tank' AND "bulk_fuel_tank_id" IS NOT NULL) OR ("fuel_source" = 'purchased' AND "bulk_fuel_tank_id" IS NULL));
CREATE INDEX IF NOT EXISTS "equipment_fuel_logs_tenant_tank_idx" ON "equipment_fuel_logs" ("tenant_id", "bulk_fuel_tank_id");
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_fuel_logs_tenant_idempotency_uidx" ON "equipment_fuel_logs" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "internal_tasks" ADD COLUMN IF NOT EXISTS "pre_trip_request_fingerprint" text;