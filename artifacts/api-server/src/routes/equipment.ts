import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, equipmentTable, equipmentMaintenanceTable, equipmentFuelLogsTable, equipmentReadingLogsTable, tenantsTable, usersTable, jobsTable, taskBundlesItemsTable, inventoryItemsTable } from "@workspace/db";
import { eq, and, desc, sum, isNull, isNotNull, inArray, or, gte, lte, ilike } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isOwnerRole } from "../lib/roles";
import {
  importUpload,
  handleExportRequest,
  handleImportPreview,
  handleImportCommit,
  requireString,
  optionalString,
  optionalNumber,
  optionalBoolean,
  registerImportExportConfig,
  type ImportExportEntityConfig,
} from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const equipmentImportExportConfig: ImportExportEntityConfig = {
  entityKey: "equipment",
  fields: [
    { key: "name", header: "Name", required: true, hint: "Used to match an existing asset" },
    { key: "type", header: "Type", hint: "mower, truck, trailer, sprayer, blower, edger, chainsaw, other" },
    { key: "purchaseDate", header: "Purchase Date" },
    { key: "purchasePrice", header: "Purchase Price" },
    { key: "expectedLifespanYears", header: "Expected Lifespan (years)" },
    { key: "expectedLifespanHours", header: "Expected Lifespan (hours)" },
    { key: "currentHours", header: "Current Hours" },
    { key: "currentMiles", header: "Current Miles" },
    { key: "isActive", header: "Is Active", hint: "true/false" },
    { key: "notes", header: "Notes" },
  ],
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "name", header: "Name" },
    { key: "type", header: "Type" },
    { key: "purchaseDate", header: "Purchase Date" },
    { key: "purchasePrice", header: "Purchase Price" },
    { key: "expectedLifespanYears", header: "Expected Lifespan (years)" },
    { key: "expectedLifespanHours", header: "Expected Lifespan (hours)" },
    { key: "currentHours", header: "Current Hours" },
    { key: "currentMiles", header: "Current Miles" },
    { key: "isActive", header: "Is Active" },
    { key: "notes", header: "Notes" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    const includeArchived = query.includeArchived === "true" || query.includeArchived === "1";
    const where = includeArchived
      ? eq(equipmentTable.tenantId, tenantId)
      : and(eq(equipmentTable.tenantId, tenantId), isNull(equipmentTable.archivedAt));
    const rows = await db.select().from(equipmentTable).where(where).orderBy(equipmentTable.name);
    return rows.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      purchaseDate: e.purchaseDate ?? "",
      purchasePrice: e.purchasePrice,
      expectedLifespanYears: e.expectedLifespanYears ?? "",
      expectedLifespanHours: e.expectedLifespanHours ?? "",
      currentHours: e.currentHours,
      currentMiles: e.currentMiles ?? "",
      isActive: e.isActive,
      notes: e.notes ?? "",
      createdAt: e.createdAt.toISOString(),
    }));
  },
  parseRow: async (_tenantId, raw) => {
    const errors: string[] = [];
    const name = requireString(raw.name, "Name", errors);
    if (errors.length > 0 || !name) return { ok: false, errors };

    const purchaseDate = optionalString(raw.purchaseDate);
    if (purchaseDate && Number.isNaN(new Date(purchaseDate).getTime())) {
      errors.push(`Purchase Date is not a valid date (got "${raw.purchaseDate}")`);
    }

    const values = {
      name,
      type: optionalString(raw.type) ?? "other",
      purchaseDate: purchaseDate ?? null,
      purchasePrice: optionalNumber(raw.purchasePrice, "Purchase Price", errors) ?? 0,
      expectedLifespanYears: optionalNumber(raw.expectedLifespanYears, "Expected Lifespan (years)", errors) ?? null,
      expectedLifespanHours: optionalNumber(raw.expectedLifespanHours, "Expected Lifespan (hours)", errors) ?? null,
      currentHours: optionalNumber(raw.currentHours, "Current Hours", errors) ?? 0,
      currentMiles: optionalNumber(raw.currentMiles, "Current Miles", errors) ?? null,
      isActive: optionalBoolean(raw.isActive) ?? true,
      notes: optionalString(raw.notes) ?? null,
    };
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, values };
  },
  findExisting: async (tenantId, values) => {
    const [existing] = await db
      .select({ id: equipmentTable.id })
      .from(equipmentTable)
      .where(and(eq(equipmentTable.tenantId, tenantId), ilike(equipmentTable.name, values.name as string)))
      .limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    const [row] = await db.insert(equipmentTable).values({ tenantId, ...values } as typeof equipmentTable.$inferInsert).returning({ id: equipmentTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    await db.update(equipmentTable).set(values as Partial<typeof equipmentTable.$inferInsert>)
      .where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId)));
  },
  getById: async (tenantId, id) => {
    const [row] = await db.select().from(equipmentTable).where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId))).limit(1);
    if (!row) return null;
    const { id: _id, tenantId: _t, createdAt: _c, ...rest } = row;
    return rest;
  },
  deleteById: async (tenantId, id) => {
    await db.delete(equipmentTable).where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId)));
  },
};
registerImportExportConfig(equipmentImportExportConfig);

