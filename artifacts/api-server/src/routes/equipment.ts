import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, equipmentTable, equipmentMaintenanceTable, equipmentFuelLogsTable, equipmentReadingLogsTable, equipmentLifecycleEventsTable, tenantEquipmentTypesTable, tenantsTable, usersTable, crewsTable, crewMembersTable, jobsTable, taskBundlesItemsTable, inventoryItemsTable, internalTasksTable, bulkFuelTanksTable, bulkFuelTransactionsTable } from "@workspace/db";
import { eq, and, desc, sum, isNull, isNotNull, inArray, or, gte, lte, ilike, sql, lt } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ADMIN_ROLES, isOwnerRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
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
import { hasEquipmentVisibility } from "../lib/equipmentVisibility";
import { bulkFuelLossExceedsThreshold, dollarsToCents, dispenseBulkFuel, formatFuelLog, formatTank, formatTransaction, gallonsToThousandths, isDateKey, MAX_INVENTORY_INT, meterToThousandths, validateMeterInput, normalizeFuelDate, parseBulkFuelLossAlertSettings, tenantDateKey, type BulkFuelLossAlertSettings } from "../lib/bulkFuel";
import { invalidateTenantReportCache } from "../lib/reportsCache";
import { AdjustmentError, reconcileBulkFuel } from "../lib/bulkFuelAdjustment";

const router: IRouter = Router();
// Equipment contains tenant-private operational and inspection data. A verified
// session is mandatory, and its tenant/user identity overrides all caller headers.
router.use(requireVerifiedStaff);

// ─── Equipment Types (tenant-scoped label list) ────────────────────────────────

router.get("/equipment-types", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(tenantEquipmentTypesTable)
    .where(eq(tenantEquipmentTypesTable.tenantId, tenantId))
    .orderBy(tenantEquipmentTypesTable.sortOrder, tenantEquipmentTypesTable.id);
  res.json(rows.map(r => ({ id: r.id, label: r.label, sortOrder: r.sortOrder })));
});

router.post("/equipment-types", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { label, sortOrder } = req.body;
  if (!label || typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  const [row] = await db
    .insert(tenantEquipmentTypesTable)
    .values({ tenantId, label: label.trim(), sortOrder: sortOrder ?? 0 })
    .returning();
  res.status(201).json({ id: row.id, label: row.label, sortOrder: row.sortOrder });
});

