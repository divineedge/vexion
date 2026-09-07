import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db, taskBundlesTable, taskBundlesItemsTable, taskBundleCompletionsTable,
  equipmentTable, equipmentFuelLogsTable, equipmentReadingLogsTable, equipmentMaintenanceTable,
  inventoryItemsTable, shrinkageReportsTable, internalTasksTable, taskNotificationsTable,
  usersTable, tenantsTable,
} from "@workspace/db";
import { eq, and, desc, gte, lte, sql, sum } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ADMIN_ROLES, getCallerRole } from "../lib/roles";
import { roleBucketMatches } from "../lib/taskRouting";
import { canAccessEquipment } from "../lib/equipmentAccess";

const router: IRouter = Router();

// ─── Auth helpers ──────────────────────────────────────────────────────────────

/** Only admin/office may build/edit bundles; anyone can run their assigned ones. */
async function requireAdminRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  if (!ADMIN_ROLES.has(role)) {
    res.status(403).json({ error: "Admin or office role required" });
    return;
  }
  next();
}

type Bundle = typeof taskBundlesTable.$inferSelect;
type BundleItem = typeof taskBundlesItemsTable.$inferSelect;
type Completion = typeof taskBundleCompletionsTable.$inferSelect;

function formatBundle(b: Bundle, itemCount: number, assignedToName: string | null) {
  return {
    ...b,
    assignedToName,
    itemCount,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function formatItem(i: BundleItem) {
  return { ...i, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() };
}

function formatCompletion(c: Completion, extras?: { bundleName?: string; userName?: string }) {
  return {
    ...c,
    bundleName: extras?.bundleName ?? null,
    userName: extras?.userName ?? null,
    startedAt: c.startedAt.toISOString(),
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

async function requireBundleOwnership(id: number, tenantId: number, res: Response): Promise<Bundle | null> {
  const [row] = await db.select().from(taskBundlesTable).where(and(eq(taskBundlesTable.id, id), eq(taskBundlesTable.tenantId, tenantId)));
  if (!row) { res.status(404).json({ error: "Task bundle not found" }); return null; }
  return row;
}

/**
 * Bundle items can reference equipment/inventory by id from client input. Since those tables'
 * FKs are on the global id only (not a composite equipment_id+tenant_id key), an unvalidated
 * reference would let one tenant link (and later write cost/count data against) another
 * tenant's equipment or inventory item. Always confirm the referenced row belongs to the
 * caller's tenant before persisting a link, both at item write-time and again defensively
 * whenever a completion is about to use that link to write cost-ledger data.
 */
async function validateLinkedRefs(
  tenantId: number,
  linkedEquipmentId: number | null,
  linkedInventoryItemId: number | null,
): Promise<string | null> {
  if (linkedEquipmentId != null) {
    const [row] = await db.select({ id: equipmentTable.id }).from(equipmentTable)
      .where(and(eq(equipmentTable.id, linkedEquipmentId), eq(equipmentTable.tenantId, tenantId)));
    if (!row) return "linkedEquipmentId does not refer to equipment in this account";
  }
  if (linkedInventoryItemId != null) {
    const [row] = await db.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.id, linkedInventoryItemId), eq(inventoryItemsTable.tenantId, tenantId)));
    if (!row) return "linkedInventoryItemId does not refer to an inventory item in this account";
  }
  return null;
}

/** Field users may only run or inspect bundles whose linked assets they can access now. */
async function canAccessBundleEquipment(tenantId: number, userId: number, role: string, items: BundleItem[]) {
  if (ADMIN_ROLES.has(role)) return true;
  const equipmentIds = [...new Set(items.flatMap(item => item.linkedEquipmentId == null ? [] : [item.linkedEquipmentId]))];
  return (await Promise.all(equipmentIds.map(id => canAccessEquipment(tenantId, userId, id)))).every(Boolean);
}

// ─── Task Bundles CRUD ──────────────────────────────────────────────────────────

router.get("/task-bundles", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const scope = req.query.scope as string | undefined;

  const rows = await db.select().from(taskBundlesTable).where(and(eq(taskBundlesTable.tenantId, tenantId), eq(taskBundlesTable.isActive, true)));

  let visible = rows;
  if (scope === "mine") {
    const role = await getCallerRole(tenantId, userId);
    visible = rows.filter(b => b.assignedToUserId === userId || (b.assignedToRole != null && roleBucketMatches(b.assignedToRole, role)));
  }

  const userIds = Array.from(new Set(visible.map(b => b.assignedToUserId).filter((x): x is number => x != null)));
  const users = userIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.tenantId, tenantId))
    : [];
  const userMap = new Map(users.map(u => [u.id, u.name]));

  const itemCounts = await db.select({ bundleId: taskBundlesItemsTable.bundleId, count: sql<number>`count(*)` })
    .from(taskBundlesItemsTable)
    .where(eq(taskBundlesItemsTable.tenantId, tenantId))
    .groupBy(taskBundlesItemsTable.bundleId);
  const countMap = new Map(itemCounts.map(c => [c.bundleId, Number(c.count)]));

  res.json(visible.map(b => formatBundle(b, countMap.get(b.id) ?? 0, b.assignedToUserId != null ? (userMap.get(b.assignedToUserId) ?? null) : null)));
});

