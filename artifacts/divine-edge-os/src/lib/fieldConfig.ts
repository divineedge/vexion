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

/**
 * Keys for the three core fields. Their visibility is always locked ON, but
 * businesses can choose whether each is required to submit the form.
 */
export const CORE_FIELD_KEYS = ['name', 'email', 'phone'] as const;

/** Built-in fields that all tenants have — can toggle visible/required */
export const BUILT_IN_CUSTOMER_FIELDS: CustomerFieldConfig[] = [
  // Core fields — always visible, required by default, required is configurable
  { key: 'name',           label: 'Full Name',             type: 'text',     visible: true, required: true,  isBuiltIn: true },
  { key: 'email',          label: 'Email',                 type: 'text',     visible: true, required: true,  isBuiltIn: true },
  { key: 'phone',          label: 'Phone',                 type: 'text',     visible: true, required: true,  isBuiltIn: true },
  // Configurable built-in fields
  { key: 'secondaryPhone', label: 'Secondary Phone',       type: 'text',     visible: true, required: false, isBuiltIn: true },
  { key: 'company',        label: 'Company / Business Name', type: 'text',   visible: true, required: false, isBuiltIn: true },
  { key: 'customerType',   label: 'Customer Type',         type: 'select',   options: ['residential', 'commercial', 'hoa', 'government', 'other'], visible: true, required: false, isBuiltIn: true },
  { key: 'referralSource', label: 'Referral Source',       type: 'select',   options: ['Google', 'Word of Mouth', 'Flyer', 'Repeat Customer', 'Social Media', 'Referral', 'customer_referral', 'Other'], visible: true, required: false, isBuiltIn: true },
  { key: 'billingAddress', label: 'Billing Address',       type: 'text',     visible: true, required: false, isBuiltIn: true },
  { key: 'notes',          label: 'Notes',                 type: 'textarea', visible: true, required: false, isBuiltIn: true },
  { key: 'tags',           label: 'Tags',                  type: 'text',     visible: true, required: false, isBuiltIn: true },
];

/**
 * Merge tenant-stored field overrides with built-in field defaults + custom fields.
 * Returns the full ordered list of active fields.
 */
export function getActiveCustomerFields(settings?: TenantSettings | null): CustomerFieldConfig[] {
  const stored: CustomerFieldConfig[] = settings?.customerFields ?? [];

  // Map stored overrides by key
  const overrides = Object.fromEntries(stored.map(f => [f.key, f]));

  // Built-in fields with overrides applied.
  // Core fields (name/email/phone) always remain visible — only required is overridable.
  const builtIn = BUILT_IN_CUSTOMER_FIELDS.map(f => {
    const override = overrides[f.key];
    if (!override) return f;
    const isCore = (CORE_FIELD_KEYS as readonly string[]).includes(f.key);
    return {
      ...f,
      visible: isCore ? true : override.visible,          // core fields are always visible
      required: override.required,
      label: override.label ?? f.label,
      options: override.options?.length ? override.options : f.options,
    };
  });

  // Custom (non-built-in) fields from settings
  const customFields = stored.filter(f => !BUILT_IN_CUSTOMER_FIELDS.some(b => b.key === f.key));

  return [...builtIn, ...customFields];
}

export function isCustomerFieldVisible(
  fields: CustomerFieldConfig[],
  key: string,
): boolean {
  return fields.some(field => field.isBuiltIn && field.key === key && field.visible);
}