router.put("/equipment-types/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { label, sortOrder } = req.body;
  const updates: Partial<typeof tenantEquipmentTypesTable.$inferInsert> = {};
  if (label != null) updates.label = String(label).trim();
  if (sortOrder != null) updates.sortOrder = Number(sortOrder);
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [row] = await db
    .update(tenantEquipmentTypesTable)
    .set(updates)
    .where(and(eq(tenantEquipmentTypesTable.id, id), eq(tenantEquipmentTypesTable.tenantId, tenantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Equipment type not found" }); return; }
  res.json({ id: row.id, label: row.label, sortOrder: row.sortOrder });
});

router.delete("/equipment-types/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const result = await db
    .delete(tenantEquipmentTypesTable)
    .where(and(eq(tenantEquipmentTypesTable.id, id), eq(tenantEquipmentTypesTable.tenantId, tenantId)))
    .returning({ id: tenantEquipmentTypesTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Equipment type not found" }); return; }
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const equipmentImportExportConfig: ImportExportEntityConfig = {
  entityKey: "equipment",
  fields: [
    { key: "name", header: "Name", required: true, hint: "Used to match an existing asset" },
    { key: "type", header: "Type", hint: "mower, truck, trailer, sprayer, blower, edger, chainsaw, other" },
    { key: "model", header: "Model" },
    { key: "serialNumber", header: "Serial Number" },
    { key: "year", header: "Year" },
    { key: "attachmentType", header: "Attachment Type" },
    { key: "attachmentModel", header: "Attachment Model" },
    { key: "attachmentSerialNumber", header: "Attachment Serial Number" },
    { key: "attachmentYear", header: "Attachment Year" },
    { key: "oilFilterNumber", header: "Oil Filter Number" },
    { key: "airFilterNumber", header: "Air Filter Number" },
    { key: "fuelFilterNumber", header: "Fuel Filter Number" },
    { key: "hydraulicFilterNumber", header: "Hydraulic Filter Number" },
    { key: "otherFilterNumbers", header: "Other Filter Numbers" },
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
    { key: "model", header: "Model" },
    { key: "serialNumber", header: "Serial Number" },
    { key: "year", header: "Year" },
    { key: "attachmentType", header: "Attachment Type" },
    { key: "attachmentModel", header: "Attachment Model" },
    { key: "attachmentSerialNumber", header: "Attachment Serial Number" },
    { key: "attachmentYear", header: "Attachment Year" },
    { key: "oilFilterNumber", header: "Oil Filter Number" },
    { key: "airFilterNumber", header: "Air Filter Number" },
    { key: "fuelFilterNumber", header: "Fuel Filter Number" },
    { key: "hydraulicFilterNumber", header: "Hydraulic Filter Number" },
    { key: "otherFilterNumbers", header: "Other Filter Numbers" },
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
      model: e.model ?? "",
      serialNumber: e.serialNumber ?? "",
      year: e.year ?? "",
      attachmentType: e.attachmentType ?? "",
      attachmentModel: e.attachmentModel ?? "",
      attachmentSerialNumber: e.attachmentSerialNumber ?? "",
      attachmentYear: e.attachmentYear ?? "",
      oilFilterNumber: e.oilFilterNumber ?? "",
      airFilterNumber: e.airFilterNumber ?? "",
      fuelFilterNumber: e.fuelFilterNumber ?? "",
      hydraulicFilterNumber: e.hydraulicFilterNumber ?? "",
      otherFilterNumbers: e.otherFilterNumbers ?? "",
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
      model: optionalString(raw.model) ?? null,
      serialNumber: optionalString(raw.serialNumber) ?? null,
      year: optionalNumber(raw.year, "Year", errors) ?? null,
      attachmentType: optionalString(raw.attachmentType) ?? null,
      attachmentModel: optionalString(raw.attachmentModel) ?? null,
      attachmentSerialNumber: optionalString(raw.attachmentSerialNumber) ?? null,
      attachmentYear: optionalNumber(raw.attachmentYear, "Attachment Year", errors) ?? null,
      oilFilterNumber: optionalString(raw.oilFilterNumber) ?? null,
      airFilterNumber: optionalString(raw.airFilterNumber) ?? null,
      fuelFilterNumber: optionalString(raw.fuelFilterNumber) ?? null,
      hydraulicFilterNumber: optionalString(raw.hydraulicFilterNumber) ?? null,
      otherFilterNumbers: optionalString(raw.otherFilterNumbers) ?? null,
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
  getDependents: async (tenantId, id) => {
    const [maintRow] = await db.select({ count: sql<number>`count(*)` }).from(equipmentMaintenanceTable).where(and(eq(equipmentMaintenanceTable.tenantId, tenantId), eq(equipmentMaintenanceTable.equipmentId, id)));
    const [fuelRow] = await db.select({ count: sql<number>`count(*)` }).from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.tenantId, tenantId), eq(equipmentFuelLogsTable.equipmentId, id)));
    const [readRow] = await db.select({ count: sql<number>`count(*)` }).from(equipmentReadingLogsTable).where(and(eq(equipmentReadingLogsTable.tenantId, tenantId), eq(equipmentReadingLogsTable.equipmentId, id)));
    const maintCount = Number(maintRow?.count ?? 0);
    const fuelCount = Number(fuelRow?.count ?? 0);
    const readCount = Number(readRow?.count ?? 0);
    const parts: string[] = [];
    if (maintCount > 0) parts.push(`${maintCount} maintenance record${maintCount === 1 ? "" : "s"}`);
    if (fuelCount > 0) parts.push(`${fuelCount} fuel log${fuelCount === 1 ? "" : "s"}`);
    if (readCount > 0) parts.push(`${readCount} reading log${readCount === 1 ? "" : "s"}`);
    return parts.length > 0 ? `still has ${parts.join(", ")} — delete those first, then undo this import again` : null;
  },
};
registerImportExportConfig(equipmentImportExportConfig);

router.get("/equipment/export", requireOfficeRole, async (req, res): Promise<void> => {
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
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)))
    .limit(1);
  return user?.role ?? null;
}

/** Only owner/office/department management may mutate equipment records. */
async function requireOfficeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getUserRole(tenantId, userId);
  if (!role || !ADMIN_ROLES.has(role)) {
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

function parsedId(value: string | string[] | undefined): number | null {
  const result = parseInt(Array.isArray(value) ? value[0] : value ?? "", 10);
  return Number.isInteger(result) && result > 0 ? result : null;
}

async function requireTankManager(req: Request, res: Response): Promise<boolean> {
  const role = await getUserRole(getTenantId(req), getUserId(req));
  if (!role || !ADMIN_ROLES.has(role)) {
    res.status(403).json({ error: "Office role required for bulk fuel tank management" });
    return false;
  }
  return true;
}

// ─── Bulk fuel tanks and append-only inventory history ─────────────────────────
function tenantLossAlertSettings(tenant: {
  bulkFuelLossPeriodDays: number;
  bulkFuelLossGallonThreshold: number | null;
  bulkFuelLossValueThreshold: number | null;
}): BulkFuelLossAlertSettings {
  return {
    periodDays: tenant.bulkFuelLossPeriodDays,
    gallonThreshold: tenant.bulkFuelLossGallonThreshold,
    valueThreshold: tenant.bulkFuelLossValueThreshold,
  };
}

async function getTenantLossAlertSettings(tenantId: number): Promise<BulkFuelLossAlertSettings | null> {
  const [tenant] = await db.select({
    bulkFuelLossPeriodDays: tenantsTable.bulkFuelLossPeriodDays,
    bulkFuelLossGallonThreshold: tenantsTable.bulkFuelLossGallonThreshold,
    bulkFuelLossValueThreshold: tenantsTable.bulkFuelLossValueThreshold,
  }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  return tenant ? tenantLossAlertSettings(tenant) : null;
}

router.get("/bulk-fuel/loss-alerts/settings", async (req, res): Promise<void> => {
  if (!(await requireTankManager(req, res))) return;
  const settings = await getTenantLossAlertSettings(getTenantId(req));
  if (!settings) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(settings);
});

router.put("/bulk-fuel/loss-alerts/settings", async (req, res): Promise<void> => {
  if (!(await requireTankManager(req, res))) return;
  let settings: BulkFuelLossAlertSettings;
  try {
    settings = parseBulkFuelLossAlertSettings(req.body);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
    return;
  }
  const [tenant] = await db.update(tenantsTable).set({
    bulkFuelLossPeriodDays: settings.periodDays,
    bulkFuelLossGallonThreshold: settings.gallonThreshold,
    bulkFuelLossValueThreshold: settings.valueThreshold,
  }).where(eq(tenantsTable.id, getTenantId(req))).returning({
    bulkFuelLossPeriodDays: tenantsTable.bulkFuelLossPeriodDays,
    bulkFuelLossGallonThreshold: tenantsTable.bulkFuelLossGallonThreshold,
    bulkFuelLossValueThreshold: tenantsTable.bulkFuelLossValueThreshold,
  });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(tenantLossAlertSettings(tenant));
});

router.get("/bulk-fuel/loss-alerts", async (req, res): Promise<void> => {
  if (!(await requireTankManager(req, res))) return;
  const tenantId = getTenantId(req);
  const settings = await getTenantLossAlertSettings(tenantId);
  if (!settings) { res.status(404).json({ error: "Tenant not found" }); return; }
  if (settings.gallonThreshold === null && settings.valueThreshold === null) {
    res.json({ settings, alerts: [] });
    return;
  }
  const cutoff = new Date(Date.now() - settings.periodDays * 24 * 60 * 60 * 1000);
  const rows = await db.select({
    tankId: bulkFuelTanksTable.id,
    tankName: bulkFuelTanksTable.name,
    lossThousandths: sql<number>`sum(-${bulkFuelTransactionsTable.gallonsThousandths})`,
    lossCents: sql<number>`sum(-${bulkFuelTransactionsTable.totalCostCents})`,
    adjustmentCount: sql<number>`count(*)`,
  }).from(bulkFuelTransactionsTable)
    .innerJoin(bulkFuelTanksTable, and(
      eq(bulkFuelTanksTable.id, bulkFuelTransactionsTable.tankId),
      eq(bulkFuelTanksTable.tenantId, tenantId),
    ))
    .where(and(
      eq(bulkFuelTransactionsTable.tenantId, tenantId),
      eq(bulkFuelTransactionsTable.type, "adjustment"),
      sql`${bulkFuelTransactionsTable.gallonsThousandths} < 0`,
      gte(bulkFuelTransactionsTable.createdAt, cutoff),
    ))
    .groupBy(bulkFuelTanksTable.id, bulkFuelTanksTable.name);
  const alerts = rows.map(row => ({
    tankId: row.tankId,
    tankName: row.tankName,
    lossGallons: Number(row.lossThousandths) / 1000,
    lossValue: Number(row.lossCents) / 100,
    adjustmentCount: Number(row.adjustmentCount),
  })).filter(alert => bulkFuelLossExceedsThreshold(alert.lossGallons, alert.lossValue, settings));
  res.json({ settings, alerts });
});

for (const commit of [false, true]) {
  router.post(`/bulk-fuel/tanks/:id/adjustments${commit ? "" : "/preview"}`, async (req, res): Promise<void> => {
    if (!(await requireTankManager(req, res))) return;
    const tankId = parsedId(req.params.id);
    if (!tankId) { res.status(400).json({ error: "Invalid tank id" }); return; }
    const tenantId = getTenantId(req); const actorId = getUserId(req);
    const [actor] = await db.select().from(usersTable).where(and(eq(usersTable.id, actorId), eq(usersTable.tenantId, tenantId))).limit(1);
    if (!actor) { res.status(403).json({ error: "Verified manager required" }); return; }
    try {
      const result = await db.transaction(tx => reconcileBulkFuel(tx, {
        tenantId, tankId, actorId, actorName: actor.name, body: req.body, commit,
      }));
      res.json(result);
    } catch (error) {
      if (error instanceof AdjustmentError) { res.status(error.status).json({ error: error.message }); return; }
      throw error;
    }
  });
}
router.get("/bulk-fuel/tanks", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const includeInactive = req.query.includeInactive === "true";
  const role = await getUserRole(tenantId, getUserId(req));
  if (includeInactive && (!role || !ADMIN_ROLES.has(role))) {
    res.status(403).json({ error: "Office role required to view inactive bulk fuel tanks" });
    return;
  }
  const rows = await db.select().from(bulkFuelTanksTable).where(and(
    eq(bulkFuelTanksTable.tenantId, tenantId),
    ...(includeInactive ? [] : [eq(bulkFuelTanksTable.isActive, true)]),
  )).orderBy(bulkFuelTanksTable.name);
  res.json(rows.map(formatTank));
});

router.post("/bulk-fuel/tanks", async (req, res): Promise<void> => {
  if (!(await requireTankManager(req, res))) return;
  const tenantId = getTenantId(req);
  const { name, fuelType, capacityGallons, currentMeterReading } = req.body;
  if (typeof name !== "string" || !name.trim() || typeof fuelType !== "string" || !fuelType.trim()) {
    res.status(400).json({ error: "name and fuelType are required" }); return;
  }
  let capacityThousandths: number | null = null;
  let meterThousandths: number | null = null;
  try {
    if (capacityGallons != null) capacityThousandths = gallonsToThousandths(capacityGallons, "capacityGallons");
    if (currentMeterReading !== undefined) meterThousandths = meterToThousandths(currentMeterReading);
  } catch (error: any) { res.status(400).json({ error: error.message }); return; }
  const [tank] = await db.insert(bulkFuelTanksTable).values({
    tenantId, name: name.trim(), fuelType: fuelType.trim(), capacityThousandths, meterThousandths,
  }).returning();
  res.status(201).json(formatTank(tank));
});

router.patch("/bulk-fuel/tanks/:id", async (req, res): Promise<void> => {
  if (!(await requireTankManager(req, res))) return;
  const id = parsedId(req.params.id); const tenantId = getTenantId(req);
  if (!id) { res.status(400).json({ error: "Invalid tank id" }); return; }
  const { name, fuelType, capacityGallons, isActive, currentMeterReading } = req.body;
  if (![name, fuelType, capacityGallons, isActive, currentMeterReading].some(v => v !== undefined)) { res.status(400).json({ error: "Nothing to update" }); return; }
  try {
    const updated = await db.transaction(async tx => {
      const [tank] = await tx.select().from(bulkFuelTanksTable).where(and(eq(bulkFuelTanksTable.id, id), eq(bulkFuelTanksTable.tenantId, tenantId))).for("update");
      if (!tank) throw new Error("Bulk fuel tank not found");
      const updates: Partial<typeof bulkFuelTanksTable.$inferInsert> = {};
      if (currentMeterReading !== undefined) {
        if (tank.meterThousandths != null) throw new Error("Starting meter reading is already set; record fills to advance it");
        updates.meterThousandths = meterToThousandths(currentMeterReading);
      }
      if (name !== undefined) { if (typeof name !== "string" || !name.trim()) throw new Error("name must be non-empty"); updates.name = name.trim(); }
      if (fuelType !== undefined) { if (typeof fuelType !== "string" || !fuelType.trim()) throw new Error("fuelType must be non-empty"); updates.fuelType = fuelType.trim(); }
      if (capacityGallons !== undefined) {
        const capacity = capacityGallons == null ? null : gallonsToThousandths(capacityGallons, "capacityGallons");
        if (capacity != null && capacity < tank.availableThousandths) throw new Error("capacityGallons cannot be below inventory on hand");
        updates.capacityThousandths = capacity;
      }
      if (isActive !== undefined) {
        if (typeof isActive !== "boolean") throw new Error("isActive must be boolean");
        if (!isActive && tank.availableThousandths !== 0) throw new Error("Only an empty bulk fuel tank may be deactivated");
        updates.isActive = isActive;
      }
      const [row] = await tx.update(bulkFuelTanksTable).set(updates).where(eq(bulkFuelTanksTable.id, id)).returning();
      return row;
    });
    res.json(formatTank(updated));
  } catch (error: any) { res.status(error?.message === "Bulk fuel tank not found" ? 404 : 400).json({ error: error.message }); }
});

router.get("/bulk-fuel/tanks/:id/transactions", async (req, res): Promise<void> => {
  if (!(await requireTankManager(req, res))) return;
  const id = parsedId(req.params.id); const tenantId = getTenantId(req);
  if (!id) { res.status(400).json({ error: "Invalid tank id" }); return; }
  const [tank] = await db.select({ id: bulkFuelTanksTable.id }).from(bulkFuelTanksTable).where(and(eq(bulkFuelTanksTable.id, id), eq(bulkFuelTanksTable.tenantId, tenantId))).limit(1);
  if (!tank) { res.status(404).json({ error: "Bulk fuel tank not found" }); return; }
  const limit = req.query.limit == null ? 100 : Number(req.query.limit);
  const cursor = req.query.cursor == null ? null : Number(req.query.cursor);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor != null && (!Number.isInteger(cursor) || cursor < 1))) { res.status(400).json({ error: "Invalid limit or cursor" }); return; }
  const rows = await db.select().from(bulkFuelTransactionsTable).where(and(
    eq(bulkFuelTransactionsTable.tankId, id), ...(cursor == null ? [] : [lt(bulkFuelTransactionsTable.id, cursor)]),
  )).orderBy(desc(bulkFuelTransactionsTable.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  res.json({ data: page.map(formatTransaction), nextCursor: rows.length > limit ? String(page[page.length - 1].id) : null });
});

router.post("/bulk-fuel/tanks/:id/intakes", async (req, res): Promise<void> => {
  if (!(await requireTankManager(req, res))) return;
  const id = parsedId(req.params.id); const tenantId = getTenantId(req);
  if (!id) { res.status(400).json({ error: "Invalid tank id" }); return; }
  const { kind, date, gallons, totalCost, supplier, reference, notes, idempotencyKey } = req.body;
  if (!["delivery", "opening_balance"].includes(kind) || !isDateKey(date) || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) { res.status(400).json({ error: "kind, date (YYYY-MM-DD), and idempotencyKey are required" }); return; }
  let qty: number; let cents: number;
  try { qty = gallonsToThousandths(gallons); cents = dollarsToCents(totalCost); } catch (error: any) { res.status(400).json({ error: error.message }); return; }
  try {
    const result = await db.transaction(async tx => {
      const [tank] = await tx.select().from(bulkFuelTanksTable).where(and(eq(bulkFuelTanksTable.id, id), eq(bulkFuelTanksTable.tenantId, tenantId))).for("update");
      if (!tank) throw new Error("Bulk fuel tank not found");
      if (!tank.isActive) throw new Error("Bulk fuel tank is inactive");
      const [duplicate] = await tx.select().from(bulkFuelTransactionsTable).where(and(eq(bulkFuelTransactionsTable.tankId, id), eq(bulkFuelTransactionsTable.idempotencyKey, idempotencyKey.trim()))).limit(1);
      if (duplicate) {
        if (duplicate.type !== kind || duplicate.date !== date || duplicate.gallonsThousandths !== qty || duplicate.totalCostCents !== cents || (duplicate.supplier ?? null) !== (typeof supplier === "string" ? supplier.trim() || null : null) || (duplicate.reference ?? null) !== (typeof reference === "string" ? reference.trim() || null : null) || (duplicate.notes ?? null) !== (typeof notes === "string" ? notes.trim() || null : null)) throw new Error("Idempotency key was already used with different intake details");
        return { tank, transaction: duplicate, duplicate: true };
      }
      if (kind === "opening_balance") {
        const [activity] = await tx.select({ id: bulkFuelTransactionsTable.id }).from(bulkFuelTransactionsTable).where(eq(bulkFuelTransactionsTable.tankId, id)).limit(1);
        if (activity) throw new Error("Opening balance is only allowed before other tank activity");
      }
      if (tank.availableThousandths > MAX_INVENTORY_INT - qty || tank.inventoryValueCents > MAX_INVENTORY_INT - cents || (tank.capacityThousandths != null && tank.availableThousandths + qty > tank.capacityThousandths)) throw new Error("Delivery exceeds tank capacity or inventory limits");
      const [transaction] = await tx.insert(bulkFuelTransactionsTable).values({ tankId: id, tenantId, type: kind, date, gallonsThousandths: qty, totalCostCents: cents, supplier: typeof supplier === "string" ? supplier.trim() || null : null, reference: typeof reference === "string" ? reference.trim() || null : null, notes: typeof notes === "string" ? notes.trim() || null : null, idempotencyKey: idempotencyKey.trim() }).returning();
      const [updated] = await tx.update(bulkFuelTanksTable).set({ availableThousandths: tank.availableThousandths + qty, inventoryValueCents: tank.inventoryValueCents + cents }).where(eq(bulkFuelTanksTable.id, id)).returning();
      return { tank: updated, transaction, duplicate: false };
    });
    res.status(result.duplicate ? 200 : 201).json({ tank: formatTank(result.tank), transaction: formatTransaction(result.transaction), duplicate: result.duplicate });
  } catch (error: any) { res.status(error?.message === "Bulk fuel tank not found" ? 404 : 409).json({ error: error?.message ?? "Unable to record intake" }); }
});

// Incident-scoped recovery for the three September 1 records that were written
// to the legacy seed tenant before equipment routes required verified sessions.
// Exact IDs + names + source tenant make this incapable of claiming arbitrary data.
router.get("/equipment/recover-misassigned-divine-edge", requireOwnerRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (tenantId !== 11) { res.json({ eligible: false, pendingCount: 0 }); return; }
  const rows = await db.select({ id: equipmentTable.id, name: equipmentTable.name }).from(equipmentTable).where(and(
    eq(equipmentTable.tenantId, 1),
    inArray(equipmentTable.id, [3, 4, 5]),
  ));
  const expected = new Map<number, string>([
    [3, 'Scag 52" VRide 2 2026'],
    [4, "Turfco T3000i "],
    [5, 'Scag Vride2 60" 2024'],
  ]);
  res.json({ eligible: true, pendingCount: rows.filter(row => expected.get(row.id) === row.name).length });
});

router.post("/equipment/recover-misassigned-divine-edge", requireOwnerRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (tenantId !== 11) { res.status(403).json({ error: "This recovery is only available to the Divine Edge owner" }); return; }
  const expected = new Map<number, string>([
    [3, 'Scag 52" VRide 2 2026'],
    [4, "Turfco T3000i "],
    [5, 'Scag Vride2 60" 2024'],
  ]);
  const recovered = await db.transaction(async tx => {
    const rows = await tx.select({ id: equipmentTable.id, name: equipmentTable.name }).from(equipmentTable).where(and(
      eq(equipmentTable.tenantId, 1),
      inArray(equipmentTable.id, [...expected.keys()]),
    )).for("update");
    const exact = rows.filter(row => expected.get(row.id) === row.name);
    if (exact.length) {
      await tx.update(equipmentTable).set({ tenantId }).where(and(
        eq(equipmentTable.tenantId, 1),
        inArray(equipmentTable.id, exact.map(row => row.id)),
      ));
    }
    return exact;
  });
  res.json({ recoveredCount: recovered.length, equipment: recovered });
});