router.get("/task-bundles/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(String(req.params.id), 10);
  const bundle = await requireBundleOwnership(id, tenantId, res);
  if (!bundle) return;
  const items = await db.select().from(taskBundlesItemsTable).where(and(eq(taskBundlesItemsTable.bundleId, id), eq(taskBundlesItemsTable.tenantId, tenantId))).orderBy(taskBundlesItemsTable.order);
  const role = await getCallerRole(tenantId, userId);
  if (!(await canAccessBundleEquipment(tenantId, userId, role, items))) { res.status(404).json({ error: "Task bundle not found" }); return; }
  res.json({ ...formatBundle(bundle, items.length, null), items: items.map(formatItem) });
});

router.post("/task-bundles", requireAdminRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, description, frequency, assignedToUserId, assignedToRole, assignedToCrewId, items } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (!assignedToUserId && !assignedToRole && !assignedToCrewId) { res.status(400).json({ error: "Bundle must be assigned to a person, role, or crew" }); return; }

  const [bundle] = await db.insert(taskBundlesTable).values({
    tenantId,
    name,
    description: description ?? null,
    frequency: frequency ?? "daily",
    assignedToUserId: assignedToUserId ?? null,
    assignedToRole: assignedToRole ?? null,
    assignedToCrewId: assignedToCrewId ? parseInt(String(assignedToCrewId), 10) : null,
  }).returning();

  let createdItems: BundleItem[] = [];
  if (Array.isArray(items) && items.length > 0) {
    const normalizedItems = items.map((it: Record<string, unknown>, idx: number) => ({
      tenantId,
      bundleId: bundle.id,
      type: it.type as string,
      label: it.label as string,
      order: it.order != null ? Number(it.order) : idx,
      linkedEquipmentId: it.linkedEquipmentId != null ? Number(it.linkedEquipmentId) : null,
      linkedInventoryItemId: it.linkedInventoryItemId != null ? Number(it.linkedInventoryItemId) : null,
      config: it.config ?? {},
    }));
    for (const it of normalizedItems) {
      const error = await validateLinkedRefs(tenantId, it.linkedEquipmentId, it.linkedInventoryItemId);
      if (error) {
        // Bundle row was already created; remove it so we don't leave an orphaned empty bundle.
        await db.delete(taskBundlesTable).where(eq(taskBundlesTable.id, bundle.id));
        res.status(400).json({ error });
        return;
      }
    }
    createdItems = await db.insert(taskBundlesItemsTable).values(normalizedItems).returning();
  }

  res.status(201).json({ ...formatBundle(bundle, createdItems.length, null), items: createdItems.map(formatItem) });
});

