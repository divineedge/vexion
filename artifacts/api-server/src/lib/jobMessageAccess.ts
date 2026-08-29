import { crewMembersTable, db, jobsTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { ADMIN_ROLES, getCallerRole } from "./roles";

const LEGACY_MANAGEMENT_ROLES = new Set(["owner", "admin", "manager", "admin_office", "crew_manager"]);

export async function canAccessJobMessages(tenantId: number, userId: number, jobId: number): Promise<boolean> {
  const role = await getCallerRole(tenantId, userId);
  if (ADMIN_ROLES.has(role) || LEGACY_MANAGEMENT_ROLES.has(role)) {
    const [job] = await db.select({ id: jobsTable.id }).from(jobsTable)
      .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId))).limit(1);
    return !!job;
  }
  const [job] = await db
    .select({ id: jobsTable.id, assigneeId: jobsTable.assigneeId, crewUserId: crewMembersTable.userId })
    .from(jobsTable)
    .leftJoin(crewMembersTable, and(
      eq(crewMembersTable.crewId, jobsTable.crewId),
      eq(crewMembersTable.userId, userId),
      eq(crewMembersTable.tenantId, tenantId),
    ))
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)))
    .limit(1);
  return !!job && (job.assigneeId === userId || job.crewUserId === userId);
}

export async function visibleJobMessageIds(tenantId: number, userId: number): Promise<number[]> {
  const role = await getCallerRole(tenantId, userId);
  const manager = ADMIN_ROLES.has(role) || LEGACY_MANAGEMENT_ROLES.has(role);
  const rows = await db
    .selectDistinct({ id: jobsTable.id })
    .from(jobsTable)
    .leftJoin(crewMembersTable, and(
      eq(crewMembersTable.crewId, jobsTable.crewId),
      eq(crewMembersTable.userId, userId),
      eq(crewMembersTable.tenantId, tenantId),
    ))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      ...(manager ? [] : [or(eq(jobsTable.assigneeId, userId), eq(crewMembersTable.userId, userId))!]),
    ));
  return rows.map((row) => row.id);
}