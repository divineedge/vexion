ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_card_on_acceptance boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_prepayment_on_acceptance boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.require_card_on_acceptance IS 'When true, estimate acceptance also requires require_prepayment_on_acceptance. The customer must save a card.';
COMMENT ON COLUMN tenants.require_prepayment_on_acceptance IS 'When true, estimate acceptance also requires require_card_on_acceptance. The customer must pay the deposit or the full total.';
