-- Company head rules are the default for every blueprint.
-- planning_rules stays null until one blueprint stores its own spacing or zone change.
-- Nozzle, throw, arc, and pattern are optional details already kept on the head. Null means they were not stored.

ALTER TABLE blueprint_planning_settings ADD COLUMN IF NOT EXISTS head_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS planning_rules jsonb;
ALTER TABLE blueprint_catalog_links ADD COLUMN IF NOT EXISTS head_type text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS nozzle text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS throw_ft double precision;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS arc_degrees double precision;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pattern text;
