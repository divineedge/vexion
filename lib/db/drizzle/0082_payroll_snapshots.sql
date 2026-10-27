BEGIN;
CREATE TABLE IF NOT EXISTS payroll_rates (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
 source text NOT NULL, source_id integer NOT NULL, value real,
 effective_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS payroll_rates_lookup ON payroll_rates(tenant_id, source, source_id, effective_at);
CREATE TABLE IF NOT EXISTS payroll_periods (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
 range_start timestamptz NOT NULL, range_end timestamptz NOT NULL,
 approved_by integer NOT NULL, approved_by_name text NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL,
 CHECK (range_end > range_start)
);
CREATE TABLE IF NOT EXISTS payroll_adjustments (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
 period_id integer NOT NULL REFERENCES payroll_periods(id), user_id integer NOT NULL,
 amount numeric(12,2) NOT NULL, reason text NOT NULL, created_by integer NOT NULL,
 created_by_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (amount <> 0 AND length(trim(reason)) > 0)
);
-- Upgrade an already-installed ledger without rewriting its audit records.
-- Decimal cents must survive amounts near the API's $1,000,000 limit.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_schema=current_schema() AND table_name='payroll_adjustments'
     AND column_name='amount' AND data_type <> 'numeric') THEN
   ALTER TABLE payroll_adjustments ALTER COLUMN amount TYPE numeric(12,2)
     USING amount::numeric(12,2);
 END IF;
END $$;

-- Existing rates are the only available baseline, not reconstructed history.
-- Epoch starts the legacy baseline; all subsequent edits are timestamped.
INSERT INTO payroll_rates(tenant_id, source, source_id, value, effective_at)
 SELECT tenant_id, 'hourly', id, hourly_rate, '1970-01-01' FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM payroll_rates r WHERE r.source='hourly' AND r.source_id=u.id AND r.tenant_id=u.tenant_id);
INSERT INTO payroll_rates(tenant_id, source, source_id, value, effective_at)
 SELECT tenant_id, 'service', id, p4p_percentage, '1970-01-01' FROM services s
 WHERE NOT EXISTS (SELECT 1 FROM payroll_rates r WHERE r.source='service' AND r.source_id=s.id AND r.tenant_id=s.tenant_id);
INSERT INTO payroll_rates(tenant_id, source, source_id, value, effective_at)
 SELECT tenant_id, 'blueprint', id, p4p_percentage, '1970-01-01' FROM blueprints b
 WHERE NOT EXISTS (SELECT 1 FROM payroll_rates r WHERE r.source='blueprint' AND r.source_id=b.id AND r.tenant_id=b.tenant_id);
INSERT INTO payroll_rates(tenant_id, source, source_id, value, effective_at)
 SELECT id, 'global', id, p4p_master_percentage, '1970-01-01' FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM payroll_rates r WHERE r.source='global' AND r.source_id=t.id AND r.tenant_id=t.id);

CREATE OR REPLACE FUNCTION record_payroll_rate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_value real; old_value real; tid integer;
BEGIN
 new_value := (to_jsonb(NEW)->>TG_ARGV[1])::real;
 tid := CASE WHEN TG_ARGV[0]='global' THEN NEW.id ELSE (to_jsonb(NEW)->>'tenant_id')::integer END;
 IF TG_OP='UPDATE' THEN
   old_value := (to_jsonb(OLD)->>TG_ARGV[1])::real;
   IF old_value IS NOT DISTINCT FROM new_value THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO payroll_rates(tenant_id, source, source_id, value, effective_at)
 VALUES(tid, TG_ARGV[0], NEW.id, new_value, clock_timestamp());
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_payroll_rate ON users;
CREATE TRIGGER users_payroll_rate AFTER INSERT OR UPDATE OF hourly_rate ON users
 FOR EACH ROW EXECUTE FUNCTION record_payroll_rate('hourly', 'hourly_rate');
