-- Additive: historic inventory and equipment costs remain untouched.
BEGIN;
ALTER TABLE bulk_fuel_transactions
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS actor_id integer,
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS before_thousandths integer,
  ADD COLUMN IF NOT EXISTS after_thousandths integer,
  ADD COLUMN IF NOT EXISTS before_value_cents integer,
  ADD COLUMN IF NOT EXISTS after_value_cents integer,
  ADD COLUMN IF NOT EXISTS expected_movement_id integer;
ALTER TABLE bulk_fuel_transactions
  DROP CONSTRAINT IF EXISTS bulk_fuel_transactions_type_check;
ALTER TABLE bulk_fuel_transactions
  ADD CONSTRAINT bulk_fuel_transactions_type_check
  CHECK (type IN ('delivery', 'opening_balance', 'dispense', 'reversal', 'adjustment'));
-- Historic rows remain valid; every new adjustment must carry its audit and deltas.
ALTER TABLE bulk_fuel_transactions
  DROP CONSTRAINT IF EXISTS bulk_fuel_adjustment_audit_check;
ALTER TABLE bulk_fuel_transactions
  ADD CONSTRAINT bulk_fuel_adjustment_audit_check CHECK (type <> 'adjustment' OR (
    reason IS NOT NULL AND length(trim(reason)) > 0 AND actor_id IS NOT NULL AND actor_name IS NOT NULL
    AND before_thousandths IS NOT NULL AND after_thousandths IS NOT NULL
    AND before_value_cents IS NOT NULL AND after_value_cents IS NOT NULL
    AND before_thousandths >= 0 AND after_thousandths >= 0
    AND before_value_cents >= 0 AND after_value_cents >= 0
    AND gallons_thousandths = after_thousandths - before_thousandths
    AND total_cost_cents = after_value_cents - before_value_cents
    AND expected_movement_id IS NOT NULL AND idempotency_key IS NOT NULL
    AND equipment_id IS NULL AND fuel_log_id IS NULL
  ));
COMMIT;