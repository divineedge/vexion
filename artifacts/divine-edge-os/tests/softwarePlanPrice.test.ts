import { describe, expect, it } from 'vitest';
import { parseSoftwarePlanPrice } from '../src/lib/softwareBilling';

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