router.patch("/task-bundles/:id", requireAdminRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(String(req.params.id), 10);
  const owned = await requireBundleOwnership(id, tenantId, res);
  if (!owned) return;

  const { name, description, frequency, assignedToUserId, assignedToRole, assignedToCrewId, isActive } = req.body;
  const updates: Partial<typeof taskBundlesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description || null;
  if (frequency !== undefined) updates.frequency = frequency;
  if (assignedToUserId !== undefined || assignedToRole !== undefined || assignedToCrewId !== undefined) {
    // Clear all three, then set whichever was provided
    updates.assignedToUserId = null;
    updates.assignedToRole = null;
    updates.assignedToCrewId = null;
    if (assignedToUserId != null) updates.assignedToUserId = parseInt(String(assignedToUserId), 10);
    else if (assignedToRole != null) updates.assignedToRole = assignedToRole;
    else if (assignedToCrewId != null) updates.assignedToCrewId = parseInt(String(assignedToCrewId), 10);
    const hasAssignment = updates.assignedToUserId != null || updates.assignedToRole != null || updates.assignedToCrewId != null;
    if (!hasAssignment) { res.status(400).json({ error: "Bundle must be assigned to a person, role, or crew" }); return; }
  }
  if (isActive !== undefined) updates.isActive = isActive;

  const [row] = await db.update(taskBundlesTable).set(updates).where(and(eq(taskBundlesTable.id, id), eq(taskBundlesTable.tenantId, tenantId))).returning();
  const items = await db.select().from(taskBundlesItemsTable).where(and(eq(taskBundlesItemsTable.bundleId, id), eq(taskBundlesItemsTable.tenantId, tenantId)));
  res.json({ ...formatBundle(row, items.length, null), items: items.map(formatItem) });
});

