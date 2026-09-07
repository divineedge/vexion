import { and, eq } from "drizzle-orm";
import { crewMembersTable, db, equipmentTable, usersTable } from "@workspace/db";
import { hasEquipmentVisibility } from "./equipmentVisibility";

/**
 * Office roles may access every asset in their tenant. Field roles may access an
 * asset only through a direct assignment or a current crew membership.
 */
export async function canAccessEquipment(
  tenantId: number,
  userId: number,
  equipmentId: number,
): Promise<boolean> {
  const [[user], [equipment]] = await Promise.all([
    db.select({ role: usersTable.role }).from(usersTable).where(and(
      eq(usersTable.id, userId),
      eq(usersTable.tenantId, tenantId),
      eq(usersTable.isActive, true),
    )).limit(1),
    db.select({
      assignedUserId: equipmentTable.assignedUserId,
      assignedCrewId: equipmentTable.assignedCrewId,
    }).from(equipmentTable).where(and(
      eq(equipmentTable.id, equipmentId),
      eq(equipmentTable.tenantId, tenantId),
    )).limit(1),
  ]);

  if (!user || !equipment) return false;
  const memberships = equipment.assignedCrewId == null ? [] : await db.select({ crewId: crewMembersTable.crewId }).from(crewMembersTable).where(and(
    eq(crewMembersTable.tenantId, tenantId),
    eq(crewMembersTable.crewId, equipment.assignedCrewId),
    eq(crewMembersTable.userId, userId),
  )).limit(1);
  return hasEquipmentVisibility(user.role, userId, new Set(memberships.map(row => row.crewId)), equipment);
}