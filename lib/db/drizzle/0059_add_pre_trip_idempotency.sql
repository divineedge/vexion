ALTER TABLE internal_tasks ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE internal_tasks ADD COLUMN IF NOT EXISTS pre_trip_fuel_log_id integer;
ALTER TABLE internal_tasks ADD COLUMN IF NOT EXISTS pre_trip_reading_log_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS internal_tasks_tenant_idempotency_key_unique
  ON internal_tasks (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;