import { and, eq, inArray } from "drizzle-orm";
import { db, equipmentInspectionsTable, internalTasksTable } from "@workspace/db";

export const legacyInspectionTypes = ["pre_trip_inspection", "end_of_day_inspection"];

/** Distinct references keep new inspection IDs from colliding with old task IDs. */
export async function findEquipmentInspection(tenantId: number, reference: string) {
  const modern = /^inspection-([1-9]\d*)$/.exec(reference);
  const id = Number(modern ? modern[1] : reference);
  if (!Number.isSafeInteger(id) || id <= 0 || (!modern && !/^[1-9]\d*$/.test(reference))) return null;
  if (modern) {
    const [record] = await db.select().from(equipmentInspectionsTable).where(and(
      eq(equipmentInspectionsTable.id, id), eq(equipmentInspectionsTable.tenantId, tenantId),
    )).limit(1);
    return record ? { ...record, equipmentId: record.contextId, mediaEntityType: "equipment_inspection" } : null;
  }
  const [record] = await db.select().from(internalTasksTable).where(and(
    eq(internalTasksTable.id, id), eq(internalTasksTable.tenantId, tenantId),
    eq(internalTasksTable.contextType, "equipment"), inArray(internalTasksTable.taskType, legacyInspectionTypes),
  )).limit(1);
  return record ? { ...record, equipmentId: record.contextId, mediaEntityType: "pre_trip_inspection" } : null;
}
