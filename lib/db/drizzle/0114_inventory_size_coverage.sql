ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS coverage_amount double precision;
ALTER TABLE inventory_part_sizes ADD COLUMN IF NOT EXISTS coverage_unit text;
