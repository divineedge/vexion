import { Router, type IRouter } from "express";
import { db, blueprintsTable, inventoryItemsTable, mediaAttachmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ─── Canvas data normalization ─────────────────────────────────────────────────
// Some legacy/seeded blueprints store their layout as { nodes: [{id,x,y,type}], lines: [{id,from,to}] }
// instead of the current { points: [{id,x,y,elementType}], lines: [{id,startId,endId}], areas: [...] }
// shape the canvas editor reads and writes. Without normalizing on read, the editor sees an empty
// points/lines array, shows a blank canvas, and then overwrites the legacy fields with empty arrays
// the first time it saves (including the AI zone-generation save-on-generate step). Normalizing here,
// at every read path, means the editor always works with — and therefore always saves back — the
// current shape, so the legacy fields are naturally migrated away instead of silently discarded.
interface NormalizedCanvasPoint {
  id: string; x: number; y: number;
  elementType?: string;
  label?: string;
  sprinklerHeadType?: string;
  inventoryItemId?: number | null;
  coverageRadiusFt?: number | null;
}
interface NormalizedCanvasLine {
  id: string; startId: string; endId: string;
  elementType?: string;
  pipeType?: string;
  label?: string;
  inventoryItemId?: number | null;
}
interface NormalizedCanvasArea {
  id: string;
  elementType: string;
  polygon: { x: number; y: number }[];
  label?: string;
  inventoryItemId?: number | null;
}
interface NormalizedCanvasData {
  points: NormalizedCanvasPoint[];
  lines: NormalizedCanvasLine[];
  areas: NormalizedCanvasArea[];
}

/** Best-effort mapping from legacy free-text node "type" values to the current elementType union; unrecognized
 * legacy types (e.g. "valve", "corner") fall back to a plain generic point rather than being dropped. */
const LEGACY_NODE_TYPE_MAP: Record<string, string> = {
  sprinkler: "sprinkler",
  tree: "tree",
  largeRock: "largeRock",
  rock: "largeRock",
};

function normalizeCanvasData(raw: unknown): NormalizedCanvasData {
  const data = (raw ?? {}) as {
    points?: NormalizedCanvasPoint[];
    lines?: Array<Partial<NormalizedCanvasLine> & { from?: string; to?: string }>;
    areas?: NormalizedCanvasArea[];
    nodes?: Array<{ id: string; x: number; y: number; type?: string }>;
  };

  if (Array.isArray(data.points)) {
    // Current shape. Still tolerate individual lines saved under the legacy from/to keys instead of startId/endId.
    const lines: NormalizedCanvasLine[] = (data.lines ?? []).map((l) => ({
      ...l,
      id: l.id!,
      startId: l.startId ?? l.from!,
      endId: l.endId ?? l.to!,
    }));
    return { points: data.points, lines, areas: data.areas ?? [] };
  }

  if (Array.isArray(data.nodes)) {
    // Legacy shape: nodes[] + lines with from/to instead of points[] + startId/endId.
    const points: NormalizedCanvasPoint[] = data.nodes.map((n) => {
      const mappedType = n.type ? LEGACY_NODE_TYPE_MAP[n.type] : undefined;
      // Legacy type names that don't map to a current palette entry (e.g. "valve", "corner") would
      // otherwise be silently discarded, leaving an unlabeled generic dot. Keep the original type
      // name visible as the point's label so the fixture stays meaningful after migration.
      const label = !mappedType && n.type ? n.type : undefined;
      return {
        id: n.id,
        x: n.x,
        y: n.y,
        elementType: mappedType,
        label,
      };
    });
    const lines: NormalizedCanvasLine[] = (data.lines ?? []).map((l) => ({
      id: l.id!,
      startId: (l.from ?? l.startId)!,
      endId: (l.to ?? l.endId)!,
    }));
    return { points, lines, areas: [] };
  }

  return { points: [], lines: [], areas: data.areas ?? [] };
}

async function formatBlueprint(b: typeof blueprintsTable.$inferSelect) {
  let pdfSignedUrl: string | null = null;
  if (b.pdfObjectPath) {
    try {
      pdfSignedUrl = await objectStorageService.generateSignedReadUrl(b.pdfObjectPath);
    } catch {
      // Non-fatal: signed URL generation can fail in local dev without sidecar; frontend falls back to the proxy route.
    }
  }
  return {
    ...b,
    canvasData: normalizeCanvasData(b.canvasData),
    createdAt: b.createdAt.toISOString(),
    pdfSignedUrl,
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
  res.json(await Promise.all(rows.map(formatBlueprint)));
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

  res.json(await formatBlueprint(updated));
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.get("/blueprints", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(blueprintsTable).where(eq(blueprintsTable.tenantId, tenantId)).orderBy(blueprintsTable.createdAt);
  res.json(await Promise.all(rows.map(formatBlueprint)));
});

router.post("/blueprints", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const {
    name, mode, jobId, propertyId, overageBufferPercent, isTemplate, templateId,
    sourceType, pdfObjectPath, pdfFileName, pdfSizeBytes,
  } = req.body;
  if (!name || !mode) { res.status(400).json({ error: "name and mode required" }); return; }

  const isPdfSource = sourceType === "pdf";
  if (isPdfSource && (!pdfObjectPath || !pdfSizeBytes)) {
    res.status(400).json({ error: "pdfObjectPath and pdfSizeBytes are required when sourceType is 'pdf'" });
    return;
  }

  const [bp] = await db.insert(blueprintsTable).values({
    tenantId,
    name,
    mode,
    jobId: jobId ? parseInt(jobId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    overageBufferPercent: overageBufferPercent ?? 10,
    isTemplate: isTemplate === true || isTemplate === "true",
    templateId: templateId ? parseInt(templateId, 10) : null,
    sourceType: isPdfSource ? "pdf" : "canvas",
    pdfObjectPath: isPdfSource ? pdfObjectPath : null,
    pdfFileName: isPdfSource ? (pdfFileName ?? null) : null,
  }).returning();

  // Uploaded-PDF blueprints need a media_attachments row so the object-serving
  // routes (GET /storage/objects, GET /storage/read-url) can verify tenant ownership.
  if (isPdfSource) {
    await db.insert(mediaAttachmentsTable).values({
      tenantId,
      entityType: "blueprint",
      entityId: bp.id,
      fileKey: pdfObjectPath,
      fileUrl: pdfObjectPath,
      mimeType: "application/pdf",
      sizeBytes: Number(pdfSizeBytes),
      caption: pdfFileName ?? null,
      isCover: false,
      createdBy: userId,
    });
  }

  res.status(201).json(await formatBlueprint(bp));
});

router.get("/blueprints/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [bp] = await db.select().from(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  if (!bp) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await formatBlueprint(bp));
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
  res.json(await formatBlueprint(updated));
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
interface CanvasAreaEl {
  id: string;
  elementType?: string;
  polygon: { x: number; y: number }[];
  inventoryItemId?: number | null;
}

function pxDistance(a: CanvasPointEl, b: CanvasPointEl): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Shoelace formula — polygon area in the canvas's raw px^2 units. */
function polygonAreaPx(poly: { x: number; y: number }[]): number {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    sum += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(sum) / 2;
}

router.post("/blueprints/:id/estimate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [bp] = await db.select().from(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  if (!bp) { res.status(404).json({ error: "Not found" }); return; }

  const canvas = normalizeCanvasData(bp.canvasData);
  const points = canvas.points as CanvasPointEl[];
  const lines = canvas.lines as CanvasLineEl[];
  const areas = canvas.areas as CanvasAreaEl[];
  const pointById = new Map(points.map(p => [p.id, p]));
  const nodeCount = points.length;
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

  // Ground-cover areas (gravel, dry river bed) are quantified by real-world sq ft, not point count.
  for (const area of areas) {
    if (area.inventoryItemId == null) continue;
    const pxArea = polygonAreaPx(area.polygon);
    const sqFt = scale ? pxArea / (scale * scale) : 0;
    const entry = derived.get(area.inventoryItemId) ?? { quantity: 0, unit: scale ? "sq ft" : "each", source: "canvas" };
    if (scale) entry.unit = "sq ft";
    entry.quantity += scale ? sqFt : 1;
    derived.set(area.inventoryItemId, entry);
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

  res.json(await formatBlueprint(newBp));
});

// ─── Zone-Scoped AI Generation ────────────────────────────────────────────────
// Extends the heuristic generator: instead of drafting a whole new blueprint from a free-text
// description, this places elements only inside user-drawn zone polygons (already in the same
// px coordinate space as the canvas), using only the materials the user picked for that zone —
// then merges the result into the blueprint's *existing* canvasData. Everything else is untouched.

interface AiZonePointInput { x: number; y: number }
interface AiZoneMaterialInput { elementType: string; inventoryItemId?: number | null; pipeType?: string | null }
interface AiZoneInput { id: string; label?: string; polygon: AiZonePointInput[]; materials: AiZoneMaterialInput[] }

interface GeneratedZonePoint {
  id: string;
  x: number;
  y: number;
  /** Omitted for plain anchor points (e.g. trench path vertices) — those render as generic dots. */
  elementType?: string;
  label?: string;
  sprinklerHeadType?: string;
  inventoryItemId?: number | null;
}
interface GeneratedZoneLine {
  id: string;
  startId: string;
  endId: string;
  elementType: string;
  pipeType?: string;
  label?: string;
  inventoryItemId?: number | null;
}
interface GeneratedZoneArea {
  id: string;
  elementType: string;
  polygon: AiZonePointInput[];
  inventoryItemId?: number | null;
}

/** Ground-cover materials that draw as a bounded polygon area instead of scattered points. */
const AREA_MATERIAL_TYPES = new Set(["dryRiverBed", "gravel_1in", "gravel_2in", "gravel_3in", "gravel_4in"]);

/** Ray-casting point-in-polygon test. */
function pointInPolygon(px: number, py: number, polygon: AiZonePointInput[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Every polygon-interior point on a regular grid at the given spacing, capped to avoid runaway counts. */
function scatterGridInPolygon(polygon: AiZonePointInput[], spacing: number, maxPoints: number): { x: number; y: number }[] {
  const xs = polygon.map(p => p.x);
  const ys = polygon.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const out: { x: number; y: number }[] = [];
  for (let y = minY + spacing / 2; y <= maxY && out.length < maxPoints; y += spacing) {
    for (let x = minX + spacing / 2; x <= maxX && out.length < maxPoints; x += spacing) {
      if (pointInPolygon(x, y, polygon)) out.push({ x, y });
    }
  }
  return out;
}

/** Spacing (px) tuned per material so denser fixtures (gravel) pack tighter than sparse ones (trees). */
function spacingForElementType(elementType: string, scalePxPerFt: number | null | undefined): number {
  const ft = scalePxPerFt && scalePxPerFt > 0 ? scalePxPerFt : 18; // fallback: ~18px/ft-ish visual default
  const spacingFt: Record<string, number> = {
    sprinkler: 12,
    tree: 15,
    largeRock: 10,
    dryRiverBed: 8,
    gravel_1in: 6,
    gravel_2in: 6,
    gravel_3in: 6,
    gravel_4in: 6,
    trench: 6,
    node: 10,
  };
  const spacing = (spacingFt[elementType] ?? 10) * ft;
  return Math.max(24, Math.min(spacing, 220));
}

function generateZoneElements(
  zone: AiZoneInput,
  scalePxPerFt: number | null | undefined,
  nextTrenchNumberRef: { value: number },
  idPrefix: string,
): { points: GeneratedZonePoint[]; lines: GeneratedZoneLine[]; areas: GeneratedZoneArea[] } {
  const points: GeneratedZonePoint[] = [];
  const lines: GeneratedZoneLine[] = [];
  const areas: GeneratedZoneArea[] = [];
  let idx = 0;
  const nextId = () => `${idPrefix}_p${idx++}`;
  const MAX_PLACEMENTS_PER_MATERIAL = 40;

  for (const material of zone.materials) {
    if (material.elementType === "edge" || material.elementType === "pipe") continue; // lines are derived, not directly selectable

    // Ground cover (gravel/dry river bed): the whole zone becomes one area, quantified by sq ft, not a scatter of dots.
    if (AREA_MATERIAL_TYPES.has(material.elementType)) {
      areas.push({
        id: `${idPrefix}_a${areas.length}`,
        elementType: material.elementType,
        polygon: zone.polygon,
        inventoryItemId: material.inventoryItemId ?? null,
      });
      continue;
    }

    const spacing = spacingForElementType(material.elementType, scalePxPerFt);
    const cells = scatterGridInPolygon(zone.polygon, spacing, MAX_PLACEMENTS_PER_MATERIAL);
    if (cells.length === 0) continue;

    if (material.elementType === "trench") {
      // Chain plain anchor points along the grid order and connect consecutive ones with a single
      // labeled trench *line* — the trench reads as one continuous line, not a row of labeled dots.
      const placed: GeneratedZonePoint[] = cells.map((c) => {
        const p: GeneratedZonePoint = { id: nextId(), x: c.x, y: c.y };
        points.push(p);
        return p;
      });
      const trenchLabel = `Trench ${nextTrenchNumberRef.value++}`;
      for (let i = 0; i < placed.length - 1; i++) {
        lines.push({
          id: `${idPrefix}_l${lines.length}`,
          startId: placed[i].id,
          endId: placed[i + 1].id,
          elementType: "trench",
          label: trenchLabel,
          inventoryItemId: material.inventoryItemId ?? null,
        });
      }
      continue;
    }

    if (material.elementType === "sprinkler") {
      const placed: GeneratedZonePoint[] = cells.map((c) => {
        const p: GeneratedZonePoint = {
          id: nextId(),
          x: c.x,
          y: c.y,
          elementType: "sprinkler",
          sprinklerHeadType: "Rotor",
          inventoryItemId: material.inventoryItemId ?? null,
        };
        points.push(p);
        return p;
      });
      // If a pipe type was chosen, run a supply line through the heads (nearest-neighbor chain from the first head).
      if (material.pipeType && placed.length > 1) {
        const remaining = [...placed.slice(1)];
        let current = placed[0];
        while (remaining.length > 0) {
          let nearestIdx = 0;
          let nearestDist = Infinity;
          remaining.forEach((cand, i) => {
            const d = (cand.x - current.x) ** 2 + (cand.y - current.y) ** 2;
            if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
          });
          const next = remaining.splice(nearestIdx, 1)[0];
          lines.push({ id: `${idPrefix}_l${lines.length}`, startId: current.id, endId: next.id, elementType: "pipe", pipeType: material.pipeType ?? undefined });
          current = next;
        }
      }
      continue;
    }

    // Generic scatter (tree, largeRock, dryRiverBed, gravel_*, node)
    cells.forEach((c) => {
      points.push({
        id: nextId(),
        x: c.x,
        y: c.y,
        elementType: material.elementType,
        inventoryItemId: material.inventoryItemId ?? null,
      });
    });
  }

  return { points, lines, areas };
}

router.post("/blueprints/:id/generate-ai-zones", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { zones } = req.body as { zones?: AiZoneInput[] };
  if (!Array.isArray(zones) || zones.length === 0) {
    res.status(400).json({ error: "zones array (at least one zone) is required" });
    return;
  }
  for (const zone of zones) {
    if (!Array.isArray(zone.polygon) || zone.polygon.length < 3) {
      res.status(400).json({ error: `Zone ${zone.id ?? "?"} needs a polygon with at least 3 vertices` });
      return;
    }
  }

  const [bp] = await db.select().from(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  if (!bp) { res.status(404).json({ error: "Not found" }); return; }

  // Normalize first: legacy-shaped blueprints (nodes/from/to) would otherwise look empty here, and
  // merging + saving would silently discard their original layout under the old field names.
  const existing = normalizeCanvasData(bp.canvasData);
  const existingPoints = existing.points as GeneratedZonePoint[];
  const existingLines = existing.lines as GeneratedZoneLine[];
  const existingAreas = existing.areas as GeneratedZoneArea[];

  const nextTrenchNumberRef = { value: existingLines.filter((l) => l.elementType === "trench").length + 1 };
  const newPoints: GeneratedZonePoint[] = [];
  const newLines: GeneratedZoneLine[] = [];
  const newAreas: GeneratedZoneArea[] = [];

  zones.forEach((zone, zoneIdx) => {
    const idPrefix = `aiz_${Date.now()}_${zoneIdx}`;
    const generated = generateZoneElements(zone, bp.scalePxPerFt, nextTrenchNumberRef, idPrefix);
    newPoints.push(...generated.points);
    newLines.push(...generated.lines);
    newAreas.push(...generated.areas);
  });

  const mergedCanvasData = {
    points: [...existingPoints, ...newPoints],
    lines: [...existingLines, ...newLines],
    areas: [...existingAreas, ...newAreas],
  };

  const [updated] = await db
    .update(blueprintsTable)
    .set({ canvasData: mergedCanvasData as typeof blueprintsTable.$inferInsert["canvasData"] })
    .where(eq(blueprintsTable.id, id))
    .returning();

  res.json(await formatBlueprint(updated));
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
