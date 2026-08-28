import { Router, type IRouter } from "express";
import { db, servicesTable } from "@workspace/db";
import { eq, and, ilike, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

async function requireOfficeRole(req: import("express").Request, res: import("express").Response, tenantId: number): Promise<boolean> {
  const userId = getUserId(req);
  const allowed = await isAdminRole(tenantId, userId);
  if (!allowed) {
    res.status(403).json({ error: "Forbidden: office role required" });
    return false;
  }
  return true;
}

const router: IRouter = Router();

// GET /services — list all services for tenant
router.get("/services", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { q, category, activeOnly } = req.query as Record<string, string>;

  let where = eq(servicesTable.tenantId, tenantId);
  if (q) {
    where = and(where, ilike(servicesTable.name, `%${q}%`)) as typeof where;
  }
  if (category) {
    where = and(where, eq(servicesTable.category, category)) as typeof where;
  }
  if (activeOnly === "true") {
    where = and(where, eq(servicesTable.isActive, true)) as typeof where;
  }

  const rows = await db
    .select()
    .from(servicesTable)
    .where(where)
    .orderBy(desc(servicesTable.createdAt));

  res.json(rows.map(s => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  })));
});

// GET /services/:id
router.get("/services/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [service] = await db
    .select()
    .from(servicesTable)
    .where(and(eq(servicesTable.id, id), eq(servicesTable.tenantId, tenantId)));

  if (!service) { res.status(404).json({ error: "Service not found" }); return; }
  res.json({ ...service, createdAt: service.createdAt.toISOString(), updatedAt: service.updatedAt.toISOString() });
});

// POST /services — office roles only
router.post("/services", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;

  const { name, description, category, basePrice, estimatedDuration, p4pPercentage, isActive,
          pricingMode, pricingMatrix, linkedZoneTypeId, offSeasonStart, offSeasonEnd } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  // Treat empty-string or non-numeric p4pPercentage as null (inherit global rate)
  const parsedP4p = p4pPercentage !== undefined && p4pPercentage !== "" && p4pPercentage !== null
    ? parseFloat(p4pPercentage)
    : null;
  if (parsedP4p !== null && isNaN(parsedP4p)) {
    res.status(400).json({ error: "p4pPercentage must be a number or empty" });
    return;
  }

  const resolvedMode = ["flat", "per_sqft", "per_linear_ft", "matrix"].includes(pricingMode)
    ? pricingMode
    : "flat";

  // Off-season: both must be provided together or neither
  const mmddRe = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const parsedStart = offSeasonStart || null;
  const parsedEnd = offSeasonEnd || null;
  if ((parsedStart === null) !== (parsedEnd === null)) {
    res.status(400).json({ error: "offSeasonStart and offSeasonEnd must both be set or both be empty" });
    return;
  }
  if (parsedStart && !mmddRe.test(parsedStart)) {
    res.status(400).json({ error: "offSeasonStart must be MM-DD format" });
    return;
  }
  if (parsedEnd && !mmddRe.test(parsedEnd)) {
    res.status(400).json({ error: "offSeasonEnd must be MM-DD format" });
    return;
  }

  const [service] = await db
    .insert(servicesTable)
    .values({
      tenantId,
      name,
      description: description || null,
      category: category || null,
      basePrice: parseFloat(basePrice) || 0,
      estimatedDuration: estimatedDuration ? parseInt(estimatedDuration, 10) : null,
      p4pPercentage: parsedP4p,
      isActive: isActive !== false,
      pricingMode: resolvedMode,
      pricingMatrix: resolvedMode === "matrix" && Array.isArray(pricingMatrix) ? pricingMatrix : null,
      linkedZoneTypeId: linkedZoneTypeId || null,
      offSeasonStart: parsedStart,
      offSeasonEnd: parsedEnd,
    })
    .returning();

  res.status(201).json({ ...service, createdAt: service.createdAt.toISOString(), updatedAt: service.updatedAt.toISOString() });
});

// PATCH /services/:id — office roles only
router.patch("/services/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;

  const id = parseInt(req.params.id, 10);
  const { name, description, category, basePrice, estimatedDuration, p4pPercentage, isActive,
          pricingMode, pricingMatrix, linkedZoneTypeId, offSeasonStart, offSeasonEnd } = req.body;

  const updates: Partial<typeof servicesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description || null;
  if (category !== undefined) updates.category = category || null;
  if (basePrice !== undefined) updates.basePrice = parseFloat(basePrice) || 0;
  if (estimatedDuration !== undefined) updates.estimatedDuration = estimatedDuration ? parseInt(estimatedDuration, 10) : null;
  if (p4pPercentage !== undefined) updates.p4pPercentage = p4pPercentage !== "" && p4pPercentage != null ? parseFloat(p4pPercentage) : null;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  if (pricingMode !== undefined) {
    updates.pricingMode = ["flat", "per_sqft", "per_linear_ft", "matrix"].includes(pricingMode)
      ? pricingMode
      : "flat";
    updates.pricingMatrix = pricingMode === "matrix" && Array.isArray(pricingMatrix) ? pricingMatrix : null;
  } else if (pricingMatrix !== undefined) {
    updates.pricingMatrix = Array.isArray(pricingMatrix) ? pricingMatrix : null;
  }
  if (linkedZoneTypeId !== undefined) updates.linkedZoneTypeId = linkedZoneTypeId || null;

  // Off-season: validate and update together
  if (offSeasonStart !== undefined || offSeasonEnd !== undefined) {
    const mmddRe = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    const parsedStart = offSeasonStart || null;
    const parsedEnd = offSeasonEnd || null;
    if ((parsedStart === null) !== (parsedEnd === null)) {
      res.status(400).json({ error: "offSeasonStart and offSeasonEnd must both be set or both be empty" });
      return;
    }
    if (parsedStart && !mmddRe.test(parsedStart)) {
      res.status(400).json({ error: "offSeasonStart must be MM-DD format" });
      return;
    }
    if (parsedEnd && !mmddRe.test(parsedEnd)) {
      res.status(400).json({ error: "offSeasonEnd must be MM-DD format" });
      return;
    }
    updates.offSeasonStart = parsedStart;
    updates.offSeasonEnd = parsedEnd;
  }

  const [updated] = await db
    .update(servicesTable)
    .set(updates)
    .where(and(eq(servicesTable.id, id), eq(servicesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Service not found" }); return; }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

// DELETE /services/:id — office roles only
router.delete("/services/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;

  const id = parseInt(req.params.id, 10);
  await db.delete(servicesTable).where(and(eq(servicesTable.id, id), eq(servicesTable.tenantId, tenantId)));
  res.status(204).send();
});

export default router;
