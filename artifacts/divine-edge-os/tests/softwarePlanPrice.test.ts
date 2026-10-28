import { describe, expect, it } from 'vitest';
import { parseSoftwarePlanPrice, annualPlanDefaults, resolveFeatures } from '../src/lib/softwareBilling';

describe('software plan price', () => {
  it.each(['0', '0.0', '0.00', ' 0 '])('accepts a free plan entered as %s', value => {
    expect(parseSoftwarePlanPrice(value)).toBe(0);
  });
  it.each([['49', 49], ['149.95', 149.95], ['100000.00', 100000]])('accepts %s', (value, expected) => {
    expect(parseSoftwarePlanPrice(String(value))).toBe(expected);
  });
  it.each(['', ' ', '-1', '1.001', '100000.01', 'Infinity', 'abc', '1e2'])('rejects invalid price %s', value => {
    expect(typeof parseSoftwarePlanPrice(value)).toBe('string');
  });
});

describe('annual plans and complete feature display', () => {
  it('suggests a yearly total without modifying the monthly plan', () => {
    const monthly = { name: 'Pro', tier: 'pro', price: 49.95 };
    expect(annualPlanDefaults(monthly)).toEqual({ name: 'Pro — Annual', tier: 'pro_annual', price: '599.40', billingInterval: 'year' });
    expect(monthly.price).toBe(49.95);
    expect(annualPlanDefaults({ ...monthly, price: 0 }).price).toBe('0.00');
  });
  it('does not silently cap annual prices beyond the API maximum', () => {
    expect(annualPlanDefaults({ name: 'Pro', tier: 'pro', price: 10000 }).price).toBe('');
  });
  it('shows always-included essentials alongside selected modules once', () => {
    const catalog = [{ key: 'invoices', label: 'Invoices', description: '' }, { key: 'core_clock', label: 'Time tracking', description: '', alwaysIncluded: true }];
    expect(resolveFeatures(['invoices', 'invoices'], catalog).mapped.map(f => f.key)).toEqual(['invoices', 'core_clock']);
  });
});
