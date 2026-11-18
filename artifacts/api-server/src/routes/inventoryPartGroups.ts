import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { db, inventoryPartSizesTable, inventoryPartTypesTable } from "@workspace/db";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

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
    createdAt: row.createdAt.toISOString(),
  };
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
  res.json(formatType(row));
});

router.delete("/inventory/types/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(inventoryPartTypesTable)
    .where(and(eq(inventoryPartTypesTable.id, id), eq(inventoryPartTypesTable.tenantId, tenantId)))
    .returning({ id: inventoryPartTypesTable.id });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.get("/inventory/sizes", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
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
    .where(and(eq(inventoryPartSizesTable.typeId, typeId), ilike(inventoryPartSizesTable.name, name)))
    .limit(1);
  if (duplicate) { res.status(409).json({ error: "That size already exists for this type" }); return; }
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryPartSizesTable)
    .where(eq(inventoryPartSizesTable.typeId, typeId));
  const [row] = await db.insert(inventoryPartSizesTable).values({
    tenantId,
    typeId,
    name,
    sortOrder: count?.n ?? 0,
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
    .where(and(eq(inventoryPartSizesTable.typeId, current.typeId), ilike(inventoryPartSizesTable.name, name)))
    .limit(1);
  if (duplicate && duplicate.id !== id) { res.status(409).json({ error: "That size already exists for this type" }); return; }
  const [row] = await db.update(inventoryPartSizesTable).set({ name })
    .where(and(eq(inventoryPartSizesTable.id, id), eq(inventoryPartSizesTable.tenantId, tenantId)))
    .returning();
  res.json(formatSize(row));
});

router.delete("/inventory/sizes/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(inventoryPartSizesTable)
    .where(and(eq(inventoryPartSizesTable.id, id), eq(inventoryPartSizesTable.tenantId, tenantId)))
    .returning({ id: inventoryPartSizesTable.id });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
