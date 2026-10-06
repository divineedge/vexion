ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pre_trip_checklist_name text NOT NULL DEFAULT 'Pre-trip';
ALTER TABLE bulk_fuel_tanks ADD COLUMN IF NOT EXISTS meter_thousandths integer;
ALTER TABLE bulk_fuel_transactions ADD COLUMN IF NOT EXISTS meter_before_thousandths integer;
ALTER TABLE bulk_fuel_transactions ADD COLUMN IF NOT EXISTS meter_after_thousandths integer;
