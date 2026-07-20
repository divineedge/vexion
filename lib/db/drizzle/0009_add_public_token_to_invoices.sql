-- Add public_token column to invoices for shareable no-login invoice view
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS public_token text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_token_unique ON invoices (public_token) WHERE public_token IS NOT NULL;