/**
 * Verify that the given equipment belongs to the tenant.
 * Returns the equipment row, or sends 404 and returns null.
 */
async function requireEquipmentOwnership(
  equipmentId: number,
  tenantId: number,
  userId: number,
  res: Response,
): Promise<(typeof equipmentTable.$inferSelect) | null> {
  const [row] = await db
    .select()
    .from(equipmentTable)
    .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Equipment not found" });
    return null;
  }
  const role = await getUserRole(tenantId, userId);
  if (!role || !ADMIN_ROLES.has(role)) {
    const memberships = row.assignedCrewId == null ? [] : await db
      .select({ crewId: crewMembersTable.crewId })
      .from(crewMembersTable)
      .where(and(
        eq(crewMembersTable.tenantId, tenantId),
        eq(crewMembersTable.crewId, row.assignedCrewId),
        eq(crewMembersTable.userId, userId),
      ))
      .limit(1);
    if (!hasEquipmentVisibility(role, userId, new Set(memberships.map(membership => membership.crewId)), row)) {
      res.status(404).json({ error: "Equipment not found" });
      return null;
    }
  }
  return row;
}

/** Recheck staff assignment after the equipment row is locked for a write. */
async function canWriteLockedEquipment(tx: any, tenantId: number, userId: number, equipment: typeof equipmentTable.$inferSelect): Promise<boolean> {
  const [user] = await tx.select({ role: usersTable.role }).from(usersTable).where(and(
    eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true),
  )).limit(1);
  if (!user) return false;
  const memberships = equipment.assignedCrewId == null ? [] : await tx.select({ crewId: crewMembersTable.crewId }).from(crewMembersTable).where(and(
    eq(crewMembersTable.tenantId, tenantId), eq(crewMembersTable.crewId, equipment.assignedCrewId), eq(crewMembersTable.userId, userId),
  )).limit(1);
  return hasEquipmentVisibility(user.role, userId, new Set((memberships as Array<{ crewId: number }>).map(row => row.crewId)), equipment);
}

