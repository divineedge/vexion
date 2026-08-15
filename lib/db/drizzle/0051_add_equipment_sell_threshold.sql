-- Per-unit sell threshold: staff can set a sell-after-hours value or mark the unit as never-sell.
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS sell_after_hours REAL;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS never_sell BOOLEAN NOT NULL DEFAULT FALSE;
