-- Require Deposit to Schedule is stored on the existing company settings document.
-- tenants.payment_policy.scheduleDeposit = {"enabled": boolean, "mode": "fixed"|"percent", "value": number|null}
-- Estimate deposit defaults and depositRules stay in the same document and are edited under Estimate Settings.
COMMENT ON COLUMN tenants.payment_policy IS 'Company billing JSON. depositType, depositValue, requirePrepay, requireCard, and depositRules are Estimate Settings. scheduleDeposit is Require Deposit to Schedule.';