async function validateAssignments(
  tenantId: number,
  assignedUserId: unknown,
  assignedCrewId: unknown,
): Promise<string | null> {
  if (assignedUserId !== undefined && assignedUserId !== null) {
    if (!Number.isInteger(assignedUserId)) return "assignedUserId must be an integer or null";
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(and(
      eq(usersTable.id, assignedUserId as number),
      eq(usersTable.tenantId, tenantId),
    )).limit(1);
    if (!user) return "assignedUserId must identify an employee in this account";
  }
  if (assignedCrewId !== undefined && assignedCrewId !== null) {
    if (!Number.isInteger(assignedCrewId)) return "assignedCrewId must be an integer or null";
    const [crew] = await db.select({ id: crewsTable.id }).from(crewsTable).where(and(
      eq(crewsTable.id, assignedCrewId as number),
      eq(crewsTable.tenantId, tenantId),
    )).limit(1);
    if (!crew) return "assignedCrewId must identify a crew in this account";
  }
  return null;
}

async function getAssignmentNames(rows: Array<typeof equipmentTable.$inferSelect>) {
  const tenantId = rows[0]?.tenantId;
  const userIds = [...new Set(rows.flatMap(row => row.assignedUserId == null ? [] : [row.assignedUserId]))];
  const crewIds = [...new Set(rows.flatMap(row => row.assignedCrewId == null ? [] : [row.assignedCrewId]))];
  const [users, crews] = await Promise.all([
    userIds.length && tenantId != null ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId), inArray(usersTable.id, userIds))) : [],
    crewIds.length && tenantId != null ? db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable).where(and(eq(crewsTable.tenantId, tenantId), inArray(crewsTable.id, crewIds))) : [],
  ]);
  return {
    users: new Map(users.map(row => [row.id, row.name])),
    crews: new Map(crews.map(row => [row.id, row.name])),
  };
}

// ─── Computed fields helpers ──────────────────────────────────────────────────

function computeEquipmentMetrics(
  eq_row: typeof equipmentTable.$inferSelect,
  repairThresholdPct: number,
  resaleThresholdPct: number,
) {
  const { purchasePrice, currentHours, totalRepairCost, totalFuelCost, purchaseDate, expectedLifespanYears, expectedLifespanHours } = eq_row;

  const totalCost = purchasePrice + totalRepairCost + totalFuelCost;
  const costPerHour = expectedLifespanHours != null && expectedLifespanHours > 0
    ? totalCost / expectedLifespanHours
    : null;

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
  const hoursExceeded =
    eq_row.sellAfterHours != null && currentHours >= eq_row.sellAfterHours;

  // neverSell suppresses all sell recommendations for this unit
  const sellRecommended = !eq_row.neverSell && (repairExceeded || resaleTooLow || hoursExceeded);

  let sellReason: string | null = null;
  if (!eq_row.neverSell) {
    const reasons: string[] = [];
    if (repairExceeded) reasons.push(`Repairs exceed ${repairThresholdPct}% of purchase price.`);
    if (resaleTooLow) reasons.push(`Estimated resale value has fallen below ${resaleThresholdPct}%.`);
    if (hoursExceeded) reasons.push(`Hours (${currentHours.toFixed(0)}) have reached the sell-after threshold of ${eq_row.sellAfterHours}.`);
    sellReason = reasons.length ? reasons.join(" ") : null;
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
  assignmentNames?: { assignedUserName?: string | null; assignedCrewName?: string | null },
) {
  const metrics = computeEquipmentMetrics(row, repairThresholdPct, resaleThresholdPct);
  const maintenanceStatus = computeMaintenanceStatus(row, schedule);
  return {
    id: row.id,
    tenantId: row.tenantId,
    assignedUserId: row.assignedUserId ?? null,
    assignedCrewId: row.assignedCrewId ?? null,
    assignedUserName: assignmentNames?.assignedUserName ?? null,
    assignedCrewName: assignmentNames?.assignedCrewName ?? null,
    name: row.name,
    type: row.type,
    model: row.model ?? null,
    serialNumber: row.serialNumber ?? null,
    year: row.year ?? null,
    attachmentType: row.attachmentType ?? null,
    attachmentModel: row.attachmentModel ?? null,
    attachmentSerialNumber: row.attachmentSerialNumber ?? null,
    attachmentYear: row.attachmentYear ?? null,
    oilFilterNumber: row.oilFilterNumber ?? null,
    airFilterNumber: row.airFilterNumber ?? null,
    fuelFilterNumber: row.fuelFilterNumber ?? null,
    hydraulicFilterNumber: row.hydraulicFilterNumber ?? null,
    otherFilterNumbers: row.otherFilterNumbers ?? null,
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
    sellAfterHours: row.sellAfterHours ?? null,
    neverSell: row.neverSell ?? false,
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
  const userId = getUserId(req);
  const includeArchived = req.query.includeArchived === "true" || req.query.includeArchived === "1";
  const role = await getUserRole(tenantId, userId);
  const archiveCondition = includeArchived ? undefined : isNull(equipmentTable.archivedAt);
  let visibilityCondition = undefined;
  if (!role || !ADMIN_ROLES.has(role)) {
    const memberships = await db.select({ crewId: crewMembersTable.crewId }).from(crewMembersTable).where(and(
      eq(crewMembersTable.tenantId, tenantId),
      eq(crewMembersTable.userId, userId),
    ));
    visibilityCondition = memberships.length
      ? or(eq(equipmentTable.assignedUserId, userId), inArray(equipmentTable.assignedCrewId, memberships.map(row => row.crewId)))
      : eq(equipmentTable.assignedUserId, userId);
  }
  const whereClause = and(eq(equipmentTable.tenantId, tenantId), archiveCondition, visibilityCondition);
  const [rows, thresholds, scheduleMap] = await Promise.all([
    db.select().from(equipmentTable).where(whereClause).orderBy(equipmentTable.name),
    getTenantThresholds(tenantId),
    getScheduleMap(tenantId),
  ]);
  const names = await getAssignmentNames(rows);
  res.json(rows.map(r => formatEquipment(
    r,
    thresholds.repairThresholdPct,
    thresholds.resaleThresholdPct,
    scheduleMap.get(r.id) ?? null,
    {
      assignedUserName: r.assignedUserId == null ? null : names.users.get(r.assignedUserId) ?? null,
      assignedCrewName: r.assignedCrewId == null ? null : names.crews.get(r.assignedCrewId) ?? null,
    },
  )));
});

router.get("/equipment/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row, thresholds, scheduleMap] = await Promise.all([
    requireEquipmentOwnership(id, tenantId, userId, res),
    getTenantThresholds(tenantId),
    getScheduleMap(tenantId),
  ]);
  if (!row) return;
  const names = await getAssignmentNames([row]);
  res.json(formatEquipment(row, thresholds.repairThresholdPct, thresholds.resaleThresholdPct, scheduleMap.get(row.id) ?? null, {
    assignedUserName: row.assignedUserId == null ? null : names.users.get(row.assignedUserId) ?? null,
    assignedCrewName: row.assignedCrewId == null ? null : names.crews.get(row.assignedCrewId) ?? null,
  }));
});

