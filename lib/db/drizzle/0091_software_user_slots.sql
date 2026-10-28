ALTER TABLE IF EXISTS plans ADD COLUMN IF NOT EXISTS extra_user_price_cents integer CHECK (extra_user_price_cents >= 0);
ALTER TABLE IF EXISTS software_billing_accounts ADD COLUMN IF NOT EXISTS additional_user_slots integer NOT NULL DEFAULT 0 CHECK (additional_user_slots >= 0);
