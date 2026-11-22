import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, lineCatalogItemsTable } from "@workspace/db";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { installLineCatalogSchema } from "../lib/lineCatalogSchema";

const router: IRouter = Router();

function money(value: unknown, label: string, required: boolean): number | null {
  if (value === null || value === undefined || value === "") {
    if (required) return 0;
    return null;
  }
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be zero or more`);
  }
  return Math.round(amount * 10000) / 10000;
}

function readCatalogBody(body: Record<string, unknown>, partial: boolean) {
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!partial || body.description !== undefined) {
    if (!description) throw new Error("Description is required");
    if (description.length > 500) throw new Error("Description must be 500 characters or less");
  }
  let unit: string | null | undefined;
  if (!partial || body.unit !== undefined) {
    if (body.unit === null || body.unit === undefined || body.unit === "") unit = null;
    else if (typeof body.unit !== "string") throw new Error("Unit must be text");
    else {
      unit = body.unit.trim();
      if (!unit) unit = null;
      else if (unit.length > 40) throw new Error("Unit must be 40 characters or less");
    }
  }
  const internalCost = !partial || body.internalCost !== undefined ? money(body.internalCost, "Internal cost", false) : undefined;
  const unitPrice = !partial || body.unitPrice !== undefined ? money(body.unitPrice, "Customer unit price", true) : undefined;
  const markup = !partial || body.markup !== undefined ? money(body.markup, "Markup", true) : undefined;
  return {
    ...(description || body.description !== undefined ? { description } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(internalCost !== undefined ? { internalCost } : {}),
    ...(unitPrice !== undefined && unitPrice !== null ? { unitPrice } : {}),
    ...(markup !== undefined && markup !== null ? { markupPct: markup } : {}),
  };
}

function present(row: typeof lineCatalogItemsTable.$inferSelect) {
  return {
    id: row.id,
    description: row.description,
    unit: row.unit,
    internalCost: row.internalCost,
    unitPrice: row.unitPrice,
    markup: row.markupPct,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireOffice(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const allowed = await isAdminRole(getTenantId(req), getUserId(req));
  if (!allowed) {
    res.status(403).json({ error: "Forbidden: office role required" });
    return false;
  }
  return true;
}

router.use("/line-catalog", async (_req, _res, next) => {
  try {
    await installLineCatalogSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/line-catalog", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(lineCatalogItemsTable)
    .where(eq(lineCatalogItemsTable.tenantId, tenantId))
    .orderBy(desc(lineCatalogItemsTable.updatedAt));
  res.json(rows.map(present));
});

router.post("/line-catalog", async (req, res): Promise<void> => {
  if (!(await requireOffice(req, res))) return;
  const tenantId = getTenantId(req);
  try {
    const values = readCatalogBody(req.body ?? {}, false);
    if (!values.description) {
      res.status(400).json({ error: "Description is required" });
      return;
    }
    const [row] = await db.insert(lineCatalogItemsTable).values({
      tenantId,
      description: values.description,
      unit: values.unit ?? null,
      internalCost: values.internalCost ?? null,
      unitPrice: values.unitPrice ?? 0,
      markupPct: values.markupPct ?? 0,
    }).returning();
    res.status(201).json(present(row));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not save pass-through item" });
  }
});

router.patch("/line-catalog/:id", async (req, res): Promise<void> => {
  if (!(await requireOffice(req, res))) return;
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Pass-through item not found" });
    return;
  }
  try {
    const values = readCatalogBody(req.body ?? {}, true);
    const [row] = await db.update(lineCatalogItemsTable).set(values)
      .where(and(eq(lineCatalogItemsTable.id, id), eq(lineCatalogItemsTable.tenantId, tenantId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Pass-through item not found" });
      return;
    }
    res.json(present(row));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not save pass-through item" });
  }
});

router.delete("/line-catalog/:id", async (req, res): Promise<void> => {
  if (!(await requireOffice(req, res))) return;
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [row] = await db.delete(lineCatalogItemsTable)
    .where(and(eq(lineCatalogItemsTable.id, id), eq(lineCatalogItemsTable.tenantId, tenantId)))
    .returning({ id: lineCatalogItemsTable.id });
  if (!row) {
    res.status(404).json({ error: "Pass-through item not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
