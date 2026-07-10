import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, equipmentTable, equipmentMaintenanceTable, equipmentFuelLogsTable, tenantsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sum } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function getUserRole(tenantId: number, userId: number): Promise<string | null> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  return user?.role ?? null;
}

/** Only admin/office may mutate equipment records; all roles can view and add fuel logs */
async function requireOfficeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getUserRole(tenantId, userId);
  if (!role || role === "technician") {
    res.status(403).json({ error: "Admin or office role required" });
    return;
  }
  next();
}

/**
 * Verify that the given equipment belongs to the tenant.
 * Returns the equipment row, or sends 404 and returns null.
 */
async function requireEquipmentOwnership(
  equipmentId: number,
  tenantId: number,
  res: Response,
): Promise<(typeof equipmentTable.$inferSelect) | null> {
  const [row] = await db
    .select()
    .from(equipmentTable)
    .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));
  if (!row) {
    res.status(404).json({ error: "Equipment not found" });
    return null;
  }
  return row;
}

// ─── Computed fields helpers ──────────────────────────────────────────────────

function computeEquipmentMetrics(
  eq_row: typeof equipmentTable.$inferSelect,
  repairThresholdPct: number,
  resaleThresholdPct: number,
) {
  const { purchasePrice, currentHours, totalRepairCost, totalFuelCost, purchaseDate, expectedLifespanYears } = eq_row;

  const totalCost = purchasePrice + totalRepairCost + totalFuelCost;
  const costPerHour = currentHours > 0 ? totalCost / currentHours : null;

  let estimatedResaleValue: number | null = null;
  if (purchaseDate && expectedLifespanYears && expectedLifespanYears > 0 && purchasePrice > 0) {
    const purchaseYear = new Date(purchaseDate).getFullYear();
    const currentYear = new Date().getFullYear();
    const ageYears = currentYear - purchaseYear;
    const remainingFraction = Math.max(0, 1 - ageYears / expectedLifespanYears);
    estimatedResaleValue = purchasePrice * remainingFraction;
  }

  const repairExceeded = purchasePrice > 0 && totalRepairCost > purchasePrice * (repairThresholdPct / 100);
  const resaleTooLow =
    estimatedResaleValue !== null && purchasePrice > 0 && estimatedResaleValue < purchasePrice * (resaleThresholdPct / 100);
  const sellRecommended = repairExceeded || resaleTooLow;

  let sellReason: string | null = null;
  if (repairExceeded && resaleTooLow) {
    sellReason = `Repairs exceed ${repairThresholdPct}% of purchase price and resale value is below ${resaleThresholdPct}%.`;
  } else if (repairExceeded) {
    sellReason = `Total repair cost exceeds ${repairThresholdPct}% of purchase price.`;
  } else if (resaleTooLow) {
    sellReason = `Estimated resale value has fallen below ${resaleThresholdPct}% of purchase price.`;
  }

  return { costPerHour, estimatedResaleValue, sellRecommended, sellReason };
}

function formatEquipment(
  row: typeof equipmentTable.$inferSelect,
  repairThresholdPct: number,
  resaleThresholdPct: number,
) {
  const metrics = computeEquipmentMetrics(row, repairThresholdPct, resaleThresholdPct);
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    type: row.type,
    purchaseDate: row.purchaseDate ?? null,
    purchasePrice: row.purchasePrice,
    expectedLifespanYears: row.expectedLifespanYears ?? null,
    expectedLifespanHours: row.expectedLifespanHours ?? null,
    currentHours: row.currentHours,
    currentMiles: row.currentMiles ?? null,
    totalRepairCost: row.totalRepairCost,
    totalFuelCost: row.totalFuelCost,
    isActive: row.isActive,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...metrics,
  };
}

async function getTenantThresholds(tenantId: number) {
  const [tenant] = await db
    .select({ repairPct: tenantsTable.equipmentRepairThresholdPct, resalePct: tenantsTable.equipmentResaleThresholdPct })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  return {
    repairThresholdPct: tenant?.repairPct ?? 50,
    resaleThresholdPct: tenant?.resalePct ?? 20,
  };
}

// ─── Equipment CRUD ────────────────────────────────────────────────────────────

router.get("/equipment", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const [rows, thresholds] = await Promise.all([
    db.select().from(equipmentTable).where(eq(equipmentTable.tenantId, tenantId)).orderBy(equipmentTable.name),
    getTenantThresholds(tenantId),
  ]);
  res.json(rows.map(r => formatEquipment(r, thresholds.repairThresholdPct, thresholds.resaleThresholdPct)));
});

router.get("/equipment/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [[row], thresholds] = await Promise.all([
    db.select().from(equipmentTable).where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId))),
    getTenantThresholds(tenantId),
  ]);
  if (!row) { res.status(404).json({ error: "Equipment not found" }); return; }
  res.json(formatEquipment(row, thresholds.repairThresholdPct, thresholds.resaleThresholdPct));
});

