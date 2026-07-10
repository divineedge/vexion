import { Router, type IRouter } from "express";
import { db, blueprintsTable, inventoryItemsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatBlueprint(b: typeof blueprintsTable.$inferSelect) {
  return {
    ...b,
    canvasData: (b.canvasData as object) ?? {},
    createdAt: b.createdAt.toISOString(),
  };
}

router.get("/blueprints", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(blueprintsTable).where(eq(blueprintsTable.tenantId, tenantId)).orderBy(blueprintsTable.createdAt);
  res.json(rows.map(formatBlueprint));
});

router.post("/blueprints", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, mode, jobId, propertyId, overageBufferPercent } = req.body;
  if (!name || !mode) { res.status(400).json({ error: "name and mode required" }); return; }

  const [bp] = await db.insert(blueprintsTable).values({
    tenantId,
    name,
    mode,
    jobId: jobId ? parseInt(jobId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    overageBufferPercent: overageBufferPercent ?? 10,
  }).returning();

  res.status(201).json(formatBlueprint(bp));
});

router.get("/blueprints/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [bp] = await db.select().from(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  if (!bp) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatBlueprint(bp));
});

router.patch("/blueprints/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { name, canvasData, overageBufferPercent, p4pPercentage } = req.body;
  const updates: Partial<typeof blueprintsTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (canvasData !== undefined) updates.canvasData = canvasData as typeof blueprintsTable.$inferInsert["canvasData"];
  if (overageBufferPercent !== undefined) updates.overageBufferPercent = overageBufferPercent;
  // null explicitly clears the override (reverts to global); undefined = no change
  if (p4pPercentage !== undefined) updates.p4pPercentage = p4pPercentage === null ? null : parseFloat(p4pPercentage);

  const [updated] = await db.update(blueprintsTable).set(updates).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatBlueprint(updated));
});

// ─── Suggested Parts ──────────────────────────────────────────────────────────

interface SuggestedPart {
  inventoryItemId: number;
  estimatedQuantity: number;
}

router.get("/blueprints/:id/suggested-parts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [bp] = await db.select().from(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  if (!bp) { res.status(404).json({ error: "Not found" }); return; }

  const parts = (bp.suggestedParts as SuggestedPart[]) ?? [];
  if (parts.length === 0) { res.json([]); return; }

  // Fetch live inventory data for each suggested part
  const itemIds = parts.map(p => p.inventoryItemId);
  const items = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId));
  const itemMap = new Map(items.map(i => [i.id, i]));

  const result = parts.map(part => {
    const item = itemMap.get(part.inventoryItemId);
    const warehouseStock = item?.quantity ?? 0;
    return {
      inventoryItemId: part.inventoryItemId,
      name: item?.name ?? `Item #${part.inventoryItemId}`,
      sku: item?.sku ?? "",
      estimatedQuantity: part.estimatedQuantity,
      warehouseStock,
      unit: item?.unit ?? "each",
      unitPrice: item?.markedUpPrice ?? 0,
      orderNeeded: warehouseStock < part.estimatedQuantity,
    };
  });

  res.json(result);
});

router.patch("/blueprints/:id/suggested-parts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { parts } = req.body as { parts?: SuggestedPart[] };
  if (!Array.isArray(parts)) { res.status(400).json({ error: "parts array is required" }); return; }

  const validated = parts.map(p => ({
    inventoryItemId: parseInt(String(p.inventoryItemId), 10),
    estimatedQuantity: parseFloat(String(p.estimatedQuantity)) || 1,
  }));

  const [updated] = await db.update(blueprintsTable)
    .set({ suggestedParts: validated })
    .where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Return with live stock info (same as GET)
  const savedParts = (updated.suggestedParts as SuggestedPart[]) ?? [];
  const items = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId));
  const itemMap = new Map(items.map(i => [i.id, i]));

  const result = savedParts.map(part => {
    const item = itemMap.get(part.inventoryItemId);
    const warehouseStock = item?.quantity ?? 0;
    return {
      inventoryItemId: part.inventoryItemId,
      name: item?.name ?? `Item #${part.inventoryItemId}`,
      sku: item?.sku ?? "",
      estimatedQuantity: part.estimatedQuantity,
      warehouseStock,
      unit: item?.unit ?? "each",
      unitPrice: item?.markedUpPrice ?? 0,
      orderNeeded: warehouseStock < part.estimatedQuantity,
    };
  });

  res.json(result);
});

router.delete("/blueprints/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

router.post("/blueprints/:id/estimate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [bp] = await db.select().from(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  if (!bp) { res.status(404).json({ error: "Not found" }); return; }

  const canvas = (bp.canvasData as { nodes?: unknown[]; lines?: unknown[] }) ?? {};
  const nodeCount = canvas.nodes?.length ?? 0;
  const lineCount = canvas.lines?.length ?? 0;

  // Get available inventory items for this tenant
  const items = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId)).limit(5);

  const parts = items.slice(0, Math.min(items.length, Math.max(1, nodeCount + lineCount))).map((item, idx) => ({
    inventoryItemId: item.id,
    name: item.name,
    quantity: (idx === 0 ? nodeCount || 1 : lineCount || 1) * 1.0,
    unitPrice: item.markedUpPrice || item.unitPrice,
    total: ((idx === 0 ? nodeCount || 1 : lineCount || 1)) * (item.markedUpPrice || item.unitPrice),
  }));

  const subtotal = parts.reduce((s, p) => s + p.total, 0);
  const overageAmount = subtotal * (bp.overageBufferPercent / 100);
  const total = subtotal + overageAmount;

  await db.update(blueprintsTable).set({ totalEstimate: total }).where(eq(blueprintsTable.id, id));

  res.json({
    parts,
    subtotal,
    overageAmount,
    total,
    measurements: { nodeCount, lineCount, mode: bp.mode },
  });
});

export default router;
