import type { VendorExpenseDefaultsConfig, VendorExpenseDefaultValues } from '@workspace/api-client-react';

export function resolveVendorExpenseDefaults(config: VendorExpenseDefaultsConfig, vendorId?: number | null): VendorExpenseDefaultValues {
  const override = config.vendors.find(row => row.vendorId === vendorId)?.settings;
  return {
    salesTaxPct: override?.salesTaxPct ?? config.company.salesTaxPct,
    shippingAmount: override?.shippingAmount ?? config.company.shippingAmount,
    capitalizeSalesTax: override?.capitalizeSalesTax ?? config.company.capitalizeSalesTax,
    capitalizeShipping: override?.capitalizeShipping ?? config.company.capitalizeShipping,
  };
}
