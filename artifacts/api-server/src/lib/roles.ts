import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/** Roles that can manage office/company-wide settings — mirrors `canManageOffice` in the frontend AuthContext. */
export const ADMIN_ROLES = new Set(["company_owner", "office_manager", "department_manager"]);

export async function getCallerRole(tenantId: number, userId: number): Promise<string> {
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  return u?.role ?? "technician";
}

export async function isAdminRole(tenantId: number, userId: number): Promise<boolean> {
  const role = await getCallerRole(tenantId, userId);
  return ADMIN_ROLES.has(role);
}

/** Strictly the company owner — used to gate destructive/simulation-only tooling (Dev/Test Panel). */
export async function isOwnerRole(tenantId: number, userId: number): Promise<boolean> {
  const role = await getCallerRole(tenantId, userId);
  return role === "company_owner";
}
