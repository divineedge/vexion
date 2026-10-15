import { describe, it, expect } from 'vitest';
import type { JobEconomicsJob } from '@workspace/api-client-react';
import { buildGroups, filterJobs, csvCell, validateEconomicsRange, budgetTotalCost } from '../src/lib/jobEconomics';

const job = (o: Partial<JobEconomicsJob>): JobEconomicsJob => ({ id: 1, title: 'J', customerId: 1, customerName: 'C', propertyAddress: null, serviceId: 5, serviceName: 'Mow', serviceIds: [5], completedDate: '2025-01-02', pricingMode: 'matrix', matrixLabel: 'Small', measurement: 1000, measurementUnit: 'sqft', measurementSource: 'snapshot', revenue: 100, budgetRevenue: null, budgetMinutes: null, budgetMaterialCost: null, budgetLaborCost: null, baselineSource: 'none', estimateId: null, minutes: 60, hasOpenTimers: false, laborCost: 30, materialCost: 10, fuelCost: 0, otherCost: 0, knownCost: 40, totalCost: 40, profit: 60, marginPct: 60, multiService: false, materials: [], workers: [], otherCosts: [], issues: [], ...o });

describe('job economics', () => {
  it('filters service 0 as unspecified and constituents', () => {
    const js = [job({ id: 1 }), job({ id: 2, serviceId: null, serviceIds: [] }), job({ id: 3, serviceId: null, serviceIds: [5, 6], multiService: true })];
    expect(filterJobs(js, { customerId: null, serviceId: 0 }).map(j => j.id)).toEqual([2]);
    expect(filterJobs(js, { customerId: null, serviceId: 5 }).map(j => j.id)).toEqual([1, 3]);
  });
  it('uses matching cohorts and never treats missing cost as zero', () => {
    const g = buildGroups([job({ id: 1 }), job({ id: 2, totalCost: null, laborCost: null, measurement: 3000 }), job({ id: 3, hasOpenTimers: true })], 'service')[0];
    expect(g.jobCount).toBe(3); expect(g.timedCount).toBe(2); expect(g.costCompleteCount).toBe(2);
    expect(g.contribution).toBe(120);
    expect(g.sqft.costPerUnit).toBeCloseTo(80 / 2000);
    expect(g.sqft.pricePerUnit).toBeCloseTo(300 / 5000);
    expect(g.sqft.minutesPerUnit).toBeCloseTo(120 / 4000);
  });
  it('separates multi-service and unspecified groups', () => {
    const gs = buildGroups([job({}), job({ id: 2, multiService: true }), job({ id: 3, serviceId: null, serviceIds: [] })], 'service');
    expect(gs.map(g => g.kind).sort()).toEqual(['multi', 'service', 'unspecified']);
    expect(gs.find(g=>g.kind==='multi')?.sqft.measured).toBe(0);
  });
  it('escapes formulas and validates ranges', () => {
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(validateEconomicsRange('2020-01-01', '2025-01-01')).toMatch(/two years/);
    expect(validateEconomicsRange('2025-01-01', '2025-02-01')).toBeNull();
    expect(budgetTotalCost(job({ budgetLaborCost: 5 }))).toBeNull();
  });
});
