import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

/**
 * Hard-coded defaults per role. A false entry means the permission is OFF by default.
 * Anything not listed here defaults to true (allowed).
 * Owner always bypasses this — never call checkPermission for company_owner.
 */
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

/**
 * Check a single permission for a role, merging tenant config over defaults.
 * Owner always returns true without a DB lookup.
 */
export async function checkPermission(
  tenantId: number,
  role: string,
  permissionKey: PermissionKey
): Promise<boolean> {
  if (role === "company_owner") return true;

  const [tenant] = await db
    .select({ rolePermissions: tenantsTable.rolePermissions })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));

  const tenantPerms = tenant?.rolePermissions as Record<string, Record<string, boolean>> | null;
  return resolvePermission(role, permissionKey, tenantPerms);
}

/**
 * Synchronous resolve — given already-loaded tenant rolePermissions JSONB.
 * Used where the caller already has the tenant row.
 */
export function resolvePermission(
  role: string,
  permissionKey: PermissionKey,
  tenantPerms: Record<string, Record<string, boolean>> | null
): boolean {
  if (role === "company_owner") return true;

  const roleConfig = tenantPerms?.[role];
  if (roleConfig && permissionKey in roleConfig) {
    return roleConfig[permissionKey];
  }

  const defaults = ROLE_DEFAULTS[role] ?? {};
  if (permissionKey in defaults) {
    return defaults[permissionKey as PermissionKey] ?? true;
  }

  return true;
}

/**
 * Build the full effective permission map for a role (all keys resolved).
 * Used by the frontend to get a permissions object at login time.
 */
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