router.post("/equipment", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, type, model, serialNumber, year, attachmentType, attachmentModel, attachmentSerialNumber, attachmentYear, oilFilterNumber, airFilterNumber, fuelFilterNumber, hydraulicFilterNumber, otherFilterNumbers, purchaseDate, purchasePrice, expectedLifespanYears, expectedLifespanHours, currentHours, currentMiles, notes, sellAfterHours, neverSell, assignedUserId, assignedCrewId } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const assignmentError = await validateAssignments(tenantId, assignedUserId, assignedCrewId);
  if (assignmentError) { res.status(400).json({ error: assignmentError }); return; }
  const [row] = await db.insert(equipmentTable).values({
    tenantId,
    assignedUserId: assignedUserId ?? null,
    assignedCrewId: assignedCrewId ?? null,
    name,
    type: type ?? "other",
    model: model ?? null,
    serialNumber: serialNumber ?? null,
    year: year != null ? parseInt(year, 10) : null,
    attachmentType: attachmentType ?? null,
    attachmentModel: attachmentModel ?? null,
    attachmentSerialNumber: attachmentSerialNumber ?? null,
    attachmentYear: attachmentYear != null ? parseInt(attachmentYear, 10) : null,
    oilFilterNumber: oilFilterNumber ?? null,
    airFilterNumber: airFilterNumber ?? null,
    fuelFilterNumber: fuelFilterNumber ?? null,
    hydraulicFilterNumber: hydraulicFilterNumber ?? null,
    otherFilterNumbers: otherFilterNumbers ?? null,
    purchaseDate: purchaseDate ?? null,
    purchasePrice: purchasePrice != null ? parseFloat(purchasePrice) : 0,
    expectedLifespanYears: expectedLifespanYears != null ? parseFloat(expectedLifespanYears) : null,
    expectedLifespanHours: expectedLifespanHours != null ? parseFloat(expectedLifespanHours) : null,
    currentHours: currentHours != null ? parseFloat(currentHours) : 0,
    currentMiles: currentMiles != null ? parseFloat(currentMiles) : null,
    notes: notes ?? null,
    sellAfterHours: sellAfterHours != null ? parseFloat(sellAfterHours) : null,
    neverSell: neverSell === true || neverSell === "true",
  }).returning();
  const thresholds = await getTenantThresholds(tenantId);
  const names = await getAssignmentNames([row]);
  res.status(201).json(formatEquipment(row, thresholds.repairThresholdPct, thresholds.resaleThresholdPct, null, {
    assignedUserName: row.assignedUserId == null ? null : names.users.get(row.assignedUserId) ?? null,
    assignedCrewName: row.assignedCrewId == null ? null : names.crews.get(row.assignedCrewId) ?? null,
  }));
});

router.patch("/equipment/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, type, model, serialNumber, year, attachmentType, attachmentModel, attachmentSerialNumber, attachmentYear, oilFilterNumber, airFilterNumber, fuelFilterNumber, hydraulicFilterNumber, otherFilterNumbers, purchaseDate, purchasePrice, expectedLifespanYears, expectedLifespanHours, currentHours, currentMiles, isActive, notes, sellAfterHours, neverSell, assignedUserId, assignedCrewId } = req.body;
  const assignmentError = await validateAssignments(tenantId, assignedUserId, assignedCrewId);
  if (assignmentError) { res.status(400).json({ error: assignmentError }); return; }
  const updates: Partial<typeof equipmentTable.$inferInsert> = {};
  if (assignedUserId !== undefined) updates.assignedUserId = assignedUserId;
  if (assignedCrewId !== undefined) updates.assignedCrewId = assignedCrewId;
  if (name != null) updates.name = name;
  if (type != null) updates.type = type;
  if (model !== undefined) updates.model = model || null;
  if (serialNumber !== undefined) updates.serialNumber = serialNumber || null;
  if (year !== undefined) updates.year = year != null && year !== "" ? parseInt(year, 10) : null;
  if (attachmentType !== undefined) updates.attachmentType = attachmentType || null;
  if (attachmentModel !== undefined) updates.attachmentModel = attachmentModel || null;
  if (attachmentSerialNumber !== undefined) updates.attachmentSerialNumber = attachmentSerialNumber || null;
  if (attachmentYear !== undefined) updates.attachmentYear = attachmentYear != null && attachmentYear !== "" ? parseInt(attachmentYear, 10) : null;
  if (oilFilterNumber !== undefined) updates.oilFilterNumber = oilFilterNumber || null;
  if (airFilterNumber !== undefined) updates.airFilterNumber = airFilterNumber || null;
  if (fuelFilterNumber !== undefined) updates.fuelFilterNumber = fuelFilterNumber || null;
  if (hydraulicFilterNumber !== undefined) updates.hydraulicFilterNumber = hydraulicFilterNumber || null;
  if (otherFilterNumbers !== undefined) updates.otherFilterNumbers = otherFilterNumbers || null;
  if (purchaseDate !== undefined) updates.purchaseDate = purchaseDate;
  if (purchasePrice != null) updates.purchasePrice = parseFloat(purchasePrice);
  if (expectedLifespanYears !== undefined) updates.expectedLifespanYears = expectedLifespanYears != null ? parseFloat(expectedLifespanYears) : null;
  if (expectedLifespanHours !== undefined) updates.expectedLifespanHours = expectedLifespanHours != null ? parseFloat(expectedLifespanHours) : null;
  if (currentHours != null) updates.currentHours = parseFloat(currentHours);
  if (currentMiles !== undefined) updates.currentMiles = currentMiles != null ? parseFloat(currentMiles) : null;
  if (sellAfterHours !== undefined) updates.sellAfterHours = sellAfterHours != null ? parseFloat(sellAfterHours) : null;
  if (neverSell !== undefined) updates.neverSell = neverSell === true || neverSell === "true";

  // Track whether this PATCH is a restore so we can log a lifecycle event after the update
  let isRestoring = false;
  if (isActive !== undefined) {
    updates.isActive = isActive;
    // Restoring an archived item: clear the archive stamp so it re-appears in the default list.
    if (isActive === true) {
      updates.archivedAt = null;
      isRestoring = true;
    }
  }
  if (notes !== undefined) updates.notes = notes;

  const [row] = await db.update(equipmentTable).set(updates).where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId))).returning();
  if (!row) { res.status(404).json({ error: "Equipment not found" }); return; }

  // Record restore lifecycle event
  if (isRestoring) {
    const [actor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    await db.insert(equipmentLifecycleEventsTable).values({
      equipmentId: id,
      tenantId,
      eventType: "restored",
      performedByUserId: userId,
      performedByName: actor?.name ?? null,
    });
  }

  const thresholds = await getTenantThresholds(tenantId);
  const names = await getAssignmentNames([row]);
  res.json(formatEquipment(row, thresholds.repairThresholdPct, thresholds.resaleThresholdPct, null, {
    assignedUserName: row.assignedUserId == null ? null : names.users.get(row.assignedUserId) ?? null,
    assignedCrewName: row.assignedCrewId == null ? null : names.crews.get(row.assignedCrewId) ?? null,
  }));
});

router.get("/equipment/:id/lifecycle-events", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const owned = await requireEquipmentOwnership(id, tenantId, getUserId(req), res);
  if (!owned) return;
  const rows = await db
    .select()
    .from(equipmentLifecycleEventsTable)
    .where(and(eq(equipmentLifecycleEventsTable.equipmentId, id), eq(equipmentLifecycleEventsTable.tenantId, tenantId)))
    .orderBy(desc(equipmentLifecycleEventsTable.createdAt));
  res.json(rows.map(r => ({
    id: r.id,
    equipmentId: r.equipmentId,
    tenantId: r.tenantId,
    eventType: r.eventType,
    performedByUserId: r.performedByUserId ?? null,
    performedByName: r.performedByName ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.delete("/equipment/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify ownership before touching anything
  const owned = await requireEquipmentOwnership(id, tenantId, getUserId(req), res);
  if (!owned) return;

  // Resolve the actor's display name for the audit log
  const [actor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));

  // Soft-delete: mark as archived and inactive, but keep all maintenance/fuel history intact.
  await db.update(equipmentTable)
    .set({ isActive: false, archivedAt: new Date() })
    .where(and(eq(equipmentTable.id, id), eq(equipmentTable.tenantId, tenantId)));

  // Record the lifecycle event
  await db.insert(equipmentLifecycleEventsTable).values({
    equipmentId: id,
    tenantId,
    eventType: "archived",
    performedByUserId: userId,
    performedByName: actor?.name ?? null,
  });

  res.sendStatus(204);
});

// Permanently delete equipment and cascade-delete its history. Restricted to the owner/super-admin
// role since this is the only way to lose cost data once equipment has been archived.
router.delete("/equipment/:id/hard-delete", requireOwnerRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify ownership before touching anything
  const owned = await requireEquipmentOwnership(id, tenantId, getUserId(req), res);
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
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
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
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
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
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
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
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
  if (!owned) return;
  const rows = await db
    .select()
    .from(equipmentFuelLogsTable)
    .where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)))
    .orderBy(desc(equipmentFuelLogsTable.date));
  res.json(rows.map(formatFuelLog));
});

