import { describe, it, expect } from 'vitest';
import { budgetServiceLinks } from './budgetServiceLinks';

describe('budget service assignments', () => {
  it('accepts old budgets without changing their fields', () => {
    expect(budgetServiceLinks({ year: 2025, minimumVisitHours: 2 })).toEqual([]);
  });
  it('collects unique service IDs across years while allowing reassignment in another year', () => {
    expect(budgetServiceLinks([
      { year: 2025, divisions: [{ serviceIds: [1, 2] }] },
      { year: 2026, divisions: [{ serviceIds: [1] }, { serviceIds: [3] }] },
    ])).toEqual([1, 2, 3]);
  });
  it('rejects ambiguous assignments, including duplicate year records', () => {
    expect(() => budgetServiceLinks({ year: 2026, divisions: [{ serviceIds: [1] }, { serviceIds: [1] }] })).toThrow('only one division');
    expect(() => budgetServiceLinks([{ year: 2026, serviceIds: [1] }, { year: 2026, serviceIds: [1] }])).toThrow();
  });
  it('rejects malformed IDs and assignment lists', () => {
    for (const ids of [[0], [-1], [1.1], ['1'], null, {}]) {
      expect(() => budgetServiceLinks({ divisions: [{ serviceIds: ids }] })).toThrow();
    }
  });
});