router.delete("/task-bundles/:id", requireAdminRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(String(req.params.id), 10);
  const owned = await requireBundleOwnership(id, tenantId, res);
  if (!owned) return;

  const [existingCompletion] = await db.select({ id: taskBundleCompletionsTable.id }).from(taskBundleCompletionsTable)
    .where(and(eq(taskBundleCompletionsTable.bundleId, id), eq(taskBundleCompletionsTable.tenantId, tenantId))).limit(1);
  if (existingCompletion) {
    res.status(409).json({ error: "This bundle has completion history and cannot be deleted. Deactivate it instead." });
    return;
  }

  await db.delete(taskBundlesItemsTable).where(and(eq(taskBundlesItemsTable.bundleId, id), eq(taskBundlesItemsTable.tenantId, tenantId)));
  await db.delete(taskBundlesTable).where(and(eq(taskBundlesTable.id, id), eq(taskBundlesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ─── Task Bundle Items CRUD ─────────────────────────────────────────────────────

router.post("/task-bundles/:id/items", requireAdminRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const bundleId = parseInt(String(req.params.id), 10);
  const owned = await requireBundleOwnership(bundleId, tenantId, res);
  if (!owned) return;

  const { type, label, order, linkedEquipmentId, linkedInventoryItemId, config } = req.body;
  if (!type || !label) { res.status(400).json({ error: "type and label are required" }); return; }

  const linkError = await validateLinkedRefs(
    tenantId,
    linkedEquipmentId != null ? Number(linkedEquipmentId) : null,
    linkedInventoryItemId != null ? Number(linkedInventoryItemId) : null,
  );
  if (linkError) { res.status(400).json({ error: linkError }); return; }

  const [row] = await db.insert(taskBundlesItemsTable).values({
    tenantId,
    bundleId,
    type,
    label,
    order: order != null ? Number(order) : 0,
    linkedEquipmentId: linkedEquipmentId != null ? Number(linkedEquipmentId) : null,
    linkedInventoryItemId: linkedInventoryItemId != null ? Number(linkedInventoryItemId) : null,
    config: config ?? {},
  }).returning();
  res.status(201).json(formatItem(row));
});

router.patch("/task-bundle-items/:id", requireAdminRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(String(req.params.id), 10);
  const { type, label, order, linkedEquipmentId, linkedInventoryItemId, config } = req.body;
  const updates: Partial<typeof taskBundlesItemsTable.$inferInsert> = {};
  if (type !== undefined) updates.type = type;
  if (label !== undefined) updates.label = label;
  if (order !== undefined) updates.order = Number(order);
  if (linkedEquipmentId !== undefined) updates.linkedEquipmentId = linkedEquipmentId != null ? Number(linkedEquipmentId) : null;
  if (linkedInventoryItemId !== undefined) updates.linkedInventoryItemId = linkedInventoryItemId != null ? Number(linkedInventoryItemId) : null;
  if (config !== undefined) updates.config = config;

  if (updates.linkedEquipmentId !== undefined || updates.linkedInventoryItemId !== undefined) {
    const linkError = await validateLinkedRefs(
      tenantId,
      updates.linkedEquipmentId !== undefined ? updates.linkedEquipmentId : null,
      updates.linkedInventoryItemId !== undefined ? updates.linkedInventoryItemId : null,
    );
    if (linkError) { res.status(400).json({ error: linkError }); return; }
  }

  const [row] = await db.update(taskBundlesItemsTable).set(updates).where(and(eq(taskBundlesItemsTable.id, id), eq(taskBundlesItemsTable.tenantId, tenantId))).returning();
  if (!row) { res.status(404).json({ error: "Task bundle item not found" }); return; }
  res.json(formatItem(row));
});

router.delete("/task-bundle-items/:id", requireAdminRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(String(req.params.id), 10);
  const [deleted] = await db.delete(taskBundlesItemsTable)
    .where(and(eq(taskBundlesItemsTable.id, id), eq(taskBundlesItemsTable.tenantId, tenantId)))
    .returning({ id: taskBundlesItemsTable.id });
  if (!deleted) { res.status(404).json({ error: "Task bundle item not found" }); return; }
  res.sendStatus(204);
});

// ─── Timer flow: start / complete ───────────────────────────────────────────────

router.post("/task-bundles/:id/start", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const bundleId = parseInt(String(req.params.id), 10);
  const bundle = await requireBundleOwnership(bundleId, tenantId, res);
  if (!bundle) return;

  const role = await getCallerRole(tenantId, userId);
  const isAllowed = bundle.assignedToUserId === userId
    || (bundle.assignedToRole != null && roleBucketMatches(bundle.assignedToRole, role))
    || ADMIN_ROLES.has(role);
  if (!isAllowed) { res.status(403).json({ error: "You are not assigned to this bundle" }); return; }
  const items = await db.select().from(taskBundlesItemsTable).where(and(
    eq(taskBundlesItemsTable.bundleId, bundleId),
    eq(taskBundlesItemsTable.tenantId, tenantId),
  ));
  if (!(await canAccessBundleEquipment(tenantId, userId, role, items))) { res.status(404).json({ error: "Task bundle not found" }); return; }

  const [row] = await db.insert(taskBundleCompletionsTable).values({
    tenantId,
    bundleId,
    userId,
    status: "in_progress",
  }).returning();
  res.status(201).json(formatCompletion(row, { bundleName: bundle.name }));
});

interface ItemResultInput {
  itemId: number;
  type: string;
  label: string;
  value?: string | number | null;
  status?: "pass" | "fail" | "concern" | null;
  note?: string | null;
  /** For warehouse_inventory_count items: [{ inventoryItemId, actualCount }] */
  counts?: { inventoryItemId: number; actualCount: number }[];
}

