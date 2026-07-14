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

// ─── IMPORTANT: static-path routes must come BEFORE /:id ──────────────────────

// GET /blueprints/templates — list all isTemplate=true blueprints for the tenant
router.get("/blueprints/templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(blueprintsTable)
    .where(and(eq(blueprintsTable.tenantId, tenantId), eq(blueprintsTable.isTemplate, true)))
    .orderBy(blueprintsTable.createdAt);
  res.json(rows.map(formatBlueprint));
});

// POST /blueprints/generate-ai — heuristic layout generation based on description/mode/dimensions
router.post("/blueprints/generate-ai", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { description, mode, propertyId, name } = req.body as {
    description: string;
    mode: string;
    propertyId?: number;
    name?: string;
  };

  if (!description || !mode) {
    res.status(400).json({ error: "description and mode are required" });
    return;
  }

  // Heuristic layout generator — deterministic, keyword-based (no external LLM)
  const canvasData = generateHeuristicLayout(description, mode);
  const bpName = name || `AI Layout — ${description.slice(0, 40)}`;

  const [bp] = await db
    .insert(blueprintsTable)
    .values({
      tenantId,
      name: bpName,
      mode: mode as typeof blueprintsTable.$inferInsert["mode"],
      propertyId: propertyId ?? null,
      aiGenerationPrompt: description,
      overageBufferPercent: 10,
    })
    .returning();

  // Save the generated canvas data
  const [updated] = await db
    .update(blueprintsTable)
    .set({ canvasData: canvasData as typeof blueprintsTable.$inferInsert["canvasData"] })
    .where(eq(blueprintsTable.id, bp.id))
    .returning();

  res.json(formatBlueprint(updated));
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.get("/blueprints", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(blueprintsTable).where(eq(blueprintsTable.tenantId, tenantId)).orderBy(blueprintsTable.createdAt);
  res.json(rows.map(formatBlueprint));
});

