import { describe, expect, it } from 'vitest';
import type { VendorExpenseDefaultsConfig } from '@workspace/api-client-react';
import { resolveVendorExpenseDefaults } from '../src/lib/vendorExpenseDefaults';

const config: VendorExpenseDefaultsConfig = {
  company: { salesTaxPct: 8.375, shippingAmount: 29.95, capitalizeSalesTax: true, capitalizeShipping: true },
  vendors: [{ vendorId: 17, settings: { salesTaxPct: 0, shippingAmount: null, capitalizeSalesTax: null, capitalizeShipping: false } }],
};

describe('New vendor expense defaults', () => {
  it('uses company values for a manual expense or vendor with no overrides', () => {
    expect(resolveVendorExpenseDefaults(config)).toEqual(config.company);
    expect(resolveVendorExpenseDefaults(config, 123)).toEqual(config.company);
  });
  it('inherits each null independently but respects explicit zero and false', () => {
    expect(resolveVendorExpenseDefaults(config, 17)).toEqual({
      salesTaxPct: 0, shippingAmount: 29.95, capitalizeSalesTax: true, capitalizeShipping: false,
    });
  });
  it('inherits subsequent company changes without changing stored vendor overrides', () => {
    const changed = { ...config, company: { ...config.company, shippingAmount: 12.25, capitalizeSalesTax: false } };
    expect(resolveVendorExpenseDefaults(changed, 17)).toEqual({
      salesTaxPct: 0, shippingAmount: 12.25, capitalizeSalesTax: false, capitalizeShipping: false,
    });
    expect(config.vendors[0].settings.shippingAmount).toBeNull();
  });
  it('returns an independent snapshot so per-expense edits never change defaults', () => {
    const expense = resolveVendorExpenseDefaults(config, 17);
    expense.salesTaxPct = 4.25;
    expense.shippingAmount = 0;
    expect(resolveVendorExpenseDefaults(config, 17).salesTaxPct).toBe(0);
    expect(config.company.shippingAmount).toBe(29.95);
  });
});
