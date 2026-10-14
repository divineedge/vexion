import { describe, it, expect } from 'vitest';
import { defaultBudgetYear, defaultDivision, computeDivision, computeCompanyTotal, migrateBudgetPayload } from '../src/lib/budgetCalc';
import { pricingBudgetRate, recommendedJobPrice } from '../src/lib/pricingBudget';

describe('service-linked pricing budget', () => {
  const year = defaultBudgetYear(2026);
  const lawn = { ...defaultDivision('Lawn'), serviceIds: [11], minimumVisitHours: 2 };
  const landscaping = { ...defaultDivision('Landscaping'), serviceIds: [22], minimumVisitHours: 0.5, avgEmployeeHourlyRate: 35 };
  year.divisions = [lawn, landscaping];

  it('selects a different division for each service automatically', () => {
    expect(pricingBudgetRate(year, 11)?.hourly).toBe(computeDivision(lawn).requiredHourlyRate);
    expect(pricingBudgetRate(year, 22)?.floor).toBe(computeDivision(landscaping).minimumShowUpCost);
    expect(pricingBudgetRate(year, 22)?.label).toContain('Landscaping');
  });
  it('uses the company minimum for unassigned services and explicit company targets', () => {
    const company = computeCompanyTotal(year);
    expect(pricingBudgetRate(year, 99)?.floor).toBe(company.combinedMinimumShowUpCost);
    expect(pricingBudgetRate(year, null)?.floor).toBeGreaterThan(0);
    expect(pricingBudgetRate(year, 11, 'company')?.hourly).toBe(company.combinedRequiredHourlyRate);
    expect(pricingBudgetRate(year, 11, 'company')?.floor).toBe(company.combinedMinimumShowUpCost);
  });
  it('applies the labor minimum before adding material selling prices', () => {
    expect(recommendedJobPrice(0.25, 30, { hourly: 100, floor: 150 })).toBe(180);
    expect(recommendedJobPrice(2, 30, { hourly: 100, floor: 150 })).toBe(230);
  });
  it('supports explicit division overrides and fails closed for missing or ambiguous divisions', () => {
    expect(pricingBudgetRate(year, 22, lawn.id)?.label).toContain('Lawn');
    expect(pricingBudgetRate(year, 11, 'missing')).toBeNull();
    expect(pricingBudgetRate(undefined, 11)).toBeNull();
    expect(pricingBudgetRate({ ...year, divisions: [lawn, { ...landscaping, serviceIds: [11] }] }, 11)).toBeNull();
  });
  it('preserves zero minimum hours, service assignments and legacy budget data on reload', () => {
    const loaded = migrateBudgetPayload({ ...year, divisions: [{ ...lawn, minimumVisitHours: 0 }] });
    expect(loaded[0].divisions[0].serviceIds).toEqual([11]);
    expect(loaded[0].divisions[0].minimumVisitHours).toBe(0);
    expect(pricingBudgetRate(loaded[0], 11)?.floor).toBe(0);
    const legacy = migrateBudgetPayload({ year: 2025, name: 'Legacy', minimumVisitHours: 0.75 });
    expect(legacy[0].divisions[0].serviceIds).toEqual([]);
    expect(legacy[0].divisions[0].minimumVisitHours).toBe(0.75);
  });
  it('uses the assignment belonging to the selected budget year', () => {
    const previous = { ...year, year: 2025, divisions: [{ ...landscaping, serviceIds: [11] }] };
    expect(pricingBudgetRate(previous, 11)?.label).toContain('2025 Landscaping');
    expect(pricingBudgetRate(year, 11)?.label).toContain('2026 Lawn');
  });
});