router.post("/task-bundle-completions/:id/complete", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(String(req.params.id), 10);

  const [completion] = await db.select().from(taskBundleCompletionsTable)
    .where(and(eq(taskBundleCompletionsTable.id, id), eq(taskBundleCompletionsTable.tenantId, tenantId)));
  if (!completion) { res.status(404).json({ error: "Completion not found" }); return; }

  const role = await getCallerRole(tenantId, userId);
  if (completion.userId !== userId && !ADMIN_ROLES.has(role)) {
    res.status(403).json({ error: "Only the person who started this run (or Admin/Office) can submit it" });
    return;
  }
  if (completion.status === "completed") { res.status(409).json({ error: "This run has already been submitted" }); return; }

  const itemResults: ItemResultInput[] = Array.isArray(req.body.itemResults) ? req.body.itemResults : [];
  // Check every linked asset before claiming the completion transaction. This
  // prevents a reassigned asset from receiving any reading/fuel/ledger write.
  const linkedItems = await db.select().from(taskBundlesItemsTable).where(and(
    eq(taskBundlesItemsTable.bundleId, completion.bundleId),
    eq(taskBundlesItemsTable.tenantId, tenantId),
  ));
  if (!(await canAccessBundleEquipment(tenantId, userId, role, linkedItems))) {
    res.status(404).json({ error: "Completion not found" });
    return;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      // Atomic claim: only one concurrent request can flip in_progress -> completed. A second
      // submit (double-click, retry, or a race between two tabs) finds zero rows here and bails
      // out before any side effect (readings, fuel logs, alerts, shrinkage rows) is written.
      const durationSeconds = Math.max(0, Math.round((Date.now() - completion.startedAt.getTime()) / 1000));
      const [claimed] = await tx.update(taskBundleCompletionsTable).set({
        status: "completed",
        completedAt: new Date(),
        durationSeconds,
      }).where(and(
        eq(taskBundleCompletionsTable.id, id),
        eq(taskBundleCompletionsTable.tenantId, tenantId),
        eq(taskBundleCompletionsTable.status, "in_progress"),
      )).returning();
      if (!claimed) {
        throw new Error("ALREADY_SUBMITTED");
      }

      const [bundle] = await tx.select().from(taskBundlesTable).where(eq(taskBundlesTable.id, completion.bundleId));
      const items = await tx.select().from(taskBundlesItemsTable).where(eq(taskBundlesItemsTable.bundleId, completion.bundleId));
      const itemMap = new Map(items.map(i => [i.id, i]));

      const [tenant] = await tx.select({ fuelPricePerGallon: tenantsTable.fuelPricePerGallon }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
      const fuelPricePerGallon = tenant?.fuelPricePerGallon ?? 4.0;
      const today = new Date().toISOString().slice(0, 10);

      let hasFlags = false;

      for (const result of itemResults) {
        const item = itemMap.get(result.itemId);
        if (!item) continue;

        if ((item.type === "checklist" || item.type === "safety_check") && (result.status === "fail" || result.status === "concern")) {
          hasFlags = true;
        }

        // Hour meter / mileage → equipment reading log + update equipmentTable's live reading.
        // Re-verify the linked equipment belongs to this tenant before writing any child row —
        // items are validated at create/update time, but this guard is cheap defense-in-depth
        // against a mismatched link ever reaching this far.
        if ((item.type === "hour_meter_log" || item.type === "mileage_log") && item.linkedEquipmentId != null && result.value != null) {
          const readingType = item.type === "hour_meter_log" ? "hours" : "mileage";
          const parsedValue = parseFloat(String(result.value));
          const [eqRow] = await tx.select({ currentHours: equipmentTable.currentHours, currentMiles: equipmentTable.currentMiles })
            .from(equipmentTable).where(and(eq(equipmentTable.id, item.linkedEquipmentId), eq(equipmentTable.tenantId, tenantId)));
          if (!isNaN(parsedValue) && eqRow) {
            await tx.insert(equipmentReadingLogsTable).values({
              equipmentId: item.linkedEquipmentId,
              tenantId,
              date: today,
              readingType,
              value: parsedValue,
              source: "task_bundle",
              taskBundleCompletionId: id,
            });
            const equipUpdates: Partial<typeof equipmentTable.$inferInsert> = {};
            if (readingType === "hours" && parsedValue > (eqRow.currentHours ?? 0)) equipUpdates.currentHours = parsedValue;
            if (readingType === "mileage" && parsedValue > (eqRow.currentMiles ?? 0)) equipUpdates.currentMiles = parsedValue;
            if (Object.keys(equipUpdates).length > 0) {
              await tx.update(equipmentTable).set(equipUpdates).where(and(eq(equipmentTable.id, item.linkedEquipmentId), eq(equipmentTable.tenantId, tenantId)));
            }
          }
        }

        // Fuel log → existing equipment fuel log ledger. Same tenant-ownership guard as above.
        if (item.type === "fuel_log" && item.linkedEquipmentId != null && result.value != null) {
          const gallons = parseFloat(String(result.value));
          const [eqRow] = await tx.select({ id: equipmentTable.id }).from(equipmentTable)
            .where(and(eq(equipmentTable.id, item.linkedEquipmentId), eq(equipmentTable.tenantId, tenantId)));
          if (!isNaN(gallons) && eqRow) {
            const cost = gallons * fuelPricePerGallon;
            await tx.insert(equipmentFuelLogsTable).values({
              equipmentId: item.linkedEquipmentId,
              tenantId,
              date: today,
              gallons,
              cost,
            });
            const totalResult = await tx.select({ total: sum(equipmentFuelLogsTable.cost) }).from(equipmentFuelLogsTable)
              .where(and(eq(equipmentFuelLogsTable.equipmentId, item.linkedEquipmentId), eq(equipmentFuelLogsTable.tenantId, tenantId)));
            await tx.update(equipmentTable).set({ totalFuelCost: parseFloat(String(totalResult[0]?.total ?? 0)) })
              .where(and(eq(equipmentTable.id, item.linkedEquipmentId), eq(equipmentTable.tenantId, tenantId)));
          }
        }

        // Concern → parts procurement alert on the mechanic/maintenance dashboard (Internal Tasks).
        // Only proceed if the linked equipment actually belongs to this tenant.
        if ((item.type === "safety_check" || item.type === "checklist") && result.status === "concern" && item.linkedEquipmentId != null) {
          const [equip] = await tx.select({ id: equipmentTable.id, name: equipmentTable.name }).from(equipmentTable)
            .where(and(eq(equipmentTable.id, item.linkedEquipmentId), eq(equipmentTable.tenantId, tenantId)));
          if (!equip) continue;
          const [task] = await tx.insert(internalTasksTable).values({
            tenantId,
            title: `Parts procurement: ${equip.name} — ${item.label}`,
            description: result.note ?? `Flagged as Concern/Watch during "${bundle?.name ?? "a daily task"}". Equipment stays in service — order parts proactively before this becomes a breakdown.`,
            taskType: "equipment_concern",
            createdById: userId,
            assignedToRole: "admin_office",
            priority: "high",
            status: "open",
            contextType: "equipment",
            contextId: item.linkedEquipmentId,
          }).returning();
          const officeUsers = await tx.select({ id: usersTable.id }).from(usersTable)
            .where(and(eq(usersTable.tenantId, tenantId)));
          // Best-effort notification fan-out; failures here shouldn't block the completion.
          for (const u of officeUsers) {
            await tx.insert(taskNotificationsTable).values({
              tenantId,
              recipientUserId: u.id,
              taskId: task.id,
              type: "assigned",
              message: `Equipment concern flagged: ${equip?.name ?? "equipment"} — ${item.label}`,
            }).catch(() => {});
          }
        }

        // Warehouse inventory count → itemized shrinkage report
        if (item.type === "warehouse_inventory_count" && Array.isArray(result.counts)) {
          for (const c of result.counts) {
            const [invItem] = await tx.select().from(inventoryItemsTable)
              .where(and(eq(inventoryItemsTable.id, c.inventoryItemId), eq(inventoryItemsTable.tenantId, tenantId)));
            if (!invItem) continue;
            const variance = c.actualCount - invItem.quantity;
            if (variance !== 0) {
              // Only shortages (negative variance) represent shrinkage loss; overages are a
              // count/receiving discrepancy worth recording but should not inflate the loss ledger.
              const totalLoss = variance < 0 ? Math.abs(variance) * invItem.unitPrice : 0;
              await tx.insert(shrinkageReportsTable).values({
                tenantId,
                countEventId: String(id),
                taskBundleCompletionId: id,
                inventoryItemId: invItem.id,
                itemName: invItem.name,
                sku: invItem.sku,
                expectedStock: invItem.quantity,
                actualCount: c.actualCount,
                variance,
                unitCost: invItem.unitPrice,
                totalLoss,
              });
            }
          }
        }
      }

      const [finalRow] = await tx.update(taskBundleCompletionsTable).set({
        itemResults,
        hasFlags,
      }).where(and(eq(taskBundleCompletionsTable.id, id), eq(taskBundleCompletionsTable.tenantId, tenantId))).returning();

      return { row: finalRow, bundleName: bundle?.name };
    });

    res.json(formatCompletion(updated.row, { bundleName: updated.bundleName }));
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_SUBMITTED") {
      res.status(409).json({ error: "This run has already been submitted" });
      return;
    }
    throw err;
  }
});