router.post("/equipment", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, type, purchaseDate, purchasePrice, expectedLifespanYears, expectedLifespanHours, currentHours, currentMiles, notes } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [row] = await db.insert(equipmentTable).values({
    tenantId,
    name,
    type: type ?? "other",
    purchaseDate: purchaseDate ?? null,
    purchasePrice: purchasePrice != null ? parseFloat(purchasePrice) : 0,
    expectedLifespanYears: expectedLifespanYears != null ? parseFloat(expectedLifespanYears) : null,
    expectedLifespanHours: expectedLifespanHours != null ? parseFloat(expectedLifespanHours) : null,
    currentHours: currentHours != null ? parseFloat(currentHours) : 0,
    currentMiles: currentMiles != null ? parseFloat(currentMiles) : null,
    notes: notes ?? null,
  }).returning();
  const thresholds = await getTenantThresholds(tenantId);
  res.status(201).json(formatEquipment(row, thresholds.repairThresholdPct, thresholds.resaleThresholdPct));
});

router.patch("/equipment/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, type, purchaseDate, purchasePrice, expectedLifespanYears, expectedLifespanHours, currentHours, currentMiles, isActive, notes } = req.body;
  const updates: Partial<typeof equipmentTable.$inferInsert> = {};
  if (name != null) updates.name = name;
  if (type != null) updates.type = type;
  if (purchaseDate !== undefined) updates.purchaseDate = purchaseDate;
  if (purchasePrice != null) updates.purchasePrice = parseFloat(purchasePrice);
  if (expectedLifespanYears !== undefined) updates.expectedLifespanYears = expectedLifespanYears != null ? parseFloat(expectedLifespanYears) : null;
  if (expectedLifespanHours !== undefined) updates.expectedLifespanHours = expectedLifespanHours != null ? parseFloat(expectedLifespanHours) : null;
  if (currentHours != null) updates.currentHours = parseFloat(currentHours);
  if (currentMiles !== undefined) updates.currentMiles = currentMiles != null ? parseFloat(currentMiles) : null;
  if (isActive !== undefined) updates.isActive = isActive;
  if (notes !== undefined) updates.notes = notes;

  const [row] = await db.update(equipmentTable).set(updates).where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId))).returning();
  if (!row) { res.status(404).json({ error: "Equipment not found" }); return; }
  const thresholds = await getTenantThresholds(tenantId);
  res.json(formatEquipment(row, thresholds.repairThresholdPct, thresholds.resaleThresholdPct));
});

router.delete("/equipment/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify ownership before touching anything
  const owned = await requireEquipmentOwnership(id, tenantId, res);
  if (!owned) return;

  // Delete child rows first to satisfy FK constraints, then delete the parent
  await db.delete(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.equipmentId, id), eq(equipmentFuelLogsTable.tenantId, tenantId)));
  await db.delete(equipmentMaintenanceTable).where(and(eq(equipmentMaintenanceTable.equipmentId, id), eq(equipmentMaintenanceTable.tenantId, tenantId)));
  await db.delete(equipmentTable).where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId)));

  res.sendStatus(204);
});

// ─── Maintenance & Repair Sub-resource ────────────────────────────────────────

router.get("/equipment/:id/maintenance", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  // Verify ownership
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;
  const rows = await db
    .select()
    .from(equipmentMaintenanceTable)
    .where(and(eq(equipmentMaintenanceTable.equipmentId, equipmentId), eq(equipmentMaintenanceTable.tenantId, tenantId)))
    .orderBy(desc(equipmentMaintenanceTable.date));
  res.json(rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })));
});

router.post("/equipment/:id/maintenance", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify the equipment belongs to this tenant before inserting a child record
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;

  const { date, description, cost, vendor, nextServiceDueDate, nextServiceDueHours, nextServiceDueMiles } = req.body;
  if (!date || !description) { res.status(400).json({ error: "date and description are required" }); return; }

  const parsedCost = cost != null ? parseFloat(cost) : 0;

  const [row] = await db.insert(equipmentMaintenanceTable).values({
    equipmentId,
    tenantId,
    date,
    description,
    cost: parsedCost,
    vendor: vendor ?? null,
    nextServiceDueDate: nextServiceDueDate ?? null,
    nextServiceDueHours: nextServiceDueHours != null ? parseFloat(nextServiceDueHours) : null,
    nextServiceDueMiles: nextServiceDueMiles != null ? parseFloat(nextServiceDueMiles) : null,
  }).returning();

  // Recalculate running total — scoped by BOTH equipmentId AND tenantId
  const result = await db
    .select({ total: sum(equipmentMaintenanceTable.cost) })
    .from(equipmentMaintenanceTable)
    .where(and(eq(equipmentMaintenanceTable.equipmentId, equipmentId), eq(equipmentMaintenanceTable.tenantId, tenantId)));
  const newTotal = parseFloat(String(result[0]?.total ?? 0));

  // Update parent — scoped by BOTH id AND tenantId
  await db.update(equipmentTable)
    .set({ totalRepairCost: newTotal })
    .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));

  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
});

