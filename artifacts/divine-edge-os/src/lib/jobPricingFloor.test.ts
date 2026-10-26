import { describe, expect, it } from 'vitest';
import { calculateJobPricingFloor, defaultJobPricingFloor, restoreJobPricingFloor } from './jobPricingFloor';
import { migrateBudgetPayload } from './budgetCalc';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

describe('stop pricing floor', () => {
  it('pays for all clock time and recovers overhead only through billable on-site time', () => {
    const { result } = calculateJobPricingFloor(defaultJobPricingFloor());
    expect(result!.burdenedWage).toBeCloseTo(28.75);
    expect(result!.crewLaborHourly).toBeCloseTo(28.75);
    expect(result!.laborCost).toBeCloseTo(28.75);
    expect(result).toMatchObject({
      overheadPerBillableHour: 25, totalClockMinutes: 60,
      overheadShare: 18.75,
      breakEvenFloor: 47.5, recommendedMinimum: 59.38,
    });
    expect(result!.trueHourlyCost).toBeCloseTo(63.33333333);
    expect(result!.costPerClockMinute).toBeCloseTo(47.5 / 60);
    expect(result!.revenuePerClockMinute).toBeCloseTo(59.38 / 60);
    expect(result!.profitAtMinimum / result!.recommendedMinimum).toBeGreaterThanOrEqual(0.2);
  });
  it('multiplies labor, never company overhead, by crew members', () => {
    const { result } = calculateJobPricingFloor({ ...defaultJobPricingFloor(), crewMembers: 2 });
    expect(result!.laborCost).toBeCloseTo(57.5);
    expect(result!.overheadShare).toBe(18.75);
    expect(result!.breakEvenFloor).toBe(76.25);
    expect(result!.recommendedMinimum).toBe(95.32);
  });
  it('allocates more travel labor without allocating overhead twice', () => {
    const a = calculateJobPricingFloor(defaultJobPricingFloor()).result!;
    const b = calculateJobPricingFloor({ ...defaultJobPricingFloor(), driveSetupMinutes: 45 }).result!;
    expect(b.overheadShare).toBe(a.overheadShare);
    expect(b.laborCost - a.laborCost).toBeCloseTo(28.75 / 2);
  });
  it('uses a revenue margin, not a cost markup', () => {
    const { result } = calculateJobPricingFloor({
      ...defaultJobPricingFloor(), hourlyWage: 100, payrollBurdenPct: 0,
      onSiteMinutes: 60, driveSetupMinutes: 0, monthlyOverhead: 0,
    });
    expect(result!.breakEvenFloor).toBe(100);
    expect(result!.recommendedMinimum).toBe(125);
  });
  it('accepts zero margin, no overhead, and adds direct costs exactly once', () => {
    const { result } = calculateJobPricingFloor({
      ...defaultJobPricingFloor(), targetMarginPct: 0, monthlyOverhead: 0, directJobCosts: 10,
    });
    expect(result!.breakEvenFloor).toBe(38.75);
    expect(result!.recommendedMinimum).toBe(38.75);
  });
  it.each([
    { monthlyBillableHours: 0 }, { onSiteMinutes: 0 }, { hourlyWage: -1 },
    { crewMembers: 0 }, { crewMembers: 1.5 }, { targetMarginPct: 100 },
    { targetMarginPct: -1 }, { monthlyOverhead: Infinity }, { onSiteMinutes: NaN },
    { driveSetupMinutes: -1 }, { directJobCosts: -1 },
    { monthlyOverhead: Number.MAX_VALUE, onSiteMinutes: Number.MAX_VALUE },
  ])('rejects invalid inputs without showing a fake floor: %j', change => {
    const calc = calculateJobPricingFloor({ ...defaultJobPricingFloor(), ...change });
    expect(calc.result).toBeNull();
    expect(calc.errors.length).toBeGreaterThan(0);
  });
  it('retains a scenario through budget save/reload migration and preserves annual budgets', () => {
    const original = migrateBudgetPayload({ year: 2026 });
    const saved = original.map(year => ({ ...year, jobPricingFloor: defaultJobPricingFloor() }));
    const reloaded = migrateBudgetPayload(JSON.parse(JSON.stringify(saved)));
    expect(reloaded[0].jobPricingFloor).toEqual(defaultJobPricingFloor());
    expect(reloaded[0].divisions).toEqual(original[0].divisions);
    expect(original[0].jobPricingFloor).toBeUndefined();
    expect(restoreJobPricingFloor({ ...defaultJobPricingFloor(), crewMembers: 0 })).toBeUndefined();
  });
  it('keeps the self-contained calculator consistent with the app', () => {
    const html = readFileSync(new URL('../../public/job-pricing-floor.html', import.meta.url), 'utf8');
    const pureMath = html.match(/\/\* MATH START \*\/([\s\S]*?)\/\* MATH END \*\//)?.[1];
    expect(pureMath).toBeTruthy();
    const calculate = runInNewContext(`${pureMath}; calculate;`);
    for (const change of [
      {}, { crewMembers: 3 }, { driveSetupMinutes: 0 }, { directJobCosts: 45.19 },
      { targetMarginPct: 0 }, { targetMarginPct: 99.5 }, { monthlyBillableHours: 0 },
      { onSiteMinutes: 0 }, { crewMembers: 1.2 }, { hourlyWage: NaN },
      { monthlyOverhead: Number.MAX_VALUE, onSiteMinutes: Number.MAX_VALUE },
    ]) {
      const input = { ...defaultJobPricingFloor(), ...change };
      const expected = calculateJobPricingFloor(input);
      const actual = calculate(input);
      expect(!!actual.result).toBe(!!expected.result);
      if (expected.result) {
        for (const [key, value] of Object.entries(expected.result)) {
          expect(actual.result[key]).toBeCloseTo(value, 9);
        }
      }
    }
  });
});