router.post("/equipment/:id/fuel-logs", async (req, res): Promise<void> => {
  // All roles can add fuel logs
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify the equipment belongs to this tenant before inserting a child record
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
  if (!owned) return;

  // Reject new records against archived equipment
  if (owned.archivedAt) {
    res.status(409).json({ error: "Cannot log fuel fills on archived equipment" });
    return;
  }

  const { date, gallons, cost, costPerGallon, odometerReading, jobId, fuelSource = "purchased", bulkFuelTankId, idempotencyKey, meterReading, expectedMeterReading } = req.body;
  try { validateMeterInput(meterReading, expectedMeterReading, fuelSource === "bulk_tank"); }
  catch (error: any) { res.status(400).json({ error: error.message }); return; }
  if (date == null || gallons == null) { res.status(400).json({ error: "date and gallons are required" }); return; }
  if (!["purchased", "bulk_tank"].includes(fuelSource)) { res.status(400).json({ error: "fuelSource must be purchased or bulk_tank" }); return; }
  if (fuelSource === "bulk_tank" && (!Number.isInteger(bulkFuelTankId) || typeof idempotencyKey !== "string" || !idempotencyKey.trim())) {
    res.status(400).json({ error: "bulkFuelTankId and idempotencyKey are required for bulk tank fuel" }); return;
  }
  if (fuelSource === "purchased" && bulkFuelTankId != null) { res.status(400).json({ error: "bulkFuelTankId is only valid with bulk_tank fuelSource" }); return; }
  const [tenant] = await db.select({ timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  let fuelDate: string;
  try { fuelDate = normalizeFuelDate(date, tenant?.timezone ?? "UTC"); } catch (error: any) { res.status(400).json({ error: error.message }); return; }

  // Validate jobId belongs to this tenant when provided
  let parsedJobId: number | null = null;
  if (jobId != null) {
    parsedJobId = parseInt(jobId, 10);
    if (isNaN(parsedJobId)) { res.status(400).json({ error: "jobId must be an integer" }); return; }
    const [job] = await db.select({ id: jobsTable.id }).from(jobsTable)
      .where(and(eq(jobsTable.id, parsedJobId), eq(jobsTable.tenantId, tenantId)));
    if (!job) { res.status(400).json({ error: "jobId not found or does not belong to this tenant" }); return; }
  }

  let parsedGallons: number; let parsedCpg: number | null; let parsedCost: number; let parsedOdometer: number | null;
  try {
    parsedGallons = gallonsToThousandths(gallons) / 1000;
    parsedCpg = costPerGallon != null ? Number(costPerGallon) : null;
    if (parsedCpg != null && (!Number.isFinite(parsedCpg) || parsedCpg < 0)) throw new Error("costPerGallon must be a non-negative finite number");
    parsedCost = cost != null ? Number(cost) : (parsedCpg != null ? parsedGallons * parsedCpg : 0);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) throw new Error("cost must be a non-negative finite number");
    parsedOdometer = odometerReading != null ? Number(odometerReading) : null;
    if (parsedOdometer != null && (!Number.isFinite(parsedOdometer) || parsedOdometer < 0)) throw new Error("odometerReading must be non-negative");
  } catch (error: any) { res.status(400).json({ error: error.message }); return; }
  try {
    const result = await db.transaction(async tx => {
      // Every write locks equipment first, then the shared primitive locks tank.
      const [lockedEquipment] = await tx.select().from(equipmentTable).where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId))).for("update");
      if (!lockedEquipment || lockedEquipment.archivedAt) throw new Error("Cannot log fuel fills on archived equipment");
      if (!(await canWriteLockedEquipment(tx, tenantId, getUserId(req), lockedEquipment))) throw new Error("Equipment access changed");
      if (fuelSource === "bulk_tank") {
        const key = idempotencyKey.trim();
        const [prior] = await tx.select().from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.tenantId, tenantId), eq(equipmentFuelLogsTable.idempotencyKey, key))).limit(1);
        if (prior) {
          if (prior.equipmentId !== equipmentId || prior.bulkFuelTankId !== bulkFuelTankId || prior.gallons !== parsedGallons || prior.date !== fuelDate || prior.jobId !== parsedJobId || prior.odometerReading !== parsedOdometer) throw new Error("Idempotency key was already used with different fuel details");
          if (meterReading !== undefined) {
            const [movement] = await tx.select().from(bulkFuelTransactionsTable).where(and(
              eq(bulkFuelTransactionsTable.tenantId, tenantId),
              eq(bulkFuelTransactionsTable.fuelLogId, prior.id),
              eq(bulkFuelTransactionsTable.type, "dispense"),
            )).limit(1);
            if (!movement || movement.meterBeforeThousandths !== meterToThousandths(expectedMeterReading) ||
              movement.meterAfterThousandths !== meterToThousandths(meterReading)) {
              throw new Error("Idempotency key was already used with different meter readings");
            }
          }
          return { row: prior, duplicate: true };
        }
        // A deleted log deliberately leaves its dispense movement in history.
        // Do not let the old key turn a retry into a second physical draw.
        const [historicDispense] = await tx.select({ id: bulkFuelTransactionsTable.id }).from(bulkFuelTransactionsTable).where(and(
          eq(bulkFuelTransactionsTable.tankId, bulkFuelTankId),
          eq(bulkFuelTransactionsTable.idempotencyKey, key),
          eq(bulkFuelTransactionsTable.type, "dispense"),
        )).limit(1);
        if (historicDispense) throw new Error("This idempotency key belongs to a deleted fuel log and cannot be replayed");
        const bulk = await dispenseBulkFuel(tx, { tenantId, equipment: lockedEquipment, tankId: bulkFuelTankId, date: fuelDate, gallonsThousandths: Math.round(parsedGallons * 1000), jobId: parsedJobId, odometerReading: parsedOdometer, idempotencyKey: key, meterReading, expectedMeterReading });
        const [total] = await tx.select({ total: sum(equipmentFuelLogsTable.cost) }).from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)));
        await tx.update(equipmentTable).set({ totalFuelCost: Number(total?.total ?? 0), ...(parsedOdometer != null && parsedOdometer > lockedEquipment.currentHours ? { currentHours: parsedOdometer } : {}) }).where(eq(equipmentTable.id, equipmentId));
        return { row: bulk.fuel, duplicate: false };
      }
      const [row] = await tx.insert(equipmentFuelLogsTable).values({ equipmentId, tenantId, jobId: parsedJobId, date: fuelDate, gallons: parsedGallons, costPerGallon: parsedCpg, cost: parsedCost, odometerReading: parsedOdometer, fuelSource: "purchased", bulkFuelTankId: null, bulkFuelTankName: null }).returning();
      const [total] = await tx.select({ total: sum(equipmentFuelLogsTable.cost) }).from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)));
      await tx.update(equipmentTable).set({ totalFuelCost: Number(total?.total ?? 0), ...(parsedOdometer != null && parsedOdometer > lockedEquipment.currentHours ? { currentHours: parsedOdometer } : {}) }).where(eq(equipmentTable.id, equipmentId));
      return { row, duplicate: false };
    });
    invalidateTenantReportCache(tenantId);
    res.status(result.duplicate ? 200 : 201).json(formatFuelLog(result.row));
  } catch (error: any) { res.status(409).json({ error: error?.message ?? "Unable to log fuel" }); }
});

