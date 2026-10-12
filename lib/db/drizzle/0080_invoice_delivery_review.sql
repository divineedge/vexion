ALTER TABLE tenants ADD COLUMN IF NOT EXISTS invoice_delivery_mode text NOT NULL DEFAULT 'review';
