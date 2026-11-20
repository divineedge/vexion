import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, eq, ilike, ne, sql } from "drizzle-orm";
import { db, inventoryItemsTable, inventoryPartSizesTable, inventoryPartTypesTable } from "@workspace/db";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { missingChemicalSizeNames } from "../lib/chemicalInventory";
import { categoryNames, readSizeCoverage, readSizeVolume, rewriteCategory } from "../lib/inventoryCatalog";

const router: IRouter = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requireOfficeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const allowed = await isAdminRole(getTenantId(req), getUserId(req));
  if (!allowed) {
    res.status(403).json({ error: "Office role required" });
    return;
  }
  next();
}

function pathId(value: string | string[] | undefined): number | null {
  const parsed = parseInt(Array.isArray(value) ? value[0] : value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatType(row: typeof inventoryPartTypesTable.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatSize(row: typeof inventoryPartSizesTable.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    typeId: row.typeId,
    name: row.name,
    sortOrder: row.sortOrder,
    volumeAmount: row.volumeAmount ?? null,
    volumeUnit: row.volumeUnit ?? null,
    coverageAmount: row.coverageAmount ?? null,
    coverageUnit: row.coverageUnit ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function countItems(where: ReturnType<typeof eq>): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryItemsTable).where(where);
  return Number(row?.n ?? 0);
}

async function rehomeSizes(tx: Tx, tenantId: number, fromTypeId: number, toTypeId: number): Promise<void> {
  const sizes = await tx.select().from(inventoryPartSizesTable)
    .where(and(eq(inventoryPartSizesTable.tenantId, tenantId), eq(inventoryPartSizesTable.typeId, fromTypeId)));
  for (const size of sizes) {
    const [clash] = await tx.select({ id: inventoryPartSizesTable.id }).from(inventoryPartSizesTable)
      .where(and(
        eq(inventoryPartSizesTable.tenantId, tenantId),
        eq(inventoryPartSizesTable.typeId, toTypeId),
        sql`lower(${inventoryPartSizesTable.name}) = lower(${size.name})`,
      ))
      .limit(1);
    if (clash && clash.id !== size.id) {
      await tx.update(inventoryItemsTable).set({ sizeId: clash.id })
        .where(and(eq(inventoryItemsTable.tenantId, tenantId), eq(inventoryItemsTable.sizeId, size.id)));
      await tx.delete(inventoryPartSizesTable).where(and(
        eq(inventoryPartSizesTable.id, size.id),
        eq(inventoryPartSizesTable.tenantId, tenantId),
      ));
    } else {
      await tx.update(inventoryPartSizesTable).set({ typeId: toTypeId })
        .where(and(eq(inventoryPartSizesTable.id, size.id), eq(inventoryPartSizesTable.tenantId, tenantId)));
    }
  }
}

router.get("/inventory/types", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(inventoryPartTypesTable)
    .where(eq(inventoryPartTypesTable.tenantId, tenantId))
    .orderBy(asc(inventoryPartTypesTable.sortOrder), asc(inventoryPartTypesTable.name));
  res.json(rows.map(formatType));
});

router.post("/inventory/types", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const name = cleanName(req.body?.name);
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [duplicate] = await db.select({ id: inventoryPartTypesTable.id }).from(inventoryPartTypesTable)
    .where(and(eq(inventoryPartTypesTable.tenantId, tenantId), ilike(inventoryPartTypesTable.name, name)))
    .limit(1);
  if (duplicate) { res.status(409).json({ error: "A type with that name already exists" }); return; }
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryPartTypesTable)
    .where(eq(inventoryPartTypesTable.tenantId, tenantId));
  const [row] = await db.insert(inventoryPartTypesTable).values({
    tenantId,
    name,
    sortOrder: count?.n ?? 0,
  }).returning();
  await ensureChemicalSizes(tenantId);
  res.status(201).json(formatType(row));
});

