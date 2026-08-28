ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS physical_address TEXT,
  ADD COLUMN IF NOT EXISTS physical_city TEXT,
  ADD COLUMN IF NOT EXISTS physical_state TEXT,
  ADD COLUMN IF NOT EXISTS physical_zip TEXT;