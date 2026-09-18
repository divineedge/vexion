BEGIN;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS bulk_fuel_loss_period_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS bulk_fuel_loss_gallon_threshold real,
  ADD COLUMN IF NOT EXISTS bulk_fuel_loss_value_threshold real;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_bulk_fuel_loss_settings_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_bulk_fuel_loss_settings_check CHECK (
    bulk_fuel_loss_period_days BETWEEN 1 AND 365
    AND (bulk_fuel_loss_gallon_threshold IS NULL OR bulk_fuel_loss_gallon_threshold > 0)
    AND (bulk_fuel_loss_value_threshold IS NULL OR bulk_fuel_loss_value_threshold > 0)
  );
COMMIT;