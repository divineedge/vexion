import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function installP4pDamageSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS p4p_damage_reports (
      id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
      title text NOT NULL, description text NOT NULL,
      occurred_on date NOT NULL, payroll_date date NOT NULL, job_id integer,
      allocations jsonb NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','void')),
      created_by integer NOT NULL, created_by_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      approved_by integer, approved_by_name text, approved_at timestamptz, decision_reason text,
      voided_by integer, voided_by_name text, voided_at timestamptz, void_reason text,
      payroll_period_id integer REFERENCES payroll_periods(id)
    );
    CREATE INDEX IF NOT EXISTS p4p_damage_tenant_date ON p4p_damage_reports(tenant_id,payroll_date);
    CREATE OR REPLACE FUNCTION protect_finalized_p4p_damage() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Damage records are retained; void an unfinalized report instead';
      END IF;
      IF OLD.payroll_period_id IS NOT NULL THEN
        RAISE EXCEPTION 'Finalized damage records are immutable; use an audited payroll correction';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS protect_finalized_p4p_damage ON p4p_damage_reports;
    CREATE TRIGGER protect_finalized_p4p_damage BEFORE UPDATE OR DELETE ON p4p_damage_reports
      FOR EACH ROW EXECUTE FUNCTION protect_finalized_p4p_damage();
  `);
}

const cents = (value: number) => Math.round(value * 100);

/** Performance adjustments never reduce hourly guarantees or unrelated bonuses. */
export function calculateDamagePay(p4pEarnings: number, basePay: number | null, damage: number, bonus = 0) {
  const before = Math.max(0, cents(p4pEarnings));
  const deduction = Math.max(0, cents(damage));
  const after = Math.max(0, before - deduction);
  const guarantee = basePay == null ? null : Math.max(0, cents(basePay));
  return {
    p4pBeforeDamage: before / 100,
    damageDeduction: deduction / 100,
    p4pEarnings: after / 100,
    damagePayReduction: guarantee == null ? null : (Math.max(guarantee, before) - Math.max(guarantee, after)) / 100,
    grossPay: guarantee == null ? null : (Math.max(guarantee, after) + cents(bonus)) / 100,
  };
}
