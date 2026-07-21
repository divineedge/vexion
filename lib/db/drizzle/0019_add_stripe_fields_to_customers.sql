-- Add Stripe integration columns to customers so the app can store a Stripe
-- Customer ID and a default saved PaymentMethod for off-session charges
-- (e.g. auto-billing when a customer accepts an estimate).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_default_payment_method_id text;
