import { and, eq } from "drizzle-orm";
import { db, visitsTable } from "@workspace/db";
import { ADMIN_ROLES, getCallerRole } from "./roles";

const MANAGEMENT_ROLES = new Set(["owner", "admin", "manager", "admin_office", "crew_manager"]);

/** Staff managers can view tenant visits; field staff can view only their own. */
export async function canAccessVisit(tenantId: number, userId: number, visitId: number): Promise<boolean> {
  const role = await getCallerRole(tenantId, userId);
  const [visit] = await db.select({ assigneeId: visitsTable.assigneeId }).from(visitsTable).where(and(
    eq(visitsTable.id, visitId), eq(visitsTable.tenantId, tenantId),
  )).limit(1);
  if (!visit) return false;
  return ADMIN_ROLES.has(role) || MANAGEMENT_ROLES.has(role) || visit.assigneeId === userId;
}