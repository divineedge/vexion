-- All company deposit settings are edited under Estimate Settings and stored on tenants.payment_policy:
-- depositType, depositValue, requirePrepay, requireCard = company default
-- depositRules = deposit rules by estimate
-- scheduleDeposit = {"enabled": boolean, "mode": "fixed"|"percent", "value": number|null}
COMMENT ON COLUMN tenants.payment_policy IS 'Estimate Settings deposits: depositType, depositValue, requirePrepay, requireCard, depositRules, and scheduleDeposit (Require Deposit to Schedule).';
