import { Router, type IRouter } from "express";
import { db, servicesTable } from "@workspace/db";
import { eq, and, ilike, desc, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { normalizeFieldRequirements } from "../lib/serviceFieldRequirements";
import { isMissingColumnError } from "../lib/settingsFallback";
import { syncServiceMatrix } from "../lib/matrixPricingStore";
import { readPricingTiers, type PriceRounding, type PricingTier } from "../lib/pricingMatrix";

const PRICE_ROUNDING = new Set<PriceRounding>(["none", "nearest_1", "nearest_5", "nearest_10"]);

function storedPricingMatrix(pricingMode: string, pricingMatrix: unknown, priceRounding: unknown): PricingTier[] | null {
  if (pricingMode !== "matrix") return null;
  const tiers = readPricingTiers(pricingMatrix);
  if (tiers.length === 0) return null;
  const rounding = PRICE_ROUNDING.has(priceRounding as PriceRounding)
    ? priceRounding as PriceRounding
    : tiers.find(tier => tier.priceRounding && PRICE_ROUNDING.has(tier.priceRounding))?.priceRounding ?? "none";
  return tiers.map((tier, index) => ({
    ...tier,
    maxSqft: index === tiers.length - 1 ? null : (typeof tier.maxSqft === "number" && Number.isFinite(tier.maxSqft) ? tier.maxSqft : null),
    priceRounding: rounding,
    calculationMode: tier.calculationMode === "per_unit_above_base" ? "per_unit_above_base" : tier.calculationMode === "flat" ? "flat" : tier.calculationMode,
  }));
}

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
    fieldRequirements: normalizeFieldRequirements(s.fieldRequirements),
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
  res.json({ ...service, fieldRequirements: normalizeFieldRequirements(service.fieldRequirements), createdAt: service.createdAt.toISOString(), updatedAt: service.updatedAt.toISOString() });
});

// POST /services — office roles only
router.post("/services", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;

  const { name, description, category, basePrice, estimatedDuration, p4pPercentage, isActive,
           pricingMode, pricingMatrix, priceRounding, linkedZoneTypeId, offSeasonStart, offSeasonEnd, fieldRequirements } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  // Treat empty-string or non-numeric p4pPercentage as null (inherit global rate)
  const parsedP4p = p4pPercentage !== undefined && p4pPercentage !== "" && p4pPercentage !== null
    ? parseFloat(p4pPercentage)
    : null;
  if (parsedP4p !== null && isNaN(parsedP4p)) {
    res.status(400).json({ error: "p4pPercentage must be a number or empty" });
    return;
  }

  const resolvedMode = ["flat", "per_sqft", "per_linear_ft", "area_and_linear", "matrix", "hourly"].includes(pricingMode)
    ? pricingMode
    : "flat";
  const hourlyRate = req.body.hourlyRate !== undefined && req.body.hourlyRate !== "" ? parseFloat(req.body.hourlyRate) : null;
  const minimumHours = req.body.minimumBillableHours !== undefined && req.body.minimumBillableHours !== "" ? parseFloat(req.body.minimumBillableHours) : null;
  if (resolvedMode === "hourly" && !(hourlyRate != null && hourlyRate > 0)) {
    res.status(400).json({ error: "Enter an hourly rate greater than zero" });
    return;
  }

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
      basePrice: resolvedMode === "hourly" ? (hourlyRate ?? 0) : parseFloat(basePrice) || 0,
      hourlyRate: resolvedMode === "hourly" ? hourlyRate : null,
      minimumBillableMinutes: resolvedMode === "hourly" && minimumHours != null && minimumHours > 0 ? Math.round(minimumHours * 60) : null,
      linearRate: parseFloat(req.body.linearRate) || 0,
      estimatedDuration: estimatedDuration ? parseInt(estimatedDuration, 10) : null,
      p4pPercentage: parsedP4p,
      isActive: isActive !== false,
      pricingMode: resolvedMode,
      pricingMatrix: storedPricingMatrix(resolvedMode, pricingMatrix, priceRounding),
      linkedZoneTypeId: linkedZoneTypeId || null,
      offSeasonStart: parsedStart,
      offSeasonEnd: parsedEnd,
      fieldRequirements: normalizeFieldRequirements(fieldRequirements),
    })
    .returning();

  await syncServiceMatrix(tenantId, service.id, service.pricingMode, service.pricingMatrix);
  res.status(201).json({ ...service, fieldRequirements: normalizeFieldRequirements(service.fieldRequirements), createdAt: service.createdAt.toISOString(), updatedAt: service.updatedAt.toISOString() });
});

// PATCH /services/:id — office roles only
router.patch("/services/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;

  const id = parseInt(req.params.id, 10);
  const { name, description, category, basePrice, estimatedDuration, p4pPercentage, isActive,
           pricingMode, pricingMatrix, priceRounding, linkedZoneTypeId, offSeasonStart, offSeasonEnd, fieldRequirements } = req.body;

  const updates: Partial<typeof servicesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description || null;
  if (category !== undefined) updates.category = category || null;
  if (basePrice !== undefined) updates.basePrice = parseFloat(basePrice) || 0;
  if (req.body.linearRate !== undefined) updates.linearRate = parseFloat(req.body.linearRate) || 0;
  if (estimatedDuration !== undefined) updates.estimatedDuration = estimatedDuration ? parseInt(estimatedDuration, 10) : null;
  if (p4pPercentage !== undefined) updates.p4pPercentage = p4pPercentage !== "" && p4pPercentage != null ? parseFloat(p4pPercentage) : null;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  if (pricingMode !== undefined) {
    updates.pricingMode = ["flat", "per_sqft", "per_linear_ft", "area_and_linear", "matrix", "hourly"].includes(pricingMode)
      ? pricingMode
      : "flat";
    updates.pricingMatrix = storedPricingMatrix(updates.pricingMode, pricingMatrix, priceRounding);
  } else if (pricingMatrix !== undefined) {
    updates.pricingMatrix = storedPricingMatrix("matrix", pricingMatrix, priceRounding);
  }
  if (req.body.hourlyRate !== undefined) {
    const rate = req.body.hourlyRate === "" || req.body.hourlyRate == null ? null : parseFloat(req.body.hourlyRate);
    updates.hourlyRate = rate;
    if ((updates.pricingMode ?? undefined) === "hourly" || req.body.pricingMode === "hourly") updates.basePrice = rate ?? 0;
  }
  if (req.body.minimumBillableHours !== undefined) {
    const hours = req.body.minimumBillableHours === "" || req.body.minimumBillableHours == null ? null : parseFloat(req.body.minimumBillableHours);
    updates.minimumBillableMinutes = hours != null && hours > 0 ? Math.round(hours * 60) : null;
  }
  if ((updates.pricingMode === "hourly" || req.body.pricingMode === "hourly") && !(Number(updates.hourlyRate ?? req.body.hourlyRate) > 0)) {
    res.status(400).json({ error: "Enter an hourly rate greater than zero" });
    return;
  }
  if (linkedZoneTypeId !== undefined) updates.linkedZoneTypeId = linkedZoneTypeId || null;
  if (fieldRequirements !== undefined) updates.fieldRequirements = normalizeFieldRequirements(fieldRequirements);

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
  if (updates.pricingMode !== undefined || updates.pricingMatrix !== undefined) {
    await syncServiceMatrix(tenantId, updated.id, updated.pricingMode, updated.pricingMatrix);
  }
  res.json({ ...updated, fieldRequirements: normalizeFieldRequirements(updated.fieldRequirements), createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

// DELETE /services/:id — office roles only
router.delete("/services/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;

  const id = parseInt(req.params.id, 10);
  await db.delete(servicesTable).where(and(eq(servicesTable.id, id), eq(servicesTable.tenantId, tenantId)));
  res.status(204).send();
});

router.get("/settings/service-categories", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.execute(sql`SELECT id, name, created_at AS "createdAt" FROM service_categories WHERE tenant_id=${tenantId} ORDER BY name`);
  res.json({ categories: rows.rows });
});

async function createServiceCategory(req: import("express").Request, res: import("express").Response): Promise<void> {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;
  const name = String(req.body?.name ?? "").trim();
  if (!name || name.length > 80) { res.status(400).json({ error: "Enter a category name up to 80 characters" }); return; }
  try {
    const existing = await db.execute(sql`SELECT id, name FROM service_categories WHERE tenant_id=${tenantId} AND lower(name)=lower(${name}) LIMIT 1`);
    if (existing.rows.length) { res.status(200).json(existing.rows[0]); return; }
    const inserted = await db.execute(sql`INSERT INTO service_categories (tenant_id, name) VALUES (${tenantId}, ${name}) RETURNING id, name`);
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (isMissingColumnError(error) || code === "42P01") {
      res.status(503).json({ error: "Service categories are not ready yet. Reload and try again." });
      return;
    }
    if (code === "23505") {
      const existing = await db.execute(sql`SELECT id, name FROM service_categories WHERE tenant_id=${tenantId} AND lower(name)=lower(${name}) LIMIT 1`);
      if (existing.rows.length) { res.status(200).json(existing.rows[0]); return; }
    }
    throw error;
  }
}

router.post("/settings/service-categories", createServiceCategory);
router.post("/service-categories", createServiceCategory);

router.patch("/settings/service-categories/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;
  const id = parseInt(req.params.id, 10);
  const name = String(req.body?.name ?? "").trim();
  if (!name || name.length > 80) { res.status(400).json({ error: "Enter a category name up to 80 characters" }); return; }
  const current = await db.execute(sql`SELECT name FROM service_categories WHERE id=${id} AND tenant_id=${tenantId}`);
  if (!current.rows.length) { res.status(404).json({ error: "Category not found" }); return; }
  const previous = String(current.rows[0].name);
  await db.execute(sql`UPDATE service_categories SET name=${name} WHERE id=${id} AND tenant_id=${tenantId}`);
  await db.execute(sql`UPDATE services SET category=${name} WHERE tenant_id=${tenantId} AND category=${previous}`);
  res.json({ id, name });
});

router.delete("/settings/service-categories/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await requireOfficeRole(req, res, tenantId)) return;
  const id = parseInt(req.params.id, 10);
  const current = await db.execute(sql`SELECT name FROM service_categories WHERE id=${id} AND tenant_id=${tenantId}`);
  if (!current.rows.length) { res.status(404).json({ error: "Category not found" }); return; }
  await db.execute(sql`UPDATE services SET category=NULL WHERE tenant_id=${tenantId} AND category=${String(current.rows[0].name)}`);
  await db.execute(sql`DELETE FROM service_categories WHERE id=${id} AND tenant_id=${tenantId}`);
  res.status(204).send();
});

export default router;
