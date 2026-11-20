ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS stock_alerts boolean NOT NULL DEFAULT true;

ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS volume_amount double precision;
ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS volume_unit text;