router.post("/blueprints", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, mode, jobId, propertyId, overageBufferPercent, isTemplate, templateId } = req.body;
  if (!name || !mode) { res.status(400).json({ error: "name and mode required" }); return; }

  const [bp] = await db.insert(blueprintsTable).values({
    tenantId,
    name,
    mode,
    jobId: jobId ? parseInt(jobId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    overageBufferPercent: overageBufferPercent ?? 10,
    isTemplate: isTemplate === true || isTemplate === "true",
    templateId: templateId ? parseInt(templateId, 10) : null,
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

  const { name, canvasData, overageBufferPercent, p4pPercentage, isTemplate, scalePxPerFt } = req.body;
  const updates: Partial<typeof blueprintsTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (canvasData !== undefined) updates.canvasData = canvasData as typeof blueprintsTable.$inferInsert["canvasData"];
  if (overageBufferPercent !== undefined) updates.overageBufferPercent = overageBufferPercent;
  if (p4pPercentage !== undefined) updates.p4pPercentage = p4pPercentage === null ? null : parseFloat(p4pPercentage);
  if (isTemplate !== undefined) updates.isTemplate = isTemplate === true || isTemplate === "true";
  if (scalePxPerFt !== undefined) updates.scalePxPerFt = scalePxPerFt === null ? null : parseFloat(scalePxPerFt);

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

// ─── Estimate (derives quantities from labeled/linked canvas elements first,
// falls back to manual suggestedParts, then to a rough generic heuristic) ────

interface CanvasPointEl {
  id: string;
  x: number;
  y: number;
  elementType?: string;
  inventoryItemId?: number | null;
}
interface CanvasLineEl {
  id: string;
  startId: string;
  endId: string;
  pipeType?: string;
  inventoryItemId?: number | null;
}

function pxDistance(a: CanvasPointEl, b: CanvasPointEl): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

router.post("/blueprints/:id/estimate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [bp] = await db.select().from(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  if (!bp) { res.status(404).json({ error: "Not found" }); return; }

  const canvas = (bp.canvasData as { nodes?: unknown[]; lines?: CanvasLineEl[]; points?: CanvasPointEl[] }) ?? {};
  const points = canvas.points ?? [];
  const lines = canvas.lines ?? [];
  const pointById = new Map(points.map(p => [p.id, p]));
  const nodeCount = canvas.nodes?.length ?? points.length ?? 0;
  const lineCount = lines.length;
  const scale = bp.scalePxPerFt;

  const suggestedParts = (bp.suggestedParts as SuggestedPart[]) ?? [];

  // ── Derive quantities from labeled/linked canvas elements ──────────────────
  // Keyed by inventoryItemId, accumulating quantity + tracking unit/source.
  const derived = new Map<number, { quantity: number; unit: string; source: string }>();

  for (const pt of points) {
    if (pt.inventoryItemId == null) continue;
    const entry = derived.get(pt.inventoryItemId) ?? { quantity: 0, unit: "each", source: "canvas" };
    entry.quantity += 1;
    derived.set(pt.inventoryItemId, entry);
  }

  for (const line of lines) {
    if (line.inventoryItemId == null) continue;
    const p1 = pointById.get(line.startId);
    const p2 = pointById.get(line.endId);
    const pxLen = p1 && p2 ? pxDistance(p1, p2) : 0;
    const lengthFt = scale ? pxLen / scale : 0;
    const entry = derived.get(line.inventoryItemId) ?? { quantity: 0, unit: scale ? "ft" : "each", source: "canvas" };
    // Prefer real-world feet once a scale exists, even if an earlier line contributed before calibration.
    if (scale) entry.unit = "ft";
    entry.quantity += scale ? lengthFt : 1;
    derived.set(line.inventoryItemId, entry);
  }

  // ── Merge in manually-tagged Suggested Parts (additive by inventoryItemId) ─
  for (const sp of suggestedParts) {
    const entry = derived.get(sp.inventoryItemId);
    if (entry) {
      entry.quantity += sp.estimatedQuantity;
      entry.source = "canvas+manual";
    } else {
      derived.set(sp.inventoryItemId, { quantity: sp.estimatedQuantity, unit: "each", source: "manual" });
    }
  }

  let parts: Array<{
    inventoryItemId: number;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    unit: string;
    source: string;
  }>;

  if (derived.size > 0) {
    const items = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId));
    const itemMap = new Map(items.map(i => [i.id, i]));

    parts = Array.from(derived.entries()).map(([inventoryItemId, info]) => {
      const item = itemMap.get(inventoryItemId);
      const unitPrice = item?.markedUpPrice ?? item?.unitPrice ?? 0;
      const quantity = Math.round(info.quantity * 100) / 100;
      return {
        inventoryItemId,
        name: item?.name ?? `Item #${inventoryItemId}`,
        quantity,
        unitPrice,
        total: quantity * unitPrice,
        unit: info.unit,
        source: info.source,
      };
    });
  } else {
    // No labeled/linked elements and no manual parts: derive a rough estimate from canvas element counts
    const items = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId)).limit(5);
    parts = items.slice(0, Math.min(items.length, Math.max(1, nodeCount + lineCount))).map((item, idx) => ({
      inventoryItemId: item.id,
      name: item.name,
      quantity: (idx === 0 ? nodeCount || 1 : lineCount || 1) * 1.0,
      unitPrice: item.markedUpPrice || item.unitPrice,
      total: ((idx === 0 ? nodeCount || 1 : lineCount || 1)) * (item.markedUpPrice || item.unitPrice),
      unit: "each",
      source: "generic",
    }));
  }

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

// ─── Apply Template ───────────────────────────────────────────────────────────

router.post("/blueprints/:id/apply-template", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const templateId = parseInt(rawId, 10);

  const [template] = await db
    .select()
    .from(blueprintsTable)
    .where(and(eq(blueprintsTable.id, templateId), eq(blueprintsTable.tenantId, tenantId)));

  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!template.isTemplate) { res.status(400).json({ error: "Blueprint is not a template" }); return; }

  const { jobId, propertyId } = req.body as { jobId?: number; propertyId?: number };

  const [newBp] = await db
    .insert(blueprintsTable)
    .values({
      tenantId,
      name: `${template.name} (instance)`,
      mode: template.mode,
      jobId: jobId ?? null,
      propertyId: propertyId ?? null,
      canvasData: template.canvasData as typeof blueprintsTable.$inferInsert["canvasData"],
      overageBufferPercent: template.overageBufferPercent,
      suggestedParts: template.suggestedParts as typeof blueprintsTable.$inferInsert["suggestedParts"],
      scalePxPerFt: template.scalePxPerFt,
      isTemplate: false,
      templateId: template.id,
    })
    .returning();

  res.json(formatBlueprint(newBp));
});

