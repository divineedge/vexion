import { db, vendorExpenseDefaultsTable } from '@workspace/db';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

export const vendorExpenseDefaultsPatchSchema = z.object({
  salesTaxPct: z.number().finite().min(0).max(100).nullable().optional(),
  shippingAmount: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
  capitalizeSalesTax: z.boolean().nullable().optional(),
  capitalizeShipping: z.boolean().nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Choose at least one default');

export async function installVendorExpenseDefaultsSchema() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS vendor_expense_defaults (
    tenant_id integer NOT NULL REFERENCES tenants(id),
    vendor_id integer NOT NULL DEFAULT 0 CHECK (vendor_id >= 0),
    sales_tax_pct double precision CHECK (sales_tax_pct BETWEEN 0 AND 100),
    shipping_amount double precision CHECK (shipping_amount BETWEEN 0 AND 1000000000),
    capitalize_sales_tax boolean,
    capitalize_shipping boolean,
    PRIMARY KEY (tenant_id, vendor_id)
  )`);
}

export async function readVendorExpenseDefaults(tenantId: number) {
  const rows = await db.select().from(vendorExpenseDefaultsTable)
    .where(eq(vendorExpenseDefaultsTable.tenantId, tenantId));
  const company = rows.find(row => row.vendorId === 0);
  return {
    company: {
      salesTaxPct: company?.salesTaxPct ?? 0,
      shippingAmount: company?.shippingAmount ?? 0,
      capitalizeSalesTax: company?.capitalizeSalesTax ?? false,
      capitalizeShipping: company?.capitalizeShipping ?? false,
    },
    vendors: rows.filter(row => row.vendorId > 0).map(({ tenantId: _, vendorId, ...settings }) => ({ vendorId, settings })),
  };
}