router.delete("/equipment/:equipmentId/maintenance/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.equipmentId) ? req.params.equipmentId[0] : req.params.equipmentId, 10);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify the equipment belongs to this tenant
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;

  // Delete scoped by all three keys: id + equipmentId + tenantId
  const [deleted] = await db.delete(equipmentMaintenanceTable)
    .where(and(
      eq(equipmentMaintenanceTable.id, id),
      eq(equipmentMaintenanceTable.equipmentId, equipmentId),
      eq(equipmentMaintenanceTable.tenantId, tenantId),
    ))
    .returning({ id: equipmentMaintenanceTable.id });
  if (!deleted) { res.status(404).json({ error: "Maintenance record not found" }); return; }

  // Recalculate — scoped by BOTH equipmentId AND tenantId
  const result = await db
    .select({ total: sum(equipmentMaintenanceTable.cost) })
    .from(equipmentMaintenanceTable)
    .where(and(eq(equipmentMaintenanceTable.equipmentId, equipmentId), eq(equipmentMaintenanceTable.tenantId, tenantId)));
  const newTotal = parseFloat(String(result[0]?.total ?? 0));

  // Update parent — scoped by BOTH id AND tenantId
  await db.update(equipmentTable)
    .set({ totalRepairCost: newTotal })
    .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));

  res.sendStatus(204);
});

// ─── Fuel Logs Sub-resource ────────────────────────────────────────────────────

router.get("/equipment/:id/fuel-logs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  // Verify ownership
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;
  const rows = await db
    .select()
    .from(equipmentFuelLogsTable)
    .where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)))
    .orderBy(desc(equipmentFuelLogsTable.date));
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/equipment/:id/fuel-logs", async (req, res): Promise<void> => {
  // All roles can add fuel logs
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify the equipment belongs to this tenant before inserting a child record
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;

  const { date, gallons, cost, odometerReading } = req.body;
  if (!date || gallons == null) { res.status(400).json({ error: "date and gallons are required" }); return; }

  const parsedCost = cost != null ? parseFloat(cost) : 0;

  const [row] = await db.insert(equipmentFuelLogsTable).values({
    equipmentId,
    tenantId,
    date,
    gallons: parseFloat(gallons),
    cost: parsedCost,
    odometerReading: odometerReading != null ? parseFloat(odometerReading) : null,
  }).returning();

  // Recalculate fuel cost total — scoped by BOTH equipmentId AND tenantId
  const result = await db
    .select({ total: sum(equipmentFuelLogsTable.cost) })
    .from(equipmentFuelLogsTable)
    .where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)));
  const newFuelTotal = parseFloat(String(result[0]?.total ?? 0));

  const equipUpdates: Partial<typeof equipmentTable.$inferInsert> = { totalFuelCost: newFuelTotal };
  if (odometerReading != null) {
    const parsed = parseFloat(odometerReading);
    // Update currentHours if reading is higher than current — scoped by BOTH id AND tenantId
    const [current] = await db
      .select({ currentHours: equipmentTable.currentHours })
      .from(equipmentTable)
      .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));
    if (current && parsed > (current.currentHours ?? 0)) {
      equipUpdates.currentHours = parsed;
    }
  }

  // Update parent — scoped by BOTH id AND tenantId
  await db.update(equipmentTable)
    .set(equipUpdates)
    .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));

  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.delete("/equipment/:equipmentId/fuel-logs/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.equipmentId) ? req.params.equipmentId[0] : req.params.equipmentId, 10);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify the equipment belongs to this tenant
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;

  // Delete scoped by all three keys: id + equipmentId + tenantId
  const [deleted] = await db.delete(equipmentFuelLogsTable)
    .where(and(
      eq(equipmentFuelLogsTable.id, id),
      eq(equipmentFuelLogsTable.equipmentId, equipmentId),
      eq(equipmentFuelLogsTable.tenantId, tenantId),
    ))
    .returning({ id: equipmentFuelLogsTable.id });
  if (!deleted) { res.status(404).json({ error: "Fuel log not found" }); return; }

  // Recalculate — scoped by BOTH equipmentId AND tenantId
  const result = await db
    .select({ total: sum(equipmentFuelLogsTable.cost) })
    .from(equipmentFuelLogsTable)
    .where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)));
  const newFuelTotal = parseFloat(String(result[0]?.total ?? 0));

  // Update parent — scoped by BOTH id AND tenantId
  await db.update(equipmentTable)
    .set({ totalFuelCost: newFuelTotal })
    .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));

  res.sendStatus(204);
});

export default router;
