-- Company deposit configuration is edited under Estimate Settings and stored at
-- tenants.payment_policy.estimate_deposit_settings:
-- enabled, defaultType (fixed|percent), defaultAmount, requireBeforeScheduling, allowEstimateOverrides, rules.
-- Legacy depositType, depositValue, depositRules, and scheduleDeposit keys are mirrored from that object.
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deposit_override boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN tenants.payment_policy IS 'Company JSON. estimate_deposit_settings is the Estimate Settings deposit document (enabled, defaultType, defaultAmount, requireBeforeScheduling, allowEstimateOverrides, rules). depositType, depositValue, depositRules, and scheduleDeposit mirror it.';
