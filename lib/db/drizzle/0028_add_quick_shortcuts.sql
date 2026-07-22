ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "quick_shortcuts" jsonb DEFAULT '["new-job","new-customer","new-invoice"]';