router.patch("/inventory/types/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const name = cleanName(req.body?.name);
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [duplicate] = await db.select({ id: inventoryPartTypesTable.id }).from(inventoryPartTypesTable)
    .where(and(eq(inventoryPartTypesTable.tenantId, tenantId), ilike(inventoryPartTypesTable.name, name)))
    .limit(1);
  if (duplicate && duplicate.id !== id) { res.status(409).json({ error: "A type with that name already exists" }); return; }
  const [row] = await db.update(inventoryPartTypesTable).set({ name })
    .where(and(eq(inventoryPartTypesTable.id, id), eq(inventoryPartTypesTable.tenantId, tenantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const updatedItems = await countItems(and(eq(inventoryItemsTable.tenantId, tenantId), eq(inventoryItemsTable.typeId, id)) as ReturnType<typeof eq>);
  res.json({ ...formatType(row), updatedItems });
});

router.post("/inventory/types/:id/merge", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const sourceId = pathId(req.params.id);
  const keepId = pathId(req.body?.keepId != null ? String(req.body.keepId) : undefined);
  if (!sourceId || !keepId) { res.status(400).json({ error: "Choose the type to keep" }); return; }
  if (sourceId === keepId) { res.status(400).json({ error: "Choose a different type to merge into" }); return; }
  const result = await db.transaction(async tx => {
    const [source] = await tx.select().from(inventoryPartTypesTable)
      .where(and(eq(inventoryPartTypesTable.id, sourceId), eq(inventoryPartTypesTable.tenantId, tenantId)));
    const [keep] = await tx.select().from(inventoryPartTypesTable)
      .where(and(eq(inventoryPartTypesTable.id, keepId), eq(inventoryPartTypesTable.tenantId, tenantId)));
    if (!source || !keep) return null;
    await rehomeSizes(tx, tenantId, sourceId, keepId);
    const moved = await tx.update(inventoryItemsTable).set({ typeId: keepId })
      .where(and(eq(inventoryItemsTable.tenantId, tenantId), eq(inventoryItemsTable.typeId, sourceId)))
      .returning({ id: inventoryItemsTable.id });
    await tx.delete(inventoryPartTypesTable)
      .where(and(eq(inventoryPartTypesTable.id, sourceId), eq(inventoryPartTypesTable.tenantId, tenantId)));
    return { keptId: keep.id, keptName: keep.name, movedItems: moved.length, removedName: source.name };
  });
  if (!result) { res.status(404).json({ error: "Type not found" }); return; }
  res.json(result);
});

router.delete("/inventory/types/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await db.transaction(async tx => {
    const [type] = await tx.select().from(inventoryPartTypesTable)
      .where(and(eq(inventoryPartTypesTable.id, id), eq(inventoryPartTypesTable.tenantId, tenantId)));
    if (!type) return null;
    const [keeper] = await tx.select({ id: inventoryPartTypesTable.id }).from(inventoryPartTypesTable)
      .where(and(eq(inventoryPartTypesTable.tenantId, tenantId), ne(inventoryPartTypesTable.id, id)))
      .orderBy(asc(inventoryPartTypesTable.id))
      .limit(1);
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.tenantId, tenantId), eq(inventoryItemsTable.typeId, id)));
    let removedSizes = 0;
    if (keeper) {
      await rehomeSizes(tx, tenantId, id, keeper.id);
    } else {
      const owned = await tx.select({ id: inventoryPartSizesTable.id }).from(inventoryPartSizesTable)
        .where(and(eq(inventoryPartSizesTable.tenantId, tenantId), eq(inventoryPartSizesTable.typeId, id)));
      removedSizes = owned.length;
    }
    await tx.delete(inventoryPartTypesTable)
      .where(and(eq(inventoryPartTypesTable.id, id), eq(inventoryPartTypesTable.tenantId, tenantId)));
    return { clearedItems: Number(used?.n ?? 0), removedSizes, name: type.name };
  });
  if (!result) { res.status(404).json({ error: "Not found" }); return; }
  res.json(result);
});

async function ensureChemicalSizes(tenantId: number): Promise<void> {
  const types = await db.select({ id: inventoryPartTypesTable.id }).from(inventoryPartTypesTable)
    .where(eq(inventoryPartTypesTable.tenantId, tenantId))
    .orderBy(asc(inventoryPartTypesTable.id));
  if (!types.length) return;
  const sizes = await db.select({ name: inventoryPartSizesTable.name }).from(inventoryPartSizesTable)
    .where(eq(inventoryPartSizesTable.tenantId, tenantId));
  // A catalog that already has sizes keeps deletions. Seed the chemical names only for an empty list.
  if (sizes.length > 0) return;
  const missing = missingChemicalSizeNames(sizes.map(size => size.name));
  for (const name of missing) {
    try {
      await db.insert(inventoryPartSizesTable).values({ tenantId, typeId: types[0].id, name, sortOrder: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate|unique/i.test(message)) throw error;
    }
  }
}

router.get("/inventory/sizes", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  await ensureChemicalSizes(tenantId);
  const typeId = req.query.typeId != null && req.query.typeId !== "" ? pathId(String(req.query.typeId)) : null;
  if (req.query.typeId != null && req.query.typeId !== "" && !typeId) {
    res.status(400).json({ error: "Invalid typeId" });
    return;
  }
  const where = typeId
    ? and(eq(inventoryPartSizesTable.tenantId, tenantId), eq(inventoryPartSizesTable.typeId, typeId))
    : eq(inventoryPartSizesTable.tenantId, tenantId);
  const rows = await db.select().from(inventoryPartSizesTable)
    .where(where)
    .orderBy(asc(inventoryPartSizesTable.sortOrder), asc(inventoryPartSizesTable.name));
  res.json(rows.map(formatSize));
});