router.get("/equipment/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), equipmentImportExportConfig);
});

router.post("/equipment/import/preview", requireOfficeRole, importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), equipmentImportExportConfig);
});

router.post("/equipment/import/commit", requireOfficeRole, importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), equipmentImportExportConfig);
});

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

/** Hard-delete (with cascading history loss) is only available to the company owner / super-admin. */
async function requireOwnerRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const isOwner = await isOwnerRole(tenantId, userId);
  if (!isOwner) {
    res.status(403).json({ error: "Owner role required" });
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

type MaintenanceSchedule = {
  nextServiceDueDate: string | null;
  nextServiceDueHours: number | null;
  nextServiceDueMiles: number | null;
};

/** Compute maintenance-due fields from the latest maintenance schedule record. */
function computeMaintenanceStatus(
  row: typeof equipmentTable.$inferSelect,
  schedule: MaintenanceSchedule | null,
) {
  if (!schedule) {
    return {
      nextServiceDueDate: null,
      nextServiceDueHours: null,
      nextServiceDueMiles: null,
      maintenanceDue: false,
      hoursUntilService: null,
      milesUntilService: null,
    };
  }

  const { nextServiceDueDate, nextServiceDueHours, nextServiceDueMiles } = schedule;
  const today = new Date().toISOString().slice(0, 10);

  const hoursUntilService = nextServiceDueHours != null ? nextServiceDueHours - row.currentHours : null;
  const milesUntilService =
    nextServiceDueMiles != null && row.currentMiles != null ? nextServiceDueMiles - row.currentMiles : null;

  const dateDue = nextServiceDueDate != null && nextServiceDueDate <= today;
  const hoursDue = hoursUntilService != null && hoursUntilService <= 0;
  const milesDue = milesUntilService != null && milesUntilService <= 0;
  const maintenanceDue = dateDue || hoursDue || milesDue;

  return {
    nextServiceDueDate,
    nextServiceDueHours,
    nextServiceDueMiles,
    maintenanceDue,
    hoursUntilService,
    milesUntilService,
  };
}

function formatEquipment(
  row: typeof equipmentTable.$inferSelect,
  repairThresholdPct: number,
  resaleThresholdPct: number,
  schedule: MaintenanceSchedule | null = null,
) {
  const metrics = computeEquipmentMetrics(row, repairThresholdPct, resaleThresholdPct);
  const maintenanceStatus = computeMaintenanceStatus(row, schedule);
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
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...metrics,
    ...maintenanceStatus,
  };
}

/**
 * Fetch the latest maintenance record (by date desc, createdAt desc) that has
 * at least one nextServiceDue* field set — one query per equipment call, or
 * batched across all equipment for the list endpoint.
 */