router.delete("/equipment/:equipmentId/fuel-logs/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.equipmentId) ? req.params.equipmentId[0] : req.params.equipmentId, 10);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify the equipment belongs to this tenant
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
  if (!owned) return;

  try {
    const outcome = await db.transaction(async tx => {
      const [lockedEquipment] = await tx.select().from(equipmentTable).where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId))).for("update");
      if (!lockedEquipment) throw new Error("Equipment not found");
      const [fuel] = await tx.select().from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.id, id), eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId))).for("update");
      if (!fuel) return "missing" as const;
      if (fuel.fuelSource === "bulk_tank") {
        if (fuel.bulkFuelTankId == null) throw new Error("Bulk fuel log has no linked tank");
        const [tank] = await tx.select().from(bulkFuelTanksTable).where(and(eq(bulkFuelTanksTable.id, fuel.bulkFuelTankId), eq(bulkFuelTanksTable.tenantId, tenantId))).for("update");
        if (!tank) throw new Error("Bulk fuel tank no longer exists");
        if (!tank.isActive) throw new Error("Cannot refund fuel into an inactive bulk fuel tank");
        const gallonsThousandths = gallonsToThousandths(fuel.gallons);
        const cents = dollarsToCents(fuel.cost);
        if (tank.availableThousandths > MAX_INVENTORY_INT - gallonsThousandths || tank.inventoryValueCents > MAX_INVENTORY_INT - cents || (tank.capacityThousandths != null && tank.availableThousandths + gallonsThousandths > tank.capacityThousandths)) throw new Error("Fuel refund exceeds tank capacity or inventory limits");
        await tx.insert(bulkFuelTransactionsTable).values({ tankId: tank.id, tenantId, type: "reversal", date: fuel.date, gallonsThousandths, totalCostCents: cents, equipmentId, equipmentName: lockedEquipment.name, fuelLogId: fuel.id, notes: "Fuel log deletion refund" });
        await tx.update(bulkFuelTanksTable).set({ availableThousandths: tank.availableThousandths + gallonsThousandths, inventoryValueCents: tank.inventoryValueCents + cents }).where(eq(bulkFuelTanksTable.id, tank.id));
      }
      await tx.delete(equipmentFuelLogsTable).where(eq(equipmentFuelLogsTable.id, fuel.id));
      const [total] = await tx.select({ total: sum(equipmentFuelLogsTable.cost) }).from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)));
      await tx.update(equipmentTable).set({ totalFuelCost: Number(total?.total ?? 0) }).where(eq(equipmentTable.id, equipmentId));
      return "deleted" as const;
    });
    if (outcome === "missing") { res.status(404).json({ error: "Fuel log not found" }); return; }
    invalidateTenantReportCache(tenantId);
    res.sendStatus(204);
  } catch (error: any) { res.status(409).json({ error: error?.message ?? "Unable to delete fuel log" }); }
});

// ─── Reading Logs Sub-resource ────────────────────────────────────────────────

router.post("/equipment/:id/reading-logs", async (req, res): Promise<void> => {
  // All roles (including technicians) can log readings
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
  if (!owned) return;

  if (owned.archivedAt) {
    res.status(409).json({ error: "Cannot log readings on archived equipment" });
    return;
  }

  const { date, readingType, value } = req.body;
  if (!date || !readingType || value == null) {
    res.status(400).json({ error: "date, readingType, and value are required" });
    return;
  }
  if (readingType !== "hours" && readingType !== "mileage") {
    res.status(400).json({ error: "readingType must be 'hours' or 'mileage'" });
    return;
  }

  const parsedValue = parseFloat(value);
  if (isNaN(parsedValue) || parsedValue < 0) {
    res.status(400).json({ error: "value must be a non-negative number" });
    return;
  }

  const [row] = await db.insert(equipmentReadingLogsTable).values({
    equipmentId,
    tenantId,
    date,
    readingType,
    value: parsedValue,
    source: "manual",
  }).returning();

  // Update the equipment's currentHours/currentMiles to the new reading if it's higher
  // (or if this is the first mileage reading and currentMiles is still null)
  if (readingType === "hours" && parsedValue > owned.currentHours) {
    await db.update(equipmentTable)
      .set({ currentHours: parsedValue })
      .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));
  } else if (readingType === "mileage" && (owned.currentMiles == null || parsedValue > owned.currentMiles)) {
    await db.update(equipmentTable)
      .set({ currentMiles: parsedValue })
      .where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));
  }

  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
});