router.post("/inventory/sizes", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const typeId = pathId(req.body?.typeId != null ? String(req.body.typeId) : undefined);
  const name = cleanName(req.body?.name);
  if (!typeId) { res.status(400).json({ error: "typeId is required" }); return; }
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [type] = await db.select({ id: inventoryPartTypesTable.id }).from(inventoryPartTypesTable)
    .where(and(eq(inventoryPartTypesTable.id, typeId), eq(inventoryPartTypesTable.tenantId, tenantId)))
    .limit(1);
  if (!type) { res.status(400).json({ error: "Type not found" }); return; }
  const [duplicate] = await db.select({ id: inventoryPartSizesTable.id }).from(inventoryPartSizesTable)
    .where(and(
      eq(inventoryPartSizesTable.tenantId, tenantId),
      sql`lower(${inventoryPartSizesTable.name}) = lower(${name})`,
    ))
    .limit(1);
  if (duplicate) { res.status(409).json({ error: "That size already exists" }); return; }
  const volume = readSizeVolume(req.body?.volumeAmount, req.body?.volumeUnit);
  if (!volume.ok) { res.status(400).json({ error: volume.error }); return; }
  const coverage = readSizeCoverage(req.body?.coverageAmount, req.body?.coverageUnit);
  if (!coverage.ok) { res.status(400).json({ error: coverage.error }); return; }
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryPartSizesTable)
    .where(eq(inventoryPartSizesTable.tenantId, tenantId));
  const [row] = await db.insert(inventoryPartSizesTable).values({
    tenantId,
    typeId,
    name,
    sortOrder: count?.n ?? 0,
    volumeAmount: volume.amount,
    volumeUnit: volume.unit,
    coverageAmount: coverage.amount,
    coverageUnit: coverage.unit,
  }).returning();
  res.status(201).json(formatSize(row));
});

router.patch("/inventory/sizes/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const name = cleanName(req.body?.name);
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [current] = await db.select().from(inventoryPartSizesTable)
    .where(and(eq(inventoryPartSizesTable.id, id), eq(inventoryPartSizesTable.tenantId, tenantId)))
    .limit(1);
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const [duplicate] = await db.select({ id: inventoryPartSizesTable.id }).from(inventoryPartSizesTable)
    .where(and(
      eq(inventoryPartSizesTable.tenantId, tenantId),
      ne(inventoryPartSizesTable.id, id),
      sql`lower(${inventoryPartSizesTable.name}) = lower(${name})`,
    ))
    .limit(1);
  if (duplicate) { res.status(409).json({ error: "That size already exists" }); return; }
  const updates: Partial<typeof inventoryPartSizesTable.$inferInsert> = { name };
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "volumeAmount") || Object.prototype.hasOwnProperty.call(req.body ?? {}, "volumeUnit")) {
    const volume = readSizeVolume(req.body?.volumeAmount, req.body?.volumeUnit);
    if (!volume.ok) { res.status(400).json({ error: volume.error }); return; }
    updates.volumeAmount = volume.amount;
    updates.volumeUnit = volume.unit;
  }
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "coverageAmount") || Object.prototype.hasOwnProperty.call(req.body ?? {}, "coverageUnit")) {
    const coverage = readSizeCoverage(req.body?.coverageAmount, req.body?.coverageUnit);
    if (!coverage.ok) { res.status(400).json({ error: coverage.error }); return; }
    updates.coverageAmount = coverage.amount;
    updates.coverageUnit = coverage.unit;
  }
  const [row] = await db.update(inventoryPartSizesTable).set(updates)
    .where(and(eq(inventoryPartSizesTable.id, id), eq(inventoryPartSizesTable.tenantId, tenantId)))
    .returning();
  const updatedItems = await countItems(and(eq(inventoryItemsTable.tenantId, tenantId), eq(inventoryItemsTable.sizeId, id)) as ReturnType<typeof eq>);
  res.json({ ...formatSize(row), updatedItems });
});

