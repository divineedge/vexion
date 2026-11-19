ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS inventory_item_id integer REFERENCES inventory_items(id) ON DELETE SET NULL;
ALTER TABLE chemical_applications ADD COLUMN IF NOT EXISTS inventory_deductions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE inventory_items ALTER COLUMN quantity TYPE double precision USING quantity::double precision;
ALTER TABLE inventory_cost_lots ALTER COLUMN received_quantity TYPE double precision USING received_quantity::double precision;
ALTER TABLE inventory_cost_lots ALTER COLUMN remaining_quantity TYPE double precision USING remaining_quantity::double precision;
