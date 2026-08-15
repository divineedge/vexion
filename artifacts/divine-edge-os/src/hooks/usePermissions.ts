import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';

/** All permission keys — mirrors server-side ALL_PERMISSION_KEYS */
export const ALL_PERMISSION_KEYS = [
  "pages.billing",
  "pages.reports",
  "pages.equipment",
  "pages.services",
  "customerInfo.phone",
  "customerInfo.email",
  "financials.invoiceAmounts",
  "financials.jobPrices",
  "financials.costData",
  "actions.createJobs",
  "actions.editCustomers",
  "actions.addEquipment",
  "actions.manageEquipment",
  "actions.manageServices",
  "callbacks.seeAll",
  "tasks.seeAll",
] as const;

export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

/** Default restrictions per role when the tenant has no explicit config */
export const ROLE_DEFAULTS: Record<string, Partial<Record<PermissionKey, boolean>>> = {
  office_manager: {},
  department_manager: {},
  crew_manager: {
    "pages.billing": false,
    "pages.reports": false,
    "financials.costData": false,
    "callbacks.seeAll": false,
    "tasks.seeAll": false,
  },
  technician: {
    "pages.billing": false,
    "pages.reports": false,
    "pages.services": false,
    "financials.invoiceAmounts": false,
    "financials.jobPrices": false,
    "financials.costData": false,
    "actions.createJobs": false,
    "actions.editCustomers": false,
    "actions.addEquipment": false,
    "actions.manageEquipment": false,
    "actions.manageServices": false,
    "callbacks.seeAll": false,
    "tasks.seeAll": false,
  },
};

function resolvePermission(
  role: string,
  permissionKey: PermissionKey,
  tenantPerms: Record<string, Record<string, boolean>> | null
): boolean {
  if (role === 'company_owner') return true;
  const roleConfig = tenantPerms?.[role];
  if (roleConfig && permissionKey in roleConfig) return roleConfig[permissionKey];
  const defaults = ROLE_DEFAULTS[role] ?? {};
  if (permissionKey in defaults) return defaults[permissionKey as PermissionKey] ?? true;
  return true;
}

/**
 * Returns a `can(permissionKey)` function for the current user's role.
 * Always returns `true` for company_owner.
 * Settings are loaded from the tenant rolePermissions JSONB via React Query (cached).
 */
export function usePermissions() {
  const { user } = useAuth();
  const { data: settings } = useGetTenantSettings({
    query: { queryKey: getGetTenantSettingsQueryKey() },
  });

  const role = user?.role ?? 'technician';
  const tenantPerms = (settings as any)?.rolePermissions as Record<string, Record<string, boolean>> | null ?? null;

  const permissions = useMemo(() => {
    const map = {} as Record<PermissionKey, boolean>;
    for (const key of ALL_PERMISSION_KEYS) {
      map[key] = resolvePermission(role, key, tenantPerms);
    }
    return map;
  }, [role, JSON.stringify(tenantPerms)]);

  const can = (key: PermissionKey): boolean => permissions[key] ?? true;

  return { can, permissions, ROLE_DEFAULTS, ALL_PERMISSION_KEYS };
}

/** Standalone helper to build permission map without the hook (for settings component) */
export function buildEffectivePermissions(
  role: string,
  tenantPerms: Record<string, Record<string, boolean>> | null
): Record<PermissionKey, boolean> {
  const result = {} as Record<PermissionKey, boolean>;
  for (const key of ALL_PERMISSION_KEYS) {
    result[key] = resolvePermission(role, key, tenantPerms);
  }
  return result;
}
