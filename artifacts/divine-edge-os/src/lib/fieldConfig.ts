/**
 * Customer field configuration — controls which fields appear on customer forms
 * and their required/visible status. Driven by tenant settings.
 *
 * Uses the generated CustomerFieldConfig and TenantSettings types from the API
 * client so there is a single source of truth for the shape.
 */

export type {
  CustomerFieldConfig,
  TenantSettings,
} from "@workspace/api-client-react";
import type { CustomerFieldConfig, TenantSettings } from "@workspace/api-client-react";

/** Built-in fields that all tenants have — can toggle visible/required */
export const BUILT_IN_CUSTOMER_FIELDS: CustomerFieldConfig[] = [
  { key: 'secondaryPhone', label: 'Secondary Phone', type: 'text', visible: true, required: false, isBuiltIn: true },
  { key: 'company', label: 'Company / Business Name', type: 'text', visible: true, required: false, isBuiltIn: true },
  { key: 'customerType', label: 'Customer Type', type: 'select', options: ['residential', 'commercial', 'hoa', 'government', 'other'], visible: true, required: false, isBuiltIn: true },
  { key: 'referralSource', label: 'Referral Source', type: 'select', options: ['Google', 'Word of Mouth', 'Flyer', 'Repeat Customer', 'Social Media', 'Referral', 'Other'], visible: true, required: false, isBuiltIn: true },
  { key: 'billingAddress', label: 'Billing Address', type: 'text', visible: true, required: false, isBuiltIn: true },
  { key: 'notes', label: 'Notes', type: 'textarea', visible: true, required: false, isBuiltIn: true },
  { key: 'tags', label: 'Tags', type: 'text', visible: true, required: false, isBuiltIn: true },
];

/**
 * Merge tenant-stored field overrides with built-in field defaults + custom fields.
 * Returns the full ordered list of active fields.
 */
export function getActiveCustomerFields(settings?: TenantSettings | null): CustomerFieldConfig[] {
  const stored: CustomerFieldConfig[] = settings?.customerFields ?? [];

  // Map stored overrides by key
  const overrides = Object.fromEntries(stored.map(f => [f.key, f]));

  // Built-in fields with overrides applied
  const builtIn = BUILT_IN_CUSTOMER_FIELDS.map(f => ({
    ...f,
    ...(overrides[f.key] ? {
      visible: overrides[f.key].visible,
      required: overrides[f.key].required,
      label: overrides[f.key].label ?? f.label,
    } : {}),
  }));

  // Custom (non-built-in) fields from settings
  const customFields = stored.filter(f => !BUILT_IN_CUSTOMER_FIELDS.some(b => b.key === f.key));

  return [...builtIn, ...customFields];
}
