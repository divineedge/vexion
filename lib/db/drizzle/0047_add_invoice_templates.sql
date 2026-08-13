-- Create invoice_templates table
CREATE TABLE IF NOT EXISTS invoice_templates (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT 'clean',
    line_items JSONB NOT NULL DEFAULT '[]',
    terms_text TEXT,
    late_fee_enabled BOOLEAN NOT NULL DEFAULT false,
    late_fee_type TEXT,
    late_fee_amount REAL,
    late_fee_days_grace INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add template-related columns to invoices
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS invoice_template_id INTEGER,
    ADD COLUMN IF NOT EXISTS layout TEXT DEFAULT 'clean',
    ADD COLUMN IF NOT EXISTS terms_text TEXT,
    ADD COLUMN IF NOT EXISTS late_fee_enabled BOOLEAN,
    ADD COLUMN IF NOT EXISTS late_fee_type TEXT,
    ADD COLUMN IF NOT EXISTS late_fee_amount REAL,
    ADD COLUMN IF NOT EXISTS late_fee_days_grace INTEGER;

-- Add default template FK to tenants
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS default_invoice_template_id INTEGER;