router.post("/inventory/sizes/:id/merge", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const sourceId = pathId(req.params.id);
  const keepId = pathId(req.body?.keepId != null ? String(req.body.keepId) : undefined);
  if (!sourceId || !keepId) { res.status(400).json({ error: "Choose the size to keep" }); return; }
  if (sourceId === keepId) { res.status(400).json({ error: "Choose a different size to merge into" }); return; }
  const result = await db.transaction(async tx => {
    const [source] = await tx.select().from(inventoryPartSizesTable)
      .where(and(eq(inventoryPartSizesTable.id, sourceId), eq(inventoryPartSizesTable.tenantId, tenantId)));
    const [keep] = await tx.select().from(inventoryPartSizesTable)
      .where(and(eq(inventoryPartSizesTable.id, keepId), eq(inventoryPartSizesTable.tenantId, tenantId)));
    if (!source || !keep) return null;
    const moved = await tx.update(inventoryItemsTable).set({ sizeId: keepId })
      .where(and(eq(inventoryItemsTable.tenantId, tenantId), eq(inventoryItemsTable.sizeId, sourceId)))
      .returning({ id: inventoryItemsTable.id });
    await tx.delete(inventoryPartSizesTable)
      .where(and(eq(inventoryPartSizesTable.id, sourceId), eq(inventoryPartSizesTable.tenantId, tenantId)));
    return { keptId: keep.id, keptName: keep.name, movedItems: moved.length, removedName: source.name };
  });
  if (!result) { res.status(404).json({ error: "Size not found" }); return; }
  res.json(result);
});

router.delete("/inventory/sizes/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [current] = await db.select({ id: inventoryPartSizesTable.id, name: inventoryPartSizesTable.name })
    .from(inventoryPartSizesTable)
    .where(and(eq(inventoryPartSizesTable.id, id), eq(inventoryPartSizesTable.tenantId, tenantId)));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const clearedItems = await countItems(and(eq(inventoryItemsTable.tenantId, tenantId), eq(inventoryItemsTable.sizeId, id)) as ReturnType<typeof eq>);
  await db.delete(inventoryPartSizesTable)
    .where(and(eq(inventoryPartSizesTable.id, id), eq(inventoryPartSizesTable.tenantId, tenantId)));
  res.json({ clearedItems, name: current.name });
});

router.get("/inventory/categories", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select({ category: inventoryItemsTable.category }).from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.tenantId, tenantId));
  res.json({ names: categoryNames(rows.map(row => row.category)) });
});

async function rewriteStoredCategories(tenantId: number, from: string, to: string | null): Promise<number> {
  const rows = await db.select({ id: inventoryItemsTable.id, category: inventoryItemsTable.category })
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.tenantId, tenantId));
  let changed = 0;
  for (const row of rows) {
    const next = rewriteCategory(row.category, from, to);
    const current = row.category?.trim() ? row.category.trim() : null;
    if (next === current) continue;
    await db.update(inventoryItemsTable).set({ category: next })
      .where(and(eq(inventoryItemsTable.id, row.id), eq(inventoryItemsTable.tenantId, tenantId)));
    changed += 1;
  }
  return changed;
}

router.post("/inventory/categories/rename", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const from = cleanName(req.body?.from);
  const to = cleanName(req.body?.to);
  if (!from || !to) { res.status(400).json({ error: "Enter the category name" }); return; }
  if (from.toLowerCase() !== to.toLowerCase()) {
    const rows = await db.select({ category: inventoryItemsTable.category }).from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.tenantId, tenantId));
    const names = categoryNames(rows.map(row => row.category));
    if (names.some(name => name.toLowerCase() === to.toLowerCase() && name.toLowerCase() !== from.toLowerCase())) {
      res.status(409).json({ error: "That category already exists. Merge them instead." });
      return;
    }
  }
  const updatedItems = await rewriteStoredCategories(tenantId, from, to);
  res.json({ name: to, updatedItems });
});

router.post("/inventory/categories/merge", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const source = cleanName(req.body?.source);
  const keep = cleanName(req.body?.keep);
  if (!source || !keep) { res.status(400).json({ error: "Choose the category to keep" }); return; }
  if (source.toLowerCase() === keep.toLowerCase()) { res.status(400).json({ error: "Choose a different category to merge into" }); return; }
  const movedItems = await rewriteStoredCategories(tenantId, source, keep);
  res.json({ name: keep, movedItems });
});

router.post("/inventory/categories/delete", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const name = cleanName(req.body?.name);
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const clearedItems = await rewriteStoredCategories(tenantId, name, null);
  res.json({ clearedItems, name });
});

export default router;
