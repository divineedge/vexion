-- Development only, additive. Publish manages production schema.
ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS inventory_receipts jsonb DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS expense_request_once ON expense_entries(tenant_id,request_id);
