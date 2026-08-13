ALTER TABLE estimates ADD COLUMN IF NOT EXISTS payment_requirement text NOT NULL DEFAULT 'none';
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deposit_value real;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deposit_paid_at timestamptz;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deposit_payment_intent_id text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deposit_charged_amount real;
