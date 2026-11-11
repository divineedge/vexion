ALTER TABLE tenants ADD COLUMN IF NOT EXISTS budget_data jsonb;

ALTER TABLE services ADD COLUMN IF NOT EXISTS linear_rate real NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS p4p_percentage real;
ALTER TABLE services ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'flat';
ALTER TABLE services ADD COLUMN IF NOT EXISTS hourly_rate real;
ALTER TABLE services ADD COLUMN IF NOT EXISTS minimum_billable_minutes integer;
ALTER TABLE services ADD COLUMN IF NOT EXISTS pricing_matrix jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS linked_zone_type_id text;
ALTER TABLE services ADD COLUMN IF NOT EXISTS off_season_start text;
ALTER TABLE services ADD COLUMN IF NOT EXISTS off_season_end text;
ALTER TABLE services ADD COLUMN IF NOT EXISTS field_requirements jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS payment_policy jsonb;

ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS label_pdf_url text;
ALTER TABLE chemical_products ADD COLUMN IF NOT EXISTS quantity_on_hand real NOT NULL DEFAULT 0;
ALTER TABLE chemical_mixtures ADD COLUMN IF NOT EXISTS tank_capacity_gallons real;
ALTER TABLE chemical_mixtures ADD COLUMN IF NOT EXISTS coverage_sqft real;
ALTER TABLE chemical_mixture_items ADD COLUMN IF NOT EXISTS rate_basis text NOT NULL DEFAULT 'per_gallon';
ALTER TABLE chemical_mixture_items ADD COLUMN IF NOT EXISTS rate_per_1000 real;
