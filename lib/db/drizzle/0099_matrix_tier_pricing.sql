CREATE TABLE IF NOT EXISTS matrix_pricing_rules (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  service_id integer NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  basis text NOT NULL DEFAULT 'area',
  price_rounding text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matrix_pricing_rules_service_unique UNIQUE (service_id)
);

CREATE TABLE IF NOT EXISTS matrix_tiers (
  id serial PRIMARY KEY,
  rule_id integer NOT NULL REFERENCES matrix_pricing_rules(id) ON DELETE CASCADE,
  position integer NOT NULL,
  min_quantity real NOT NULL,
  max_quantity real,
  calculation_mode text NOT NULL DEFAULT 'flat',
  base_price real NOT NULL DEFAULT 0,
  unit_rate real,
  per_linear_ft_rate real,
  estimated_minutes integer,
  CONSTRAINT matrix_tiers_rule_position_unique UNIQUE (rule_id, position)
);

COMMENT ON TABLE matrix_pricing_rules IS 'Service matrix pricing: basis (area, linear, both) and price rounding (none, nearest_1, nearest_5, nearest_10).';
COMMENT ON TABLE matrix_tiers IS 'Unlimited tiers. calculation_mode is flat or per_unit_above_base. The last tier leaves max_quantity null so it covers anything above its minimum.';
