ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "satellite_measurement_mode" text DEFAULT 'both' NOT NULL;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "perimeter_linear_feet" real;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "linear_rate" real DEFAULT 0 NOT NULL;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "perimeter_linear_feet" real;
