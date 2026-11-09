-- Require Deposit Before Scheduling stores its own amount inside tenants.payment_policy.estimate_deposit_settings:
-- scheduling_deposit_type = 'percent' | 'fixed'
-- scheduling_deposit_value = number
-- A missing key falls back to the company default deposit. A fixed amount is capped at the estimate total.
COMMENT ON COLUMN tenants.payment_policy IS 'Company JSON. estimate_deposit_settings includes scheduling_deposit_type (percent|fixed) and scheduling_deposit_value, plus the default deposit, rules, and requireBeforeScheduling.';
