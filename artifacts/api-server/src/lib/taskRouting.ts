import { db, usersTable, crewsTable, crewMembersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { ADMIN_ROLES, getCallerRole } from "./roles";

export const TASK_ROLE_BUCKETS = ["admin_office", "manager", "technician"] as const;
export type TaskRoleBucket = (typeof TASK_ROLE_BUCKETS)[number];

/** Maps a role bucket used for task assignment to the concrete user.role values it matches. */
export function roleBucketMatches(bucket: string, role: string): boolean {
  if (bucket === "admin_office") return ADMIN_ROLES.has(role);
  if (bucket === "manager") return role === "crew_manager";
  if (bucket === "technician") return role === "technician";
  return false;
}

/** Finds the crew manager's userId for a technician, based on their crew membership. Returns null if none. */
export async function findManagerForTechnician(tenantId: number, technicianUserId: number): Promise<number | null> {
  const [row] = await db
    .select({ managerId: crewsTable.managerId })
    .from(crewMembersTable)
    .innerJoin(crewsTable, eq(crewMembersTable.crewId, crewsTable.id))
    .where(and(
      eq(crewMembersTable.userId, technicianUserId),
      eq(crewMembersTable.tenantId, tenantId),
    ))
    .limit(1);
  return row?.managerId ?? null;
}

/** Returns the set of technician userIds on any crew managed by the given manager. */
export async function findTechniciansForManager(tenantId: number, managerUserId: number): Promise<Set<number>> {
  const crews = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(and(eq(crewsTable.tenantId, tenantId), eq(crewsTable.managerId, managerUserId)));
  if (crews.length === 0) return new Set();
  const members = await db
    .select({ userId: crewMembersTable.userId })
    .from(crewMembersTable)
    .where(and(eq(crewMembersTable.tenantId, tenantId), inArray(crewMembersTable.crewId, crews.map(c => c.id))));
  return new Set(members.map(m => m.userId));
}

export interface AssignmentTarget {
  assignedToUserId?: number | null;
  assignedToRole?: string | null;
}

export interface RoutingCheckResult {
  ok: boolean;
  error?: string;
}

/**
 * Validates that `callerUserId` (with `callerRole`) is allowed to create/reassign a task
 * to the given target, per the role routing rules:
 *  - technician -> their own manager, or Admin/Office bucket
 *  - crew_manager -> any technician on their crew, Admin/Office, or themselves
 *  - admin/office -> anyone
 */
export async function validateTaskAssignment(
  tenantId: number,
  callerUserId: number,
  callerRole: string,
  target: AssignmentTarget,
): Promise<RoutingCheckResult> {
  const { assignedToUserId, assignedToRole } = target;
  if (!assignedToUserId && !assignedToRole) {
    return { ok: false, error: "Task must be assigned to a person or a role (Any Manager / Any Admin/Office / Any Technician)" };
  }
  if (assignedToUserId && assignedToRole) {
    return { ok: false, error: "Assign to either a specific person or a role bucket, not both" };
  }

  if (ADMIN_ROLES.has(callerRole)) {
    // Admin/Office can assign to anyone.
    return { ok: true };
  }

  if (callerRole === "crew_manager") {
    if (assignedToRole) {
      if (assignedToRole === "admin_office") return { ok: true };
      return { ok: false, error: "Crew managers can assign to Admin/Office, their own technicians, or themselves" };
    }
    if (assignedToUserId === callerUserId) return { ok: true };
    const techs = await findTechniciansForManager(tenantId, callerUserId);
    if (assignedToUserId != null && techs.has(assignedToUserId)) return { ok: true };
    return { ok: false, error: "Crew managers can only assign to technicians on their own crew, Admin/Office, or themselves" };
  }

  // Default: technician (or any other non-privileged role)
  if (assignedToRole) {
    if (assignedToRole === "admin_office") return { ok: true };
    return { ok: false, error: "Technicians can assign to their own manager or Admin/Office" };
  }
  const managerId = await findManagerForTechnician(tenantId, callerUserId);
  if (assignedToUserId != null && managerId != null && assignedToUserId === managerId) return { ok: true };
  return { ok: false, error: "Technicians can only assign tasks to their own manager or Admin/Office" };
}

export async function getUserRoleAndName(tenantId: number, userId: number): Promise<{ role: string; name: string } | null> {
  const [u] = await db.select({ role: usersTable.role, name: usersTable.name }).from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  if (!u) return null;
  return u;
}

export { getCallerRole };