async function getScheduleMap(tenantId: number): Promise<Map<number, MaintenanceSchedule>> {
  const rows = await db
    .select({
      equipmentId: equipmentMaintenanceTable.equipmentId,
      date: equipmentMaintenanceTable.date,
      createdAt: equipmentMaintenanceTable.createdAt,
      nextServiceDueDate: equipmentMaintenanceTable.nextServiceDueDate,
      nextServiceDueHours: equipmentMaintenanceTable.nextServiceDueHours,
      nextServiceDueMiles: equipmentMaintenanceTable.nextServiceDueMiles,
    })
    .from(equipmentMaintenanceTable)
    .where(
      and(
        eq(equipmentMaintenanceTable.tenantId, tenantId),
        or(
          isNotNull(equipmentMaintenanceTable.nextServiceDueDate),
          isNotNull(equipmentMaintenanceTable.nextServiceDueHours),
          isNotNull(equipmentMaintenanceTable.nextServiceDueMiles),
        ),
      ),
    )
    .orderBy(desc(equipmentMaintenanceTable.date), desc(equipmentMaintenanceTable.createdAt));

  // Keep only the first (latest) row per equipment
  const map = new Map<number, MaintenanceSchedule>();
  for (const r of rows) {
    if (!map.has(r.equipmentId)) {
      map.set(r.equipmentId, {
        nextServiceDueDate: r.nextServiceDueDate ?? null,
        nextServiceDueHours: r.nextServiceDueHours ?? null,
        nextServiceDueMiles: r.nextServiceDueMiles ?? null,
      });
    }
  }
  return map;
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
  const includeArchived = req.query.includeArchived === "true" || req.query.includeArchived === "1";
  const whereClause = includeArchived
    ? eq(equipmentTable.tenantId, tenantId)
    : and(eq(equipmentTable.tenantId, tenantId), isNull(equipmentTable.archivedAt));
  const [rows, thresholds, scheduleMap] = await Promise.all([
    db.select().from(equipmentTable).where(whereClause).orderBy(equipmentTable.name),
    getTenantThresholds(tenantId),
    getScheduleMap(tenantId),
  ]);
  res.json(rows.map(r => formatEquipment(r, thresholds.repairThresholdPct, thresholds.resaleThresholdPct, scheduleMap.get(r.id) ?? null)));
});

router.get("/equipment/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [[row], thresholds, scheduleMap] = await Promise.all([
    db.select().from(equipmentTable).where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId))),
    getTenantThresholds(tenantId),
    getScheduleMap(tenantId),
  ]);
  if (!row) { res.status(404).json({ error: "Equipment not found" }); return; }
  res.json(formatEquipment(row, thresholds.repairThresholdPct, thresholds.resaleThresholdPct, scheduleMap.get(row.id) ?? null));
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
  if (isActive !== undefined) {
    updates.isActive = isActive;
    // Restoring an archived item: clear the archive stamp so it re-appears in the default list.
    if (isActive === true) updates.archivedAt = null;
  }
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

  // Soft-delete: mark as archived and inactive, but keep all maintenance/fuel history intact.
  await db.update(equipmentTable)
    .set({ isActive: false, archivedAt: new Date() })
    .where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId)));

  res.sendStatus(204);
});

// Permanently delete equipment and cascade-delete its history. Restricted to the owner/super-admin
// role since this is the only way to lose cost data once equipment has been archived.
router.delete("/equipment/:id/hard-delete", requireOwnerRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify ownership before touching anything
  const owned = await requireEquipmentOwnership(id, tenantId, res);
  if (!owned) return;

  // Delete child rows first to satisfy FK constraints, then delete the parent
  await db.delete(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.equipmentId, id), eq(equipmentFuelLogsTable.tenantId, tenantId)));
  await db.delete(equipmentMaintenanceTable).where(and(eq(equipmentMaintenanceTable.equipmentId, id), eq(equipmentMaintenanceTable.tenantId, tenantId)));
  await db.delete(equipmentReadingLogsTable).where(and(eq(equipmentReadingLogsTable.equipmentId, id), eq(equipmentReadingLogsTable.tenantId, tenantId)));
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

