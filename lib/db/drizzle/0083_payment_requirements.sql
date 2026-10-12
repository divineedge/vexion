ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_policy jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_policy jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS payment_policy jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit_applied real NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit_estimate_id integer;
ALTER TABLE task_notifications ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_period_start timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS plan_period_end timestamptz;
