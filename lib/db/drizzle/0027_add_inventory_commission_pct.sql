-- Add salesperson commission percentage to inventory items
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "commission_pct" real;