DROP TRIGGER IF EXISTS services_payroll_rate ON services;
CREATE TRIGGER services_payroll_rate AFTER INSERT OR UPDATE OF p4p_percentage ON services
 FOR EACH ROW EXECUTE FUNCTION record_payroll_rate('service', 'p4p_percentage');
DROP TRIGGER IF EXISTS blueprints_payroll_rate ON blueprints;
CREATE TRIGGER blueprints_payroll_rate AFTER INSERT OR UPDATE OF p4p_percentage ON blueprints
 FOR EACH ROW EXECUTE FUNCTION record_payroll_rate('blueprint', 'p4p_percentage');
DROP TRIGGER IF EXISTS tenants_payroll_rate ON tenants;
CREATE TRIGGER tenants_payroll_rate AFTER INSERT OR UPDATE OF p4p_master_percentage ON tenants
 FOR EACH ROW EXECUTE FUNCTION record_payroll_rate('global', 'p4p_master_percentage');

CREATE OR REPLACE FUNCTION payroll_rate_at(tid integer, kind text, entity integer, at_time timestamptz)
RETURNS real LANGUAGE sql STABLE AS $$
 SELECT value FROM payroll_rates WHERE tenant_id=tid AND source=kind AND source_id=entity
 AND effective_at <= at_time ORDER BY effective_at DESC, id DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION payroll_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payroll records are append-only; record a separate adjustment'; END $$;
DROP TRIGGER IF EXISTS payroll_periods_immutable ON payroll_periods;
CREATE TRIGGER payroll_periods_immutable BEFORE UPDATE OR DELETE ON payroll_periods
 FOR EACH ROW EXECUTE FUNCTION payroll_immutable();
DROP TRIGGER IF EXISTS payroll_adjustments_immutable ON payroll_adjustments;
CREATE TRIGGER payroll_adjustments_immutable BEFORE UPDATE OR DELETE ON payroll_adjustments
 FOR EACH ROW EXECUTE FUNCTION payroll_immutable();
DROP TRIGGER IF EXISTS payroll_rates_immutable ON payroll_rates;
CREATE TRIGGER payroll_rates_immutable BEFORE UPDATE OR DELETE ON payroll_rates
 FOR EACH ROW EXECUTE FUNCTION payroll_immutable();
ALTER TABLE IF EXISTS platform_billing_settings
 ADD COLUMN IF NOT EXISTS card_fee_min_cents integer,
 ADD COLUMN IF NOT EXISTS card_fee_max_cents integer,
 ADD COLUMN IF NOT EXISTS ach_fee_min_cents integer,
 ADD COLUMN IF NOT EXISTS ach_fee_max_cents integer;
ALTER TABLE IF EXISTS plans
 ADD COLUMN IF NOT EXISTS card_fee_min_cents integer,
 ADD COLUMN IF NOT EXISTS card_fee_max_cents integer,
 ADD COLUMN IF NOT EXISTS ach_fee_min_cents integer,
 ADD COLUMN IF NOT EXISTS ach_fee_max_cents integer;
ALTER TABLE IF EXISTS software_billing_accounts ADD COLUMN IF NOT EXISTS plan_policy jsonb;
ALTER TABLE IF EXISTS software_plan_prices ADD COLUMN IF NOT EXISTS plan_policy jsonb;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS schedule_weather_locations jsonb;
DO $portal_reads$
DECLARE first_install boolean := to_regclass('portal_message_reads') IS NULL;
BEGIN
 CREATE TABLE IF NOT EXISTS portal_message_reads (
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id integer NOT NULL REFERENCES portal_messages(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,message_id,user_id)
 );
 IF first_install THEN
  INSERT INTO portal_message_reads(tenant_id,message_id,user_id,read_at)
   SELECT m.tenant_id,m.id,u.id,m.read_at FROM portal_messages m
   JOIN users u ON u.tenant_id=m.tenant_id AND u.role='company_owner'
   WHERE m.direction='inbound' AND m.read_at IS NOT NULL
   ON CONFLICT DO NOTHING;
 END IF;
END; $portal_reads$;
COMMIT;