router.post("/equipment/:id/maintenance", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify the equipment belongs to this tenant before inserting a child record
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;

  // Reject new records against archived equipment
  if (owned.archivedAt) {
    res.status(409).json({ error: "Cannot log maintenance on archived equipment" });
    return;
  }

  const { date, description, cost, vendor, nextServiceDueDate, nextServiceDueHours, nextServiceDueMiles, partsCost, laborCost, downtimeHours } = req.body;
  if (!date || !description) { res.status(400).json({ error: "date and description are required" }); return; }

  const parsedParts = partsCost != null ? parseFloat(partsCost) : 0;
  const parsedLabor = laborCost != null ? parseFloat(laborCost) : 0;
  // Legacy callers may only send `cost` (no parts/labor split) — treat it all as labor so
  // the Maintenance & Repair ledger still totals correctly.
  const parsedCost = cost != null ? parseFloat(cost) : parsedParts + parsedLabor;

  const [row] = await db.insert(equipmentMaintenanceTable).values({
    equipmentId,
    tenantId,
    date,
    description,
    cost: parsedCost,
    partsCost: parsedParts,
    laborCost: cost != null && !laborCost ? parsedCost - parsedParts : parsedLabor,
    downtimeHours: downtimeHours != null ? parseFloat(downtimeHours) : 0,
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

  // Reject new records against archived equipment
  if (owned.archivedAt) {
    res.status(409).json({ error: "Cannot log fuel fills on archived equipment" });
    return;
  }

  const { date, gallons, cost, odometerReading, jobId } = req.body;
  if (!date || gallons == null) { res.status(400).json({ error: "date and gallons are required" }); return; }

  // Validate jobId belongs to this tenant when provided
  let parsedJobId: number | null = null;
  if (jobId != null) {
    parsedJobId = parseInt(jobId, 10);
    if (isNaN(parsedJobId)) { res.status(400).json({ error: "jobId must be an integer" }); return; }
    const [job] = await db.select({ id: jobsTable.id }).from(jobsTable)
      .where(and(eq(jobsTable.id, parsedJobId), eq(jobsTable.tenantId, tenantId)));
    if (!job) { res.status(400).json({ error: "jobId not found or does not belong to this tenant" }); return; }
  }

  const parsedCost = cost != null ? parseFloat(cost) : 0;

  const [row] = await db.insert(equipmentFuelLogsTable).values({
    equipmentId,
    tenantId,
    jobId: parsedJobId,
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

// ─── Cost Ledger: Operating vs. Maintenance & Repair ────────────────────────────
// Two independent running-total views over the same asset's history, filterable
// by date range. Operating = fuel spend + a runtime-hours cost factor (from
// hour-meter readings logged via Daily Tasks). Maintenance & Repair = parts +
// labor + the value of downtime, from equipment_maintenance records.

router.get("/equipment/:id/ledger", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;

  const { from, to } = req.query as Record<string, string | undefined>;
  const dateConditions = [];
  if (from) dateConditions.push(gte(equipmentFuelLogsTable.date, from));
  if (to) dateConditions.push(lte(equipmentFuelLogsTable.date, to));

  const [tenant] = await db.select({ runtimeRate: tenantsTable.equipmentRuntimeHourlyRate, downtimeRate: tenantsTable.equipmentDowntimeHourlyRate })
    .from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const runtimeRate = tenant?.runtimeRate ?? 0;
  const downtimeRate = tenant?.downtimeRate ?? 0;

  const fuelLogs = await db.select().from(equipmentFuelLogsTable)
    .where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId), ...dateConditions))
    .orderBy(desc(equipmentFuelLogsTable.date));

  const hourConditions = [eq(equipmentReadingLogsTable.equipmentId, equipmentId), eq(equipmentReadingLogsTable.tenantId, tenantId), eq(equipmentReadingLogsTable.readingType, "hours")];
  if (from) hourConditions.push(gte(equipmentReadingLogsTable.date, from));
  if (to) hourConditions.push(lte(equipmentReadingLogsTable.date, to));
  const hourReadings = await db.select().from(equipmentReadingLogsTable).where(and(...hourConditions)).orderBy(equipmentReadingLogsTable.date);

  // Runtime hours run within the window = last reading - first reading (readings are cumulative hour-meter values)
  let runtimeHoursInWindow = 0;
  if (hourReadings.length >= 2) {
    runtimeHoursInWindow = Math.max(0, hourReadings[hourReadings.length - 1].value - hourReadings[0].value);
  }
  const runtimeCost = runtimeHoursInWindow * runtimeRate;
  const fuelCost = fuelLogs.reduce((s, f) => s + f.cost, 0);

  const maintConditions = [eq(equipmentMaintenanceTable.equipmentId, equipmentId), eq(equipmentMaintenanceTable.tenantId, tenantId)];
  if (from) maintConditions.push(gte(equipmentMaintenanceTable.date, from));
  if (to) maintConditions.push(lte(equipmentMaintenanceTable.date, to));
  const maintRecords = await db.select().from(equipmentMaintenanceTable).where(and(...maintConditions)).orderBy(desc(equipmentMaintenanceTable.date));

  // Legacy rows predate the parts/labor split and only populated `cost`; treat those as all-labor
  // so historical maintenance spend isn't silently dropped from the ledger.
  const isLegacyUnsplit = (m: typeof maintRecords[number]) => m.partsCost === 0 && m.laborCost === 0 && m.cost !== 0;
  const partsTotal = maintRecords.reduce((s, m) => s + m.partsCost, 0);
  const laborTotal = maintRecords.reduce((s, m) => s + (isLegacyUnsplit(m) ? m.cost : m.laborCost), 0);
  const downtimeHoursTotal = maintRecords.reduce((s, m) => s + m.downtimeHours, 0);
  const downtimeValueTotal = downtimeHoursTotal * downtimeRate;

  res.json({
    operating: {
      fuelCost,
      runtimeHours: runtimeHoursInWindow,
      runtimeCost,
      total: fuelCost + runtimeCost,
      fuelLogs: fuelLogs.map(f => ({ ...f, createdAt: f.createdAt.toISOString() })),
    },
    maintenance: {
      partsCost: partsTotal,
      laborCost: laborTotal,
      downtimeHours: downtimeHoursTotal,
      downtimeValue: downtimeValueTotal,
      total: partsTotal + laborTotal + downtimeValueTotal,
      records: maintRecords.map(m => ({ ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() })),
    },
  });
});

// ─── Linked Parts via task bundle items ──────────────────────────────────────
// Returns inventory items linked to this equipment through any task bundle item
// that has both linkedEquipmentId and linkedInventoryItemId set. These are the
// "likely parts" staff would need to reorder when a Concern-Watch check fires.

router.get("/equipment/:id/linked-parts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, res);
  if (!owned) return;

  const linkedRows = await db
    .select({
      inventoryItemId: taskBundlesItemsTable.linkedInventoryItemId,
      checkLabel: taskBundlesItemsTable.label,
    })
    .from(taskBundlesItemsTable)
    .where(and(
      eq(taskBundlesItemsTable.tenantId, tenantId),
      eq(taskBundlesItemsTable.linkedEquipmentId, equipmentId),
      isNotNull(taskBundlesItemsTable.linkedInventoryItemId),
    ));

  if (linkedRows.length === 0) { res.json([]); return; }

  // Collect all check labels per inventory item (one item can appear in multiple checks)
  const itemIdToLabels = new Map<number, string[]>();
  for (const row of linkedRows) {
    if (row.inventoryItemId == null) continue;
    const labels = itemIdToLabels.get(row.inventoryItemId) ?? [];
    if (!labels.includes(row.checkLabel)) labels.push(row.checkLabel);
    itemIdToLabels.set(row.inventoryItemId, labels);
  }

  const inventoryItemIds = Array.from(itemIdToLabels.keys());
  const [tenant] = await db.select({ defaultMarkupPct: tenantsTable.defaultMarkupPct }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const tenantMarkupPct = tenant?.defaultMarkupPct ?? 20;

  const invItems = await db.select().from(inventoryItemsTable)
    .where(and(
      eq(inventoryItemsTable.tenantId, tenantId),
      inArray(inventoryItemsTable.id, inventoryItemIds),
    ));

  const result = invItems.map(i => {
    const costPrice = i.unitPrice;
    const sellPrice = i.markedUpPrice;
    const markup = costPrice > 0 ? Math.round(((sellPrice / costPrice) - 1) * 100 * 100) / 100 : tenantMarkupPct;
    return {
      id: i.id,
      tenantId: i.tenantId,
      name: i.name,
      sku: i.sku,
      description: i.description,
      category: i.category,
      unitPrice: sellPrice,
      markupPct: markup,
      markedUpPrice: sellPrice,
      quantity: i.quantity,
      reorderPoint: i.reorderPoint,
      unit: i.unit,
      isLowStock: i.quantity <= i.reorderPoint,
      availableForBlueprint: i.availableForBlueprint,
      createdAt: i.createdAt.toISOString(),
      checkLabels: itemIdToLabels.get(i.id) ?? [],
    };
  });

  res.json(result);
});

export default router;
