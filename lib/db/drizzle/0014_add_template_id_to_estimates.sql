ALTER TABLE estimates ADD COLUMN IF NOT EXISTS template_id integer REFERENCES estimate_templates(id);
