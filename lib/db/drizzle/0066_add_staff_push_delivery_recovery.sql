ALTER TABLE staff_push_deliveries
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS data jsonb,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

-- Existing rows predate persisted payloads. They are terminal historical rows;
-- new delivery rows always receive non-null payloads from the application.
UPDATE staff_push_deliveries SET title = '' WHERE title IS NULL;
UPDATE staff_push_deliveries SET body = '' WHERE body IS NULL;
UPDATE staff_push_deliveries SET data = '{}'::jsonb WHERE data IS NULL;
ALTER TABLE staff_push_deliveries
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN body SET NOT NULL,
  ALTER COLUMN data SET NOT NULL;

CREATE INDEX IF NOT EXISTS staff_push_deliveries_retry_idx
  ON staff_push_deliveries (status, next_attempt_at, claim_expires_at);