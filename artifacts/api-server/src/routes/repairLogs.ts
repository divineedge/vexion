import { Router, type IRouter } from "express";
import { db, repairLogsTable, blueprintsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql, sum } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRepairLog(r: typeof repairLogsTable.$inferSelect & { performedByName?: string | null }) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    propertyId: r.propertyId,
    jobId: r.jobId ?? null,
    blueprintId: r.blueprintId ?? null,
    elementId: r.elementId ?? null,
    componentType: r.componentType,
    replacedWhat: r.replacedWhat ?? null,
    replacedWithName: r.replacedWithName ?? null,
    replacedWithInventoryItemId: r.replacedWithInventoryItemId ?? null,
    nozzleBrand: r.nozzleBrand ?? null,
    nozzleType: r.nozzleType ?? null,
    nozzleGpm: r.nozzleGpm ?? null,
    nozzleRadiusFt: r.nozzleRadiusFt ?? null,
    nozzleArcDegrees: r.nozzleArcDegrees ?? null,
    partsCost: r.partsCost,
    laborCost: r.laborCost,
    totalCost: (r.partsCost ?? 0) + (r.laborCost ?? 0),
    notes: r.notes ?? null,
    performedByUserId: r.performedByUserId ?? null,
    performedByName: r.performedByName ?? null,
    performedAt: r.performedAt instanceof Date ? r.performedAt.toISOString() : r.performedAt,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  };
}

// ── LIST ─────────────────────────────────────────────────────────────────────

router.get("/repair-logs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const propertyId = req.query.propertyId ? Number(req.query.propertyId) : undefined;
  const jobId = req.query.jobId ? Number(req.query.jobId) : undefined;
  const elementId = req.query.elementId as string | undefined;
  const blueprintId = req.query.blueprintId ? Number(req.query.blueprintId) : undefined;

  const conditions = [eq(repairLogsTable.tenantId, tenantId)];
  if (propertyId) conditions.push(eq(repairLogsTable.propertyId, propertyId));
  if (jobId) conditions.push(eq(repairLogsTable.jobId, jobId));
  if (elementId) conditions.push(eq(repairLogsTable.elementId, elementId));
  if (blueprintId) conditions.push(eq(repairLogsTable.blueprintId, blueprintId));

  const rows = await db
    .select({
      log: repairLogsTable,
      performedByName: usersTable.name,
    })
    .from(repairLogsTable)
    .leftJoin(usersTable, eq(repairLogsTable.performedByUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(repairLogsTable.performedAt));

  res.json(rows.map(r => formatRepairLog({ ...r.log, performedByName: r.performedByName })));
});

// ── PROPERTY SUMMARY (analytics) ─────────────────────────────────────────────

router.get("/repair-logs/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const propertyId = req.query.propertyId ? Number(req.query.propertyId) : undefined;

  if (!propertyId) {
    res.status(400).json({ error: "propertyId is required" });
    return;
  }

  // Total cost + count for this property
  const [totals] = await db
    .select({
      totalPartsCost: sum(repairLogsTable.partsCost),
      totalLaborCost: sum(repairLogsTable.laborCost),
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(repairLogsTable)
    .where(and(eq(repairLogsTable.tenantId, tenantId), eq(repairLogsTable.propertyId, propertyId)));

  // Breakdown by component type
  const byType = await db
    .select({
      componentType: repairLogsTable.componentType,
      totalPartsCost: sum(repairLogsTable.partsCost),
      totalLaborCost: sum(repairLogsTable.laborCost),
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(repairLogsTable)
    .where(and(eq(repairLogsTable.tenantId, tenantId), eq(repairLogsTable.propertyId, propertyId)))
    .groupBy(repairLogsTable.componentType);

  // Year-over-year — group by calendar year
  const byYear = await db
    .select({
      year: sql<number>`extract(year from ${repairLogsTable.performedAt})::integer`,
      totalPartsCost: sum(repairLogsTable.partsCost),
      totalLaborCost: sum(repairLogsTable.laborCost),
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(repairLogsTable)
    .where(and(eq(repairLogsTable.tenantId, tenantId), eq(repairLogsTable.propertyId, propertyId)))
    .groupBy(sql`extract(year from ${repairLogsTable.performedAt})`)
    .orderBy(sql`extract(year from ${repairLogsTable.performedAt})`);

  res.json({
    totalPartsCost: Number(totals?.totalPartsCost ?? 0),
    totalLaborCost: Number(totals?.totalLaborCost ?? 0),
    totalCost: Number(totals?.totalPartsCost ?? 0) + Number(totals?.totalLaborCost ?? 0),
    count: totals?.count ?? 0,
    byComponentType: byType.map(r => ({
      componentType: r.componentType,
      totalCost: Number(r.totalPartsCost ?? 0) + Number(r.totalLaborCost ?? 0),
      count: r.count,
    })),
    byYear: byYear.map(r => ({
      year: r.year,
      totalCost: Number(r.totalPartsCost ?? 0) + Number(r.totalLaborCost ?? 0),
      count: r.count,
    })),
  });
});

// ── CREATE ────────────────────────────────────────────────────────────────────

router.post("/repair-logs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const {
    propertyId, jobId, blueprintId, elementId, componentType,
    replacedWhat, replacedWithName, replacedWithInventoryItemId,
    nozzleBrand, nozzleType, nozzleGpm, nozzleRadiusFt, nozzleArcDegrees,
    partsCost, laborCost, notes, performedByUserId, performedAt,
  } = req.body;

  if (!propertyId) { res.status(400).json({ error: "propertyId is required" }); return; }

  const [created] = await db.insert(repairLogsTable).values({
    tenantId,
    propertyId: Number(propertyId),
    jobId: jobId ? Number(jobId) : null,
    blueprintId: blueprintId ? Number(blueprintId) : null,
    elementId: elementId ?? null,
    componentType: componentType ?? "other",
    replacedWhat: replacedWhat ?? null,
    replacedWithName: replacedWithName ?? null,
    replacedWithInventoryItemId: replacedWithInventoryItemId ? Number(replacedWithInventoryItemId) : null,
    nozzleBrand: nozzleBrand ?? null,
    nozzleType: nozzleType ?? null,
    nozzleGpm: nozzleGpm != null ? Number(nozzleGpm) : null,
    nozzleRadiusFt: nozzleRadiusFt != null ? Number(nozzleRadiusFt) : null,
    nozzleArcDegrees: nozzleArcDegrees != null ? Number(nozzleArcDegrees) : null,
    partsCost: partsCost != null ? Number(partsCost) : 0,
    laborCost: laborCost != null ? Number(laborCost) : 0,
    notes: notes ?? null,
    performedByUserId: performedByUserId ? Number(performedByUserId) : (userId ? Number(userId) : null),
    performedAt: performedAt ? new Date(performedAt) : new Date(),
  }).returning();

  res.status(201).json(formatRepairLog(created));
});

// ── UPDATE ────────────────────────────────────────────────────────────────────

router.patch("/repair-logs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const {
    componentType, replacedWhat, replacedWithName, replacedWithInventoryItemId,
    nozzleBrand, nozzleType, nozzleGpm, nozzleRadiusFt, nozzleArcDegrees,
    partsCost, laborCost, notes, performedAt,
  } = req.body;

  const patch: Partial<typeof repairLogsTable.$inferInsert> = { updatedAt: new Date() };
  if (componentType !== undefined) patch.componentType = componentType;
  if (replacedWhat !== undefined) patch.replacedWhat = replacedWhat;
  if (replacedWithName !== undefined) patch.replacedWithName = replacedWithName;
  if (replacedWithInventoryItemId !== undefined) patch.replacedWithInventoryItemId = replacedWithInventoryItemId ? Number(replacedWithInventoryItemId) : null;
  if (nozzleBrand !== undefined) patch.nozzleBrand = nozzleBrand;
  if (nozzleType !== undefined) patch.nozzleType = nozzleType;
  if (nozzleGpm !== undefined) patch.nozzleGpm = nozzleGpm != null ? Number(nozzleGpm) : null;
  if (nozzleRadiusFt !== undefined) patch.nozzleRadiusFt = nozzleRadiusFt != null ? Number(nozzleRadiusFt) : null;
  if (nozzleArcDegrees !== undefined) patch.nozzleArcDegrees = nozzleArcDegrees != null ? Number(nozzleArcDegrees) : null;
  if (partsCost !== undefined) patch.partsCost = Number(partsCost);
  if (laborCost !== undefined) patch.laborCost = Number(laborCost);
  if (notes !== undefined) patch.notes = notes;
  if (performedAt !== undefined) patch.performedAt = new Date(performedAt);

  const [updated] = await db
    .update(repairLogsTable)
    .set(patch)
    .where(and(eq(repairLogsTable.id, id), eq(repairLogsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatRepairLog(updated));
});

// ── DELETE ────────────────────────────────────────────────────────────────────

router.delete("/repair-logs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db
    .delete(repairLogsTable)
    .where(and(eq(repairLogsTable.id, id), eq(repairLogsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