// ─── Heuristic AI Layout Generator ───────────────────────────────────────────

interface CanvasPoint { id: string; x: number; y: number }
interface CanvasLine { id: string; startId: string; endId: string }
interface GeneratedCanvas { points: CanvasPoint[]; lines: CanvasLine[] }

function generateHeuristicLayout(description: string, mode: string): GeneratedCanvas {
  const desc = description.toLowerCase();
  const points: CanvasPoint[] = [];
  const lines: CanvasLine[] = [];

  let ptIdx = 0;
  function mkPt(x: number, y: number): CanvasPoint {
    const id = `ai_p${ptIdx++}`;
    points.push({ id, x, y });
    return { id, x, y };
  }
  function mkLine(a: CanvasPoint, b: CanvasPoint) {
    lines.push({ id: `ai_l${lines.length}`, startId: a.id, endId: b.id });
  }
  function rect(x: number, y: number, w: number, h: number) {
    const tl = mkPt(x, y);
    const tr = mkPt(x + w, y);
    const br = mkPt(x + w, y + h);
    const bl = mkPt(x, y + h);
    mkLine(tl, tr); mkLine(tr, br); mkLine(br, bl); mkLine(bl, tl);
    return { tl, tr, br, bl, cx: x + w / 2, cy: y + h / 2 };
  }

  if (mode === "irrigation") {
    // Main supply line + sprinkler heads
    const main1 = mkPt(80, 300); const main2 = mkPt(720, 300);
    mkLine(main1, main2);
    const heads = [[160, 160], [320, 160], [480, 160], [640, 160],
                   [160, 440], [320, 440], [480, 440], [640, 440]];
    heads.forEach(([hx, hy]) => {
      const tap = mkPt(hx, 300);
      const head = mkPt(hx, hy);
      mkLine(tap, head);
    });
    if (desc.includes("zone") || desc.includes("front") || desc.includes("back")) {
      const zone2Main1 = mkPt(80, 500); const zone2Main2 = mkPt(720, 500);
      mkLine(zone2Main1, zone2Main2);
      [[240, 560], [480, 560]].forEach(([hx, hy]) => {
        const tap = mkPt(hx, 500); const head = mkPt(hx, hy);
        mkLine(tap, head);
      });
    }
  } else if (mode === "concrete") {
    if (desc.includes("driveway")) {
      rect(200, 100, 200, 500);
    } else if (desc.includes("patio") || desc.includes("walkway")) {
      rect(150, 200, 400, 250);
      if (desc.includes("walkway")) {
        const w1 = mkPt(350, 450); const w2 = mkPt(350, 580);
        mkLine(w1, w2);
      }
    } else {
      // Generic slab
      rect(180, 180, 440, 280);
    }
  } else if (mode === "landscape") {
    // Perimeter lawn zone
    const perimeter = rect(80, 80, 640, 480);

    // Beds based on keywords
    if (desc.includes("flower bed") || desc.includes("bed")) {
      rect(100, 100, 120, 80);   // top-left bed
      rect(660, 100, 40, 80);    // top-right bed
    }
    if (desc.includes("tree") || desc.includes("trees")) {
      mkPt(250, 260); mkPt(450, 260);
    }
    if (desc.includes("shrub") || desc.includes("bush")) {
      [140, 250, 360, 470, 580].forEach(sx => mkPt(sx, 520));
    }
    if (desc.includes("front") && desc.includes("back")) {
      // Split into two zones
      const split1 = mkPt(80, 320); const split2 = mkPt(720, 320);
      mkLine(split1, split2);
    }
    void perimeter; // suppress unused warning
  } else {
    // General: simple box zones
    rect(100, 100, 600, 400);
    if (desc.includes("zone") || desc.includes("area")) {
      rect(120, 120, 260, 160);
      rect(420, 120, 260, 160);
    }
  }

  return { points, lines };
}

export default router;