// One atomic pre-trip submission. The inspection task stores the idempotency key:
// it is created last within the same transaction, so a duplicate key proves every
// associated fuel and reading write committed as one unit.
router.post("/equipment/pre-trip", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { idempotencyKey, equipmentId, condition, fuelGallons, fuelCost, fuelSource = "purchased", bulkFuelTankId, readingType, readingValue, concerns, checklistResponses, inspectionType = "pre_trip", meterReading, expectedMeterReading } = req.body;
  try { validateMeterInput(meterReading, expectedMeterReading, fuelSource === "bulk_tank" && fuelGallons != null); }
  catch (error: any) { res.status(400).json({ error: error.message }); return; }
  if (!["pre_trip", "end_of_day"].includes(inspectionType)) { res.status(400).json({ error: "inspectionType must be pre_trip or end_of_day" }); return; }
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) { res.status(400).json({ error: "idempotencyKey is required" }); return; }
  const normalizedIdempotencyKey = idempotencyKey.trim();
  if (!Number.isInteger(equipmentId)) { res.status(400).json({ error: "equipmentId must be an integer" }); return; }
  if (!["good", "needs_attention", "unsafe"].includes(condition)) { res.status(400).json({ error: "condition must be good, needs_attention, or unsafe" }); return; }
  const hasFuel = fuelGallons != null;
  const hasReading = readingValue != null;
  const gallons = hasFuel ? Number(fuelGallons) : null;
  const cost = fuelCost != null ? Number(fuelCost) : null;
  const reading = hasReading ? Number(readingValue) : null;
  if (hasFuel && (!Number.isFinite(gallons) || gallons! <= 0)) { res.status(400).json({ error: "fuelGallons must be a positive number" }); return; }
  let fuelThousandths: number | null = null;
  if (gallons != null) {
    try { fuelThousandths = gallonsToThousandths(gallons, "fuelGallons"); } catch (error: any) { res.status(400).json({ error: error.message }); return; }
  }
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) { res.status(400).json({ error: "fuelCost must be a non-negative number" }); return; }
  if (cost != null && !hasFuel) { res.status(400).json({ error: "fuelCost requires fuelGallons" }); return; }
  if (!["purchased", "bulk_tank"].includes(fuelSource)) { res.status(400).json({ error: "fuelSource must be purchased or bulk_tank" }); return; }
  if (fuelSource === "bulk_tank" && hasFuel && !Number.isInteger(bulkFuelTankId)) { res.status(400).json({ error: "bulkFuelTankId is required for bulk tank fuel" }); return; }
  if (fuelSource === "bulk_tank" && !hasFuel) { res.status(400).json({ error: "bulkFuelTankId requires fuelGallons" }); return; }
  if (hasReading && (!["hours", "mileage"].includes(readingType) || !Number.isFinite(reading) || reading! < 0)) { res.status(400).json({ error: "readingType and a non-negative readingValue are required together" }); return; }
  const accessibleEquipment = await requireEquipmentOwnership(equipmentId, tenantId, userId, res);
  if (!accessibleEquipment) return;
  const [[tenant], [equipment]] = await Promise.all([
    db.select({ preTripChecklist: tenantsTable.preTripChecklist, preTripChecklistName: tenantsTable.preTripChecklistName, endOfDayChecklist: tenantsTable.endOfDayChecklist, timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1),
    db.select({ type: equipmentTable.type, archivedAt: equipmentTable.archivedAt }).from(equipmentTable).where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId))).limit(1),
  ]);
  if (!equipment) { res.status(404).json({ error: "Equipment not found" }); return; }
  if (equipment.archivedAt) { res.status(400).json({ error: "Cannot inspect archived equipment" }); return; }
  const configuredChecklist = ((inspectionType === "end_of_day" ? tenant?.endOfDayChecklist : tenant?.preTripChecklist) as Array<{ id: string; label: string; required: boolean; equipmentTypes?: string[] }> | null) ?? [];
  if (inspectionType === "end_of_day" && configuredChecklist.length === 0) { res.status(400).json({ error: "End-of-day checklist is not enabled" }); return; }
  const applicableChecklist = configuredChecklist.filter(item =>
    !Array.isArray(item.equipmentTypes) ||
    item.equipmentTypes.length === 0 ||
    item.equipmentTypes.includes(equipment.type),
  );
  const submitted = new Map((Array.isArray(checklistResponses) ? checklistResponses : []).filter(item => item && typeof item.id === "string").map(item => [item.id, item.checked === true]));
  const checklist = applicableChecklist.map(item => ({ id: item.id, label: item.label, checked: submitted.get(item.id) === true }));
  const missingRequired = applicableChecklist.filter(item => item.required && submitted.get(item.id) !== true);
  if (missingRequired.length) { res.status(400).json({ error: "Complete all required checklist questions" }); return; }
  const today = tenantDateKey(new Date(), tenant?.timezone ?? "UTC");
  const requestFingerprint = JSON.stringify({
    equipmentId, condition, inspectionType,
    ...(meterReading !== undefined ? { meterReading, expectedMeterReading } : {}),
    fuelGallons: fuelThousandths,
    fuelSource: gallons == null ? null : fuelSource,
    bulkFuelTankId: gallons != null && fuelSource === "bulk_tank" ? bulkFuelTankId : null,
    // Bulk price is server-authoritative and deliberately excluded.
    purchasedFuelCents: gallons != null && fuelSource === "purchased" ? dollarsToCents(cost ?? 0, "fuelCost") : null,
    readingType: readingType ?? null, readingValue: reading ?? null,
    concerns: typeof concerns === "string" ? concerns.trim() || null : null,
    checklist: checklist.map(item => ({ id: item.id, checked: item.checked })).sort((a, b) => a.id.localeCompare(b.id)),
  });
  const existing = await db.select().from(internalTasksTable).where(and(eq(internalTasksTable.tenantId, tenantId), eq(internalTasksTable.idempotencyKey, normalizedIdempotencyKey))).limit(1);
  if (existing[0]) {
    if (existing[0].contextType !== "equipment" || existing[0].contextId !== equipmentId || existing[0].preTripRequestFingerprint == null || existing[0].preTripRequestFingerprint !== requestFingerprint) {
      res.status(409).json({ error: "Idempotency key was already used with different or unverifiable pre-trip details" }); return;
    }
    const [fuel] = existing[0].preTripFuelLogId == null ? [] : await db.select().from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.id, existing[0].preTripFuelLogId), eq(equipmentFuelLogsTable.tenantId, tenantId))).limit(1);
    res.json({ taskId: existing[0].id, ...(existing[0].preTripFuelLogId != null ? { fuelLogId: existing[0].preTripFuelLogId } : {}), ...(existing[0].preTripReadingLogId != null ? { readingLogId: existing[0].preTripReadingLogId } : {}), ...(fuel ? { fuelCost: fuel.cost, fuelCostPerGallon: fuel.costPerGallon, fuelSource: fuel.fuelSource, bulkFuelTankName: fuel.bulkFuelTankName } : {}), duplicate: true }); return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [owned] = await tx.select().from(equipmentTable).where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId))).for("update");
      if (!owned) throw new Error("Equipment not found");
      if (owned.archivedAt) throw new Error("Cannot inspect archived equipment");
      if (!(await canWriteLockedEquipment(tx, tenantId, userId, owned))) throw new Error("Equipment access changed");
      if (readingType === "hours" && reading != null && reading < owned.currentHours) throw new Error(`Hour reading cannot be below current reading (${owned.currentHours})`);
      if (readingType === "mileage" && reading != null && owned.currentMiles != null && reading < owned.currentMiles) throw new Error(`Mileage reading cannot be below current reading (${owned.currentMiles})`);
      let fuelLogId: number | null = null;
      let recordedFuel: typeof equipmentFuelLogsTable.$inferSelect | null = null;
      let readingLogId: number | null = null;
      if (gallons != null) {
        if (fuelSource === "bulk_tank") {
          const bulk = await dispenseBulkFuel(tx, { tenantId, equipment: owned, tankId: bulkFuelTankId, date: today, gallonsThousandths: fuelThousandths!, jobId: null, odometerReading: null, idempotencyKey: normalizedIdempotencyKey, meterReading, expectedMeterReading });
          recordedFuel = bulk.fuel; fuelLogId = bulk.fuel.id;
        } else {
          const [fuel] = await tx.insert(equipmentFuelLogsTable).values({ equipmentId, tenantId, date: today, gallons, cost: cost ?? 0, costPerGallon: gallons ? (cost ?? 0) / gallons : 0, odometerReading: null, fuelSource: "purchased", bulkFuelTankId: null, bulkFuelTankName: null }).returning();
          recordedFuel = fuel; fuelLogId = fuel.id;
        }
      }
      if (reading != null) {
        const [entry] = await tx.insert(equipmentReadingLogsTable).values({ equipmentId, tenantId, date: new Date().toISOString().slice(0, 10), readingType, value: reading, source: "manual" }).returning();
        readingLogId = entry.id;
      }
      const updates: Partial<typeof equipmentTable.$inferInsert> = {};
      if (gallons != null) {
        const [total] = await tx.select({ total: sum(equipmentFuelLogsTable.cost) }).from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.equipmentId, equipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)));
        updates.totalFuelCost = Number(total?.total ?? 0);
      }
      if (readingType === "hours" && reading != null && reading > owned.currentHours) updates.currentHours = reading;
      if (readingType === "mileage" && reading != null && (owned.currentMiles == null || reading > owned.currentMiles)) updates.currentMiles = reading;
      if (Object.keys(updates).length) await tx.update(equipmentTable).set(updates).where(and(eq(equipmentTable.id, equipmentId), eq(equipmentTable.tenantId, tenantId)));
      const isEndOfDay = inspectionType === "end_of_day";
      const fuelDescription = recordedFuel ? `\nFuel: ${recordedFuel.fuelSource === "bulk_tank" ? `Bulk tank ${recordedFuel.bulkFuelTankName}` : "Purchased"} — ${recordedFuel.gallons} gal at $${(recordedFuel.costPerGallon ?? 0).toFixed(2)}/gal ($${recordedFuel.cost.toFixed(2)}).` : "";
      const [task] = await tx.insert(internalTasksTable).values({ tenantId, title: `${isEndOfDay ? "End-of-day" : tenant?.preTripChecklistName ?? "Pre-trip"} inspection: ${owned.name}`, description: `Condition: ${condition.replace("_", " ")}.${fuelDescription}${typeof concerns === "string" && concerns.trim() ? `\nConcerns: ${concerns.trim()}` : ""}`, taskType: isEndOfDay ? "end_of_day_inspection" : "pre_trip_inspection", createdById: userId, assignedToRole: "admin_office", priority: condition === "unsafe" ? "urgent" : condition === "needs_attention" ? "high" : "normal", status: "open", contextType: "equipment", contextId: equipmentId, idempotencyKey: normalizedIdempotencyKey, preTripRequestFingerprint: requestFingerprint, preTripFuelLogId: fuelLogId, preTripReadingLogId: readingLogId, preTripChecklistSnapshot: checklist }).returning();
      return { taskId: task.id, ...(fuelLogId != null ? { fuelLogId } : {}), ...(readingLogId != null ? { readingLogId } : {}), ...(recordedFuel ? { fuelCost: recordedFuel.cost, fuelCostPerGallon: recordedFuel.costPerGallon, fuelSource: recordedFuel.fuelSource, bulkFuelTankName: recordedFuel.bulkFuelTankName } : {}), duplicate: false };
    });
    invalidateTenantReportCache(tenantId);
    res.status(201).json(result);
  } catch (error: any) {
    // A concurrent retry may have won after our initial lookup.
    const [duplicate] = await db.select().from(internalTasksTable).where(and(eq(internalTasksTable.tenantId, tenantId), eq(internalTasksTable.idempotencyKey, normalizedIdempotencyKey))).limit(1);
    if (duplicate) {
      if (duplicate.contextType !== "equipment" || duplicate.contextId !== equipmentId || duplicate.preTripRequestFingerprint == null || duplicate.preTripRequestFingerprint !== requestFingerprint) { res.status(409).json({ error: "Idempotency key was already used with different or unverifiable pre-trip details" }); return; }
      const [fuel] = duplicate.preTripFuelLogId == null ? [] : await db.select().from(equipmentFuelLogsTable).where(and(eq(equipmentFuelLogsTable.id, duplicate.preTripFuelLogId), eq(equipmentFuelLogsTable.tenantId, tenantId))).limit(1);
      res.json({ taskId: duplicate.id, ...(duplicate.preTripFuelLogId != null ? { fuelLogId: duplicate.preTripFuelLogId } : {}), ...(duplicate.preTripReadingLogId != null ? { readingLogId: duplicate.preTripReadingLogId } : {}), ...(fuel ? { fuelCost: fuel.cost, fuelCostPerGallon: fuel.costPerGallon, fuelSource: fuel.fuelSource, bulkFuelTankName: fuel.bulkFuelTankName } : {}), duplicate: true }); return;
    }
    const message = error?.message ?? "Unable to save pre-trip";
    res.status(message === "Equipment not found" ? 404 : message.startsWith("Tank meter reading changed.") ? 409 : 400).json({ error: message });
  }
});

// ─── Cost Ledger: Operating vs. Maintenance & Repair ────────────────────────────
// Two independent running-total views over the same asset's history, filterable
// by date range. Operating = fuel spend + a runtime-hours cost factor (from
// hour-meter readings logged via Daily Tasks). Maintenance & Repair = parts +
// labor + the value of downtime, from equipment_maintenance records.

router.get("/equipment/:id/ledger", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const equipmentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
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
      fuelLogs: fuelLogs.map(formatFuelLog),
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
  const owned = await requireEquipmentOwnership(equipmentId, tenantId, getUserId(req), res);
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
