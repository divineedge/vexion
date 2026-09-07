import { ADMIN_ROLES } from "./roles";

type EquipmentAssignments = {
  assignedUserId: number | null;
  assignedCrewId: number | null;
};

/** Pure row-level visibility rule shared by list/detail authorization paths. */
export function hasEquipmentVisibility(
  role: string | null,
  userId: number,
  crewIds: ReadonlySet<number>,
  equipment: EquipmentAssignments,
): boolean {
  if (role && ADMIN_ROLES.has(role)) return true;
  return equipment.assignedUserId === userId
    || (equipment.assignedCrewId != null && crewIds.has(equipment.assignedCrewId));
}