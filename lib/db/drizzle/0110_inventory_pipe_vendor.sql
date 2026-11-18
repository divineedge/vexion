ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS length_received real;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS price_per_foot real;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS vendor_id integer REFERENCES vendors(id) ON DELETE SET NULL;
