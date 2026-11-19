ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS stock_item_id integer REFERENCES inventory_items(id);
CREATE INDEX IF NOT EXISTS inventory_items_stock_item_idx ON inventory_items (stock_item_id);