// ─── Completion Log ──────────────────────────────────────────────────────────────

router.get("/task-bundle-completions", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { bundleId, userId, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

  const conditions = [eq(taskBundleCompletionsTable.tenantId, tenantId)];
  if (bundleId) conditions.push(eq(taskBundleCompletionsTable.bundleId, parseInt(bundleId, 10)));
  if (userId) conditions.push(eq(taskBundleCompletionsTable.userId, parseInt(userId, 10)));
  if (dateFrom) conditions.push(gte(taskBundleCompletionsTable.startedAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(taskBundleCompletionsTable.startedAt, new Date(`${dateTo}T23:59:59.999Z`)));

  const rows = await db.select().from(taskBundleCompletionsTable).where(and(...conditions)).orderBy(desc(taskBundleCompletionsTable.startedAt));

  const bundleIds = Array.from(new Set(rows.map(r => r.bundleId)));
  const userIds = Array.from(new Set(rows.map(r => r.userId)));
  const [bundles, users] = await Promise.all([
    bundleIds.length ? db.select({ id: taskBundlesTable.id, name: taskBundlesTable.name }).from(taskBundlesTable).where(eq(taskBundlesTable.tenantId, tenantId)) : Promise.resolve([]),
    userIds.length ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.tenantId, tenantId)) : Promise.resolve([]),
  ]);
  const bundleMap = new Map(bundles.map(b => [b.id, b.name]));
  const userMap = new Map(users.map(u => [u.id, u.name]));

  res.json(rows.map(r => formatCompletion(r, { bundleName: bundleMap.get(r.bundleId), userName: userMap.get(r.userId) })));
});

// ─── Shrinkage Reports Ledger ────────────────────────────────────────────────

router.get("/shrinkage-reports", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { countEventId, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

  const conditions = [eq(shrinkageReportsTable.tenantId, tenantId)];
  if (countEventId) conditions.push(eq(shrinkageReportsTable.countEventId, countEventId));
  if (dateFrom) conditions.push(gte(shrinkageReportsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(shrinkageReportsTable.createdAt, new Date(`${dateTo}T23:59:59.999Z`)));

  const rows = await db.select().from(shrinkageReportsTable).where(and(...conditions)).orderBy(desc(shrinkageReportsTable.createdAt));
  const totalLoss = rows.reduce((s, r) => s + r.totalLoss, 0);
  res.json({
    totalLoss,
    lines: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
});

export default router;
