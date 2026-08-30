ALTER TABLE staff_push_deliveries
  ADD COLUMN IF NOT EXISTS expo_ticket_id text,
  ADD COLUMN IF NOT EXISTS receipt_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS staff_push_deliveries_receipt_idx
  ON staff_push_deliveries (status, expo_ticket_id);