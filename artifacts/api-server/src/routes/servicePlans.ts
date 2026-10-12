import { Router, type IRouter } from "express";
import crypto from "crypto";
import {
  db, planTemplatesTable, customerPlansTable, jobsTable, customersTable,
  propertiesTable, usersTable, invoicesTable, activityLogTable, tenantsTable,
  servicesTable,
} from "@workspace/db";
import { eq, and, sql, gt, ne, inArray, isNotNull, isNull } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { rescheduleFee } from "../lib/rescheduleFee";
import { isAdminRole } from "../lib/roles";
import {
  generatePlanPreview, billingCycleDays, type PlanServiceRule,
  type ClusterCandidate, type PlanVisitCandidate,
} from "../lib/planSchedulingEngine";
import { enqueueInvoiceEmail } from "../lib/billingScheduler";
import { sendEmail } from "../lib/emailProvider";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtTemplate(t: typeof planTemplatesTable.$inferSelect) {
  return {
    ...t,
    services: (t.services as unknown[]) ?? [],
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function fmtPlan(
  p: typeof customerPlansTable.$inferSelect,
  extras?: { customerName?: string | null; propertyAddress?: string | null },
) {
  return {
    ...p,
    serviceState: (p.serviceState as unknown[]) ?? [],
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    lastBilledAt: p.lastBilledAt?.toISOString() ?? null,
    renewalReminderSentAt: p.renewalReminderSentAt?.toISOString() ?? null,
    customerName: extras?.customerName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
  };
}

function fmtVisit(v: PlanVisitCandidate) {
  return {
    serviceId: v.serviceId,
    serviceName: v.serviceName,
    date: v.date.toISOString(),
    idealDate: v.idealDate.toISOString(),
    assigneeId: v.assigneeId,
    assigneeName: v.assigneeName,
    clustered: v.clustered,
  };
}

/** Looks up already-scheduled jobs for a service, with property geo + assignee name, for clustering. */
function makeClusterLookup(tenantId: number) {
  return async (serviceId: number): Promise<ClusterCandidate[]> => {
    const rows = await db
      .select({
        id: jobsTable.id,
        scheduledAt: jobsTable.scheduledAt,
        assigneeId: jobsTable.assigneeId,
        assigneeName: usersTable.name,
        lat: propertiesTable.lat,
        lng: propertiesTable.lng,
      })
      .from(jobsTable)
      .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .where(
        and(
          eq(jobsTable.tenantId, tenantId),
          eq(jobsTable.serviceId, serviceId),
          eq(jobsTable.status, "scheduled"),
          gt(jobsTable.scheduledAt, new Date()),
        ),
      );
    return rows.map(r => ({
      jobId: r.id,
      scheduledAt: r.scheduledAt,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      lat: r.lat,
      lng: r.lng,
    }));
  };
}

async function requireAdmin(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office/department manager roles" });
    return false;
  }
  return true;
}

// ── Matrix validation ─────────────────────────────────────────────────────────

function validatePlanMatrix(matrix: PlanPricingTier[]): string | null {
  if (matrix.length === 0) return null; // empty = no tiers to validate
  for (const tier of matrix) {
    if (typeof tier.minSqft !== "number" || tier.minSqft < 0) return "Each tier must have a non-negative minSqft";
    if (tier.maxSqft !== null && (typeof tier.maxSqft !== "number" || tier.maxSqft < tier.minSqft)) {
      return "Each tier's maxSqft must be >= minSqft (or null for open-ended)";
    }
    if (typeof tier.price !== "number" || tier.price < 0) return "Each tier must have a non-negative price";
  }
  // Sort by minSqft and verify: no overlaps, no gaps that skip coverage, only last may be open-ended
  const sorted = [...matrix].sort((a, b) => a.minSqft - b.minSqft);
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (cur.maxSqft === null) return "Only the last (highest) tier may be open-ended";
    if (next.minSqft <= cur.maxSqft) return `Tiers overlap: tier ending at ${cur.maxSqft} overlaps tier starting at ${next.minSqft}`;
  }
  const openEnded = matrix.filter(t => t.maxSqft === null);
  if (openEnded.length > 1) return "At most one open-ended tier (no upper limit) is allowed";
  return null;
}

// ── Plan Templates CRUD ───────────────────────────────────────────────────────

router.get("/plan-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(planTemplatesTable).where(eq(planTemplatesTable.tenantId, tenantId)).orderBy(planTemplatesTable.name);
  res.json(rows.map(fmtTemplate));
});

router.post("/plan-templates", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const { name, description, services, visitCount, billingCycle, customCycleDays, price, autoRenewDefault, isActive, pricingMode, pricingMatrix, offSeasonStart, offSeasonEnd } = req.body;
  if (!name || !Array.isArray(services) || services.length === 0) {
    res.status(400).json({ error: "name and at least one service are required" });
    return;
  }
  const resolvedMode = ["flat", "matrix", "sum_services"].includes(pricingMode) ? pricingMode : "flat";
  if (resolvedMode === "matrix") {
    const matrixErr = validatePlanMatrix(Array.isArray(pricingMatrix) ? pricingMatrix : []);
    if (matrixErr) { res.status(400).json({ error: matrixErr }); return; }
  }
  const [t] = await db.insert(planTemplatesTable).values({
    tenantId,
    name,
    description: description ?? null,
    services,
    visitCount: visitCount ?? services.length,
    billingCycle: billingCycle ?? "monthly",
    customCycleDays: customCycleDays ?? null,
    price: price ?? 0,
    autoRenewDefault: autoRenewDefault ?? true,
    isActive: isActive ?? true,
    pricingMode: resolvedMode,
    pricingMatrix: resolvedMode === "matrix" && Array.isArray(pricingMatrix) ? pricingMatrix : null,
    offSeasonStart: offSeasonStart ?? null,
    offSeasonEnd: offSeasonEnd ?? null,
  }).returning();
  res.status(201).json(fmtTemplate(t));
});

router.get("/plan-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [t] = await db.select().from(planTemplatesTable).where(and(eq(planTemplatesTable.id, id), eq(planTemplatesTable.tenantId, tenantId)));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmtTemplate(t));
});

router.patch("/plan-templates/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, description, services, visitCount, billingCycle, customCycleDays, price, autoRenewDefault, isActive, pricingMode, pricingMatrix, offSeasonStart, offSeasonEnd } = req.body;
  const update: Partial<typeof planTemplatesTable.$inferInsert> = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (services !== undefined) update.services = services;
  if (visitCount !== undefined) update.visitCount = visitCount;
  if (billingCycle !== undefined) update.billingCycle = billingCycle;
  if (customCycleDays !== undefined) update.customCycleDays = customCycleDays;
  if (price !== undefined) update.price = price;
  if (autoRenewDefault !== undefined) update.autoRenewDefault = autoRenewDefault;
  if (isActive !== undefined) update.isActive = isActive;
  if (offSeasonStart !== undefined) update.offSeasonStart = offSeasonStart ?? null;
  if (offSeasonEnd !== undefined) update.offSeasonEnd = offSeasonEnd ?? null;
  if (pricingMode !== undefined) {
    const resolvedMode = ["flat", "matrix", "sum_services"].includes(pricingMode) ? pricingMode : "flat";
    if (resolvedMode === "matrix") {
      const matrixErr = validatePlanMatrix(Array.isArray(pricingMatrix) ? pricingMatrix : []);
      if (matrixErr) { res.status(400).json({ error: matrixErr }); return; }
    }
    update.pricingMode = resolvedMode;
    update.pricingMatrix = resolvedMode === "matrix" && Array.isArray(pricingMatrix) ? pricingMatrix : null;
  } else if (pricingMatrix !== undefined) {
    const matrixErr = validatePlanMatrix(Array.isArray(pricingMatrix) ? pricingMatrix : []);
    if (matrixErr) { res.status(400).json({ error: matrixErr }); return; }
    update.pricingMatrix = Array.isArray(pricingMatrix) ? pricingMatrix : null;
  }
  const [updated] = await db.update(planTemplatesTable).set(update).where(and(eq(planTemplatesTable.id, id), eq(planTemplatesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmtTemplate(updated));
});

router.delete("/plan-templates/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [inUse] = await db
    .select({ id: customerPlansTable.id })
    .from(customerPlansTable)
    .where(and(eq(customerPlansTable.templateId, id), eq(customerPlansTable.tenantId, tenantId)))
    .limit(1);
  if (inUse) {
    res.status(409).json({ error: "Cannot delete a plan template that has been sold to customers. Mark it inactive instead." });
    return;
  }
  const [deleted] = await db
    .delete(planTemplatesTable)
    .where(and(eq(planTemplatesTable.id, id), eq(planTemplatesTable.tenantId, tenantId)))
    .returning({ id: planTemplatesTable.id });
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

// ── Plan price resolver ───────────────────────────────────────────────────────

export interface MeasurementPolygon {
  id: string;
  label?: string | null;
  zoneTypeId?: string | null;
  areaSqft?: number | null;
  lengthFt?: number | null;
  mode?: "area" | "linear";
  enabled?: boolean;
}

export interface MeasurementZoneType {
  id: string;
  name: string;
  mode?: "area" | "linear";
}

export interface ZoneMeasurements {
  areaSqft: number;
  lengthFt: number;
  mode: "area" | "linear";
}

interface PlanPricingTier {
  minSqft: number;
  maxSqft: number | null;
  price: number;
}

function resolvePlanMatrixPrice(matrix: PlanPricingTier[], areaSqft: number): number | null {
  const sorted = [...matrix].sort((a, b) => a.minSqft - b.minSqft);
  for (const tier of sorted) {
    if (areaSqft >= tier.minSqft && (tier.maxSqft === null || areaSqft <= tier.maxSqft)) {
      return tier.price;
    }
  }
  return null;
}

export function resolveServiceMatrixPrice(
  pricingMode: string,
  basePrice: number,
  pricingMatrix: unknown,
  measurements: ZoneMeasurements,
): number {
  if (pricingMode === "per_sqft") return basePrice * measurements.areaSqft;
  if (pricingMode === "per_linear_ft") return basePrice * measurements.lengthFt;
  if (pricingMode !== "matrix" || !Array.isArray(pricingMatrix) || pricingMatrix.length === 0) {
    return basePrice;
  }
  const quantity = measurements.mode === "linear" ? measurements.lengthFt : measurements.areaSqft;
  const sorted = [...(pricingMatrix as PlanPricingTier[])].sort((a, b) => a.minSqft - b.minSqft);
  for (const tier of sorted) {
    if (quantity >= tier.minSqft && (tier.maxSqft === null || quantity <= tier.maxSqft)) {
      if (tier.maxSqft === null && (tier as any).perSqftRate != null && (tier as any).perSqftRate > 0) {
        return (tier as any).perSqftRate * quantity;
      }
      return tier.price;
    }
  }
  return basePrice;
}

export function buildZoneMeasurementMap(
  polygons: MeasurementPolygon[],
  zoneTypes: MeasurementZoneType[],
): Map<string, ZoneMeasurements> {
  const zoneTypeById = new Map(zoneTypes.map(zoneType => [zoneType.id, zoneType]));
  const zoneTypeIdByName = new Map(zoneTypes.map(zoneType => [zoneType.name, zoneType.id]));
  const measurements = new Map<string, ZoneMeasurements>();

  for (const polygon of polygons) {
    if (polygon.enabled === false) continue;
    const zoneTypeId = polygon.zoneTypeId ?? (polygon.label ? zoneTypeIdByName.get(polygon.label) : undefined);
    if (!zoneTypeId) continue;

    const configuredMode = zoneTypeById.get(zoneTypeId)?.mode ?? "area";
    const mode = polygon.mode ?? configuredMode;
    const current = measurements.get(zoneTypeId) ?? { areaSqft: 0, lengthFt: 0, mode };
    current.mode = mode;
    if (mode === "linear") {
      current.lengthFt += polygon.lengthFt ?? 0;
    } else {
      current.areaSqft += polygon.areaSqft ?? 0;
    }
    measurements.set(zoneTypeId, current);
  }

  return measurements;
}

router.post("/plan-templates/resolve-price", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { templateId, propertyId } = req.body;
  if (!templateId || !propertyId) {
    res.status(400).json({ error: "templateId and propertyId are required" });
    return;
  }

  const [template] = await db.select().from(planTemplatesTable)
    .where(and(eq(planTemplatesTable.id, templateId), eq(planTemplatesTable.tenantId, tenantId)));
  if (!template) { res.status(404).json({ error: "Plan template not found" }); return; }

  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  const mode = template.pricingMode ?? "flat";

  if (mode === "flat") {
    res.json({ resolvedPrice: template.price, pricingMode: "flat" });
    return;
  }

  if (mode === "matrix") {
    const matrix = (template.pricingMatrix as PlanPricingTier[] | null) ?? [];
    const areaSqft = property.serviceableAreaSqft ?? 0;
    const resolved = resolvePlanMatrixPrice(matrix, areaSqft);
    res.json({
      resolvedPrice: resolved ?? template.price,
      pricingMode: "matrix",
    });
    return;
  }

  if (mode === "sum_services") {
    const planServices = ((template.services as unknown[]) ?? []) as PlanServiceRule[];
    const serviceIds = planServices.map(s => s.serviceId);
    if (serviceIds.length === 0) {
      res.json({ resolvedPrice: template.price, pricingMode: "sum_services", breakdown: [] });
      return;
    }

    const svcRows = await db.select({
      id: servicesTable.id,
      name: servicesTable.name,
      basePrice: servicesTable.basePrice,
      pricingMode: servicesTable.pricingMode,
      pricingMatrix: servicesTable.pricingMatrix,
      linkedZoneTypeId: servicesTable.linkedZoneTypeId,
    }).from(servicesTable)
      .where(and(inArray(servicesTable.id, serviceIds), eq(servicesTable.tenantId, tenantId)));

    const polygons = ((property.measurementPolygons as unknown[]) ?? []) as MeasurementPolygon[];
    const [tenant] = await db.select({ measurementZoneTypes: tenantsTable.measurementZoneTypes })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));
    const zoneTypes = ((tenant?.measurementZoneTypes as unknown[]) ?? []) as MeasurementZoneType[];
    const zoneMeasurementMap = buildZoneMeasurementMap(polygons, zoneTypes);
    const totalAreaSqft = property.serviceableAreaSqft ?? 0;
    const totalLengthFt = [...zoneMeasurementMap.values()].reduce((sum, measurement) => sum + measurement.lengthFt, 0);

    const breakdown: Array<{ serviceId: number; serviceName: string; areaSqft: number; lengthFt: number; price: number }> = [];
    let total = 0;

    for (const svc of svcRows) {
      const measurements = svc.linkedZoneTypeId
        ? (zoneMeasurementMap.get(svc.linkedZoneTypeId) ?? { areaSqft: totalAreaSqft, lengthFt: 0, mode: "area" as const })
        : { areaSqft: totalAreaSqft, lengthFt: totalLengthFt, mode: svc.pricingMode === "per_linear_ft" ? "linear" as const : "area" as const };
      const price = resolveServiceMatrixPrice(svc.pricingMode, svc.basePrice, svc.pricingMatrix, measurements);
      total += price;
      breakdown.push({
        serviceId: svc.id,
        serviceName: svc.name,
        areaSqft: measurements.areaSqft,
        lengthFt: measurements.lengthFt,
        price,
      });
    }

    res.json({ resolvedPrice: total, pricingMode: "sum_services", breakdown });
    return;
  }

  res.json({ resolvedPrice: template.price, pricingMode: mode });
});

// ── Preview a plan's schedule before selling it ───────────────────────────────

router.post("/customer-plans/preview", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { templateId, propertyId, startDate } = req.body;
  if (!templateId || !propertyId || !startDate) {
    res.status(400).json({ error: "templateId, propertyId and startDate are required" });
    return;
  }

  const [template] = await db.select().from(planTemplatesTable).where(and(eq(planTemplatesTable.id, templateId), eq(planTemplatesTable.tenantId, tenantId)));
  if (!template) { res.status(404).json({ error: "Plan template not found" }); return; }

  const [property] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  const services = ((template.services as unknown[]) ?? []) as PlanServiceRule[];
  const visits = await generatePlanPreview({
    services,
    startDate: new Date(startDate),
    billingCycle: template.billingCycle,
    customCycleDays: template.customCycleDays,
    visitCount: template.visitCount,
    propertyLat: property.lat,
    propertyLng: property.lng,
    lookupClusterCandidates: makeClusterLookup(tenantId),
  });

  res.json({
    template: fmtTemplate(template),
    visits: visits.map(fmtVisit),
  });
});

// ── Sell / activate a plan ────────────────────────────────────────────────────

router.post("/customer-plans", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const { templateId, customerId, propertyId, startDate, autoRenew, visits, price: salePriceOverride } = req.body;

  if (!templateId || !customerId || !propertyId || !startDate) {
    res.status(400).json({ error: "templateId, customerId, propertyId and startDate are required" });
    return;
  }

  const [template] = await db.select().from(planTemplatesTable).where(and(eq(planTemplatesTable.id, templateId), eq(planTemplatesTable.tenantId, tenantId)));
  if (!template) { res.status(404).json({ error: "Plan template not found" }); return; }

  const [customer] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const [property] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId), eq(propertiesTable.customerId, customerId)));
  if (!property) { res.status(404).json({ error: "Property not found for this customer" }); return; }

  const start = new Date(startDate);
  const periodDays = billingCycleDays(template.billingCycle, template.customCycleDays);
  const endDate = new Date(start.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const services = ((template.services as unknown[]) ?? []) as PlanServiceRule[];

  // Use the office-confirmed visit list if provided (they may have shifted dates/techs in the
  // preview), otherwise fall back to computing a fresh preview server-side.
  let finalVisits: PlanVisitCandidate[];
  if (Array.isArray(visits) && visits.length > 0) {
    const requestedAssigneeIds = [...new Set(
      visits.map((v: { assigneeId?: number | null }) => v.assigneeId).filter((v: number | null | undefined): v is number => v != null),
    )];
    const validAssigneeIds = requestedAssigneeIds.length > 0
      ? new Set((await db.select({ id: usersTable.id }).from(usersTable).where(and(inArray(usersTable.id, requestedAssigneeIds), eq(usersTable.tenantId, tenantId)))).map(r => r.id))
      : new Set<number>();

    finalVisits = visits.map((v: { serviceId: number; serviceName: string; date: string; assigneeId?: number | null; assigneeName?: string | null }) => ({
      serviceId: v.serviceId,
      serviceName: v.serviceName,
      date: new Date(v.date),
      idealDate: new Date(v.date),
      assigneeId: v.assigneeId != null && validAssigneeIds.has(v.assigneeId) ? v.assigneeId : null,
      assigneeName: v.assigneeId != null && validAssigneeIds.has(v.assigneeId) ? (v.assigneeName ?? null) : null,
      clustered: false,
    }));
  } else {
    finalVisits = await generatePlanPreview({
      services,
      startDate: start,
      billingCycle: template.billingCycle,
      customCycleDays: template.customCycleDays,
      visitCount: template.visitCount,
      propertyLat: property.lat,
      propertyLng: property.lng,
      lookupClusterCandidates: makeClusterLookup(tenantId),
    });
  }

  // Seed each service's scheduling cursor with the latest visit date generated for it,
  // so the background worker continues the cadence from where this first period left off.
  const lastByService = new Map<number, Date>();
  for (const v of finalVisits) {
    const cur = lastByService.get(v.serviceId);
    if (!cur || v.date > cur) lastByService.set(v.serviceId, v.date);
  }
  const serviceState = services.map(s => ({
    serviceId: s.serviceId,
    serviceName: s.serviceName,
    frequencyDays: s.frequencyDays,
    lastScheduledAt: (lastByService.get(s.serviceId) ?? start).toISOString(),
  }));

  const userId = getUserId(req);
  let planId!: number;
  await db.transaction(async tx => {
    const [plan] = await tx.insert(customerPlansTable).values({
      tenantId,
      customerId,
      propertyId,
      templateId,
      templateName: template.name,
      startDate: start,
      endDate,
      billingCycle: template.billingCycle,
      customCycleDays: template.customCycleDays,
      billingPrice: typeof salePriceOverride === "number" && salePriceOverride >= 0 ? salePriceOverride : template.price,
      autoRenew: autoRenew ?? template.autoRenewDefault,
      status: "active",
      nextBillingDate: endDate.toISOString().slice(0, 10),
      serviceState,
    }).returning();
    planId = plan.id;

    for (const v of finalVisits) {
      await tx.insert(jobsTable).values({
        tenantId,
        title: `${v.serviceName} — Plan Visit`,
        status: "scheduled",
        priority: "normal",
        customerId,
        propertyId,
        assigneeId: v.assigneeId,
        serviceId: v.serviceId,
        planId: plan.id,
        scheduledAt: v.date,
      });
    }

    await tx.insert(activityLogTable).values({
      tenantId, userId, type: "plan_sold",
      message: `Plan "${template.name}" sold — ${finalVisits.length} visit(s) scheduled`,
      entityId: plan.id,
    });
  });

  // Annual plans bill once at plan start; monthly/quarterly/custom bill on the recurring worker.
  if (template.billingCycle === "annual") {
    await billPlanPeriod(tenantId, planId, userId);
  }

  const [row] = await db
    .select({ plan: customerPlansTable, customerName: customersTable.name, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(customersTable, eq(customerPlansTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(eq(customerPlansTable.id, planId));

  res.status(201).json(fmtPlan(row.plan, { customerName: row.customerName, propertyAddress: row.propertyAddress }));
});

// ── List / get / update plans ─────────────────────────────────────────────────

router.get("/customer-plans", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, status } = req.query as Record<string, string>;

  let where = eq(customerPlansTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (customerId) where = and(where, eq(customerPlansTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (status) where = and(where, eq(customerPlansTable.status, status)) as typeof where;

  const rows = await db
    .select({ plan: customerPlansTable, customerName: customersTable.name, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(customersTable, eq(customerPlansTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(where)
    .orderBy(sql`${customerPlansTable.createdAt} DESC`);

  res.json(rows.map(r => fmtPlan(r.plan, { customerName: r.customerName, propertyAddress: r.propertyAddress })));
});

router.get("/customer-plans/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [row] = await db
    .select({ plan: customerPlansTable, customerName: customersTable.name, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(customersTable, eq(customerPlansTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(and(eq(customerPlansTable.id, id), eq(customerPlansTable.tenantId, tenantId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const visits = await db
    .select({ job: jobsTable, assigneeName: usersTable.name })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.planId, id)))
    .orderBy(jobsTable.scheduledAt);

  const billingHistory = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.planId, id)))
    .orderBy(sql`${invoicesTable.createdAt} DESC`);

  res.json({
    ...fmtPlan(row.plan, { customerName: row.customerName, propertyAddress: row.propertyAddress }),
    visits: visits.map(v => ({
      id: v.job.id,
      title: v.job.title,
      status: v.job.status,
      scheduledAt: v.job.scheduledAt.toISOString(),
      serviceId: v.job.serviceId,
      assigneeId: v.job.assigneeId,
      assigneeName: v.assigneeName,
      cancelReason: v.job.cancelReason,
    })),
    billingHistory: billingHistory.map(i => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      status: i.status,
      total: i.total,
      dueDate: i.dueDate?.toISOString() ?? null,
      paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
  });
});

router.patch("/customer-plans/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const { status, autoRenew, notes, serviceState } = req.body;

  const [current] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, id), eq(customerPlansTable.tenantId, tenantId)));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  const update: Partial<typeof customerPlansTable.$inferInsert> = {};
  if (status !== undefined) update.status = status;
  if (autoRenew !== undefined) update.autoRenew = autoRenew;
  if (notes !== undefined) update.notes = notes;
  if (serviceState !== undefined) update.serviceState = serviceState; // upgrade/downgrade services for future visits

  const [updated] = await db.update(customerPlansTable).set(update).where(eq(customerPlansTable.id, id)).returning();

  // Cancelling a plan cancels all future scheduled visits; pausing leaves existing
  // visits on the calendar but stops the job-generation worker from adding new ones.
  if (status === "cancelled") {
    // Capture scheduled visits before cancelling them so we can include them in the customer email.
    const scheduledVisits = await db
      .select({ title: jobsTable.title, scheduledAt: jobsTable.scheduledAt })
      .from(jobsTable)
      .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.planId, id), eq(jobsTable.status, "scheduled")))
      .orderBy(jobsTable.scheduledAt);

    // Cancel all scheduled plan visits (direct planId links)
    await db.update(jobsTable)
      .set({ status: "cancelled", cancelReason: "Plan cancelled" })
      .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.planId, id), eq(jobsTable.status, "scheduled")));

    // Cancel recurring series roots linked to this plan, and all their scheduled child instances
    const seriesRoots = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(
        eq(jobsTable.tenantId, tenantId),
        eq(jobsTable.planId, id),
        isNotNull(jobsTable.recurrenceRule),
        isNull(jobsTable.recurrenceParentId),
      ));

    if (seriesRoots.length > 0) {
      const rootIds = seriesRoots.map(r => r.id);
      // Cancel all scheduled child occurrences whose parent is one of these roots
      await db.update(jobsTable)
        .set({ status: "cancelled", cancelReason: "Plan cancelled" })
        .where(and(
          eq(jobsTable.tenantId, tenantId),
          inArray(jobsTable.recurrenceParentId, rootIds),
          eq(jobsTable.status, "scheduled"),
        ));
    }

    // Notify the customer by email.
    try {
      const [customer] = await db
        .select({ email: customersTable.email, name: customersTable.name })
        .from(customersTable)
        .where(and(eq(customersTable.id, current.customerId), eq(customersTable.tenantId, tenantId)));

      const [tenant] = await db
        .select({
          emailProvider: tenantsTable.emailProvider,
          emailProviderConfig: tenantsTable.emailProviderConfig,
          businessEmail: tenantsTable.businessEmail,
          name: tenantsTable.name,
        })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId));

      if (customer?.email) {
        const providerConfig = {
          provider: (tenant?.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
          config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
          fromAddress: tenant?.businessEmail ?? (tenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
        };

        const visitLines = scheduledVisits.length > 0
          ? scheduledVisits.map(v => `  • ${v.title} — ${v.scheduledAt.toISOString().slice(0, 10)}`).join("\n")
          : "  (no upcoming visits were scheduled)";

        const subject = `Your "${current.templateName}" plan has been cancelled`;
        const body = [
          `Hi ${customer.name},`,
          "",
          `We're writing to let you know that your "${current.templateName}" service plan has been cancelled.`,
          "",
          scheduledVisits.length > 0
            ? `The following upcoming visit${scheduledVisits.length > 1 ? "s have" : " has"} also been cancelled:`
            : "There were no upcoming visits to cancel.",
          ...(scheduledVisits.length > 0 ? [visitLines] : []),
          "",
          "If you have any questions or believe this was done in error, please contact us.",
          "",
          `Thank you,`,
          tenant?.name ?? "Your Service Provider",
        ].join("\n");

        await sendEmail(providerConfig, customer.email, subject, body)
          .catch(err => logger.warn({ err, planId: id }, "Plan cancellation notification email failed"));
      }
    } catch (err) {
      logger.warn({ err, planId: id }, "Plan cancellation: failed to send customer notification email");
    }
  }

  await db.insert(activityLogTable).values({
    tenantId, userId, type: "plan_updated",
    message: `Plan "${current.templateName}" updated${status ? ` — status: ${status}` : ""}`,
    entityId: id,
  });

  res.json(fmtPlan(updated));
});

// ── Reschedule a single visit ─────────────────────────────────────────────────

router.post("/customer-plans/:id/visits/:jobId/reschedule", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const jobId = parseInt(req.params.jobId, 10);
  const { newScheduledAt, assigneeId } = req.body;

  if (!newScheduledAt) {
    res.status(400).json({ error: "newScheduledAt is required" });
    return;
  }
  const newDate = new Date(newScheduledAt);
  if (isNaN(newDate.getTime())) {
    res.status(400).json({ error: "newScheduledAt is not a valid date" });
    return;
  }

  // Load the plan so we can validate the new date falls within the active period
  const [plan] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, id), eq(customerPlansTable.tenantId, tenantId)));
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  // Verify the job belongs to this plan and is still schedulable
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.planId, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Visit not found on this plan" }); return; }
  if (job.status !== "scheduled") {
    res.status(400).json({ error: "Only scheduled visits can be rescheduled" });
    return;
  }

  // Guard: new date must fall within the plan's active period
  if (plan.startDate && newDate < plan.startDate) {
    res.status(400).json({ error: `Visit cannot be rescheduled before the plan start date (${plan.startDate.toISOString().slice(0, 10)})` });
    return;
  }
  if (plan.endDate && newDate > plan.endDate) {
    res.status(400).json({ error: `Visit cannot be rescheduled after the plan end date (${plan.endDate.toISOString().slice(0, 10)})` });
    return;
  }

  // Validate assignee if provided
  let resolvedAssigneeId: number | null = job.assigneeId;
  let assigneeName: string | null = null;
  if (assigneeId !== undefined) {
    if (assigneeId === null) {
      resolvedAssigneeId = null;
    } else {
      const [user] = await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(and(eq(usersTable.id, assigneeId), eq(usersTable.tenantId, tenantId)));
      if (!user) { res.status(400).json({ error: "Assignee not found" }); return; }
      resolvedAssigneeId = user.id;
      assigneeName = user.name;
    }
  } else if (job.assigneeId) {
    // Keep existing assignee name
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, job.assigneeId));
    assigneeName = user?.name ?? null;
  }

  const updatePayload: Partial<typeof jobsTable.$inferInsert> = {
    scheduledAt: newDate,
    assigneeId: resolvedAssigneeId,
  };
  try {
    if (job.scheduledAt.getTime() !== newDate.getTime()) Object.assign(updatePayload, rescheduleFee(job, req.body));
  } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }

  const [updated] = await db
    .update(jobsTable)
    .set(updatePayload)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.planId, id), eq(jobsTable.tenantId, tenantId), eq(jobsTable.scheduledAt, job.scheduledAt)))
    .returning();
  if (!updated) { res.status(409).json({ error: "Visit changed; refresh before rescheduling" }); return; }

  // Advance the plan's serviceState cursor for this service if the new date is later,
  // so the background worker continues scheduling from the correct point.
  if (job.serviceId) {
    const [plan] = await db.select().from(customerPlansTable).where(eq(customerPlansTable.id, id));
    if (plan) {
      const state = ((plan.serviceState as unknown[]) ?? []) as Array<{
        serviceId: number; serviceName: string; frequencyDays: number; lastScheduledAt: string;
      }>;
      const entry = state.find(s => s.serviceId === job.serviceId);
      if (entry) {
        const currentCursor = new Date(entry.lastScheduledAt);
        if (newDate > currentCursor) {
          entry.lastScheduledAt = newDate.toISOString();
          await db.update(customerPlansTable).set({ serviceState: state }).where(eq(customerPlansTable.id, id));
        }
      }
    }
  }

  await db.insert(activityLogTable).values({
    tenantId, userId, type: "plan_updated",
    message: `Visit rescheduled to ${newDate.toISOString().slice(0, 10)}`,
    entityId: id,
  });

  res.json({
    id: updated.id,
    scheduledAt: updated.scheduledAt.toISOString(),
    status: updated.status,
    assigneeId: updated.assigneeId,
    assigneeName,
  });
});

// ── Cancel a single visit (requires a reason) ─────────────────────────────────

router.post("/customer-plans/:id/visits/:jobId/cancel", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const jobId = parseInt(req.params.jobId, 10);
  const { reason } = req.body;
  if (!reason || !String(reason).trim()) {
    res.status(400).json({ error: "reason is required to cancel a plan visit" });
    return;
  }

  const [updated] = await db.update(jobsTable)
    .set({ status: "cancelled", cancelReason: reason })
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.planId, id), eq(jobsTable.tenantId, tenantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Visit not found on this plan" }); return; }
  res.json({ id: updated.id, status: updated.status, cancelReason: updated.cancelReason });
});

// ── Plan price resolver (exported for use by planScheduler) ──────────────────

/**
 * Resolves the current billing price for a customer plan by looking up the
 * template's pricing mode and the property's current satellite measurements.
 * Returns the resolved price and a human-readable note explaining the source
 * (e.g. "Resolved from property area (8,200 sqft)") for non-flat plans.
 */
export async function resolvePlanCurrentPrice(
  tenantId: number,
  templateId: number,
  propertyId: number,
): Promise<{ resolvedPrice: number; areaNote: string | null; pricingMode: string }> {
  const [template] = await db.select().from(planTemplatesTable)
    .where(and(eq(planTemplatesTable.id, templateId), eq(planTemplatesTable.tenantId, tenantId)));
  if (!template) return { resolvedPrice: 0, areaNote: null, pricingMode: "flat" };

  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)));
  if (!property) return { resolvedPrice: template.price, areaNote: null, pricingMode: template.pricingMode ?? "flat" };

  const mode = template.pricingMode ?? "flat";

  if (mode === "flat") {
    return { resolvedPrice: template.price, areaNote: null, pricingMode: "flat" };
  }

  if (mode === "matrix") {
    const matrix = (template.pricingMatrix as PlanPricingTier[] | null) ?? [];
    const areaSqft = property.serviceableAreaSqft ?? 0;
    const resolved = resolvePlanMatrixPrice(matrix, areaSqft);
    return {
      resolvedPrice: resolved ?? template.price,
      areaNote: areaSqft > 0 ? `Resolved from property area (${areaSqft.toLocaleString()} sqft)` : null,
      pricingMode: "matrix",
    };
  }

  if (mode === "sum_services") {
    const planServices = ((template.services as unknown[]) ?? []) as PlanServiceRule[];
    const serviceIds = planServices.map(s => s.serviceId);
    if (serviceIds.length === 0) {
      return { resolvedPrice: template.price, areaNote: null, pricingMode: "sum_services" };
    }

    const svcRows = await db.select({
      id: servicesTable.id,
      basePrice: servicesTable.basePrice,
      pricingMode: servicesTable.pricingMode,
      pricingMatrix: servicesTable.pricingMatrix,
      linkedZoneTypeId: servicesTable.linkedZoneTypeId,
    }).from(servicesTable)
      .where(and(inArray(servicesTable.id, serviceIds), eq(servicesTable.tenantId, tenantId)));

    const polygons = ((property.measurementPolygons as unknown[]) ?? []) as MeasurementPolygon[];
    const [tenant] = await db.select({ measurementZoneTypes: tenantsTable.measurementZoneTypes })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));
    const zoneTypes = ((tenant?.measurementZoneTypes as unknown[]) ?? []) as MeasurementZoneType[];
    const zoneMeasurementMap = buildZoneMeasurementMap(polygons, zoneTypes);
    const totalAreaSqft = property.serviceableAreaSqft ?? 0;
    const totalLengthFt = [...zoneMeasurementMap.values()].reduce((sum, measurement) => sum + measurement.lengthFt, 0);

    let total = 0;
    for (const svc of svcRows) {
      const measurements = svc.linkedZoneTypeId
        ? (zoneMeasurementMap.get(svc.linkedZoneTypeId) ?? { areaSqft: totalAreaSqft, lengthFt: 0, mode: "area" as const })
        : { areaSqft: totalAreaSqft, lengthFt: totalLengthFt, mode: svc.pricingMode === "per_linear_ft" ? "linear" as const : "area" as const };
      total += resolveServiceMatrixPrice(svc.pricingMode, svc.basePrice, svc.pricingMatrix, measurements);
    }

    const measurementParts = [
      totalAreaSqft > 0 ? `${totalAreaSqft.toLocaleString()} sqft` : null,
      totalLengthFt > 0 ? `${totalLengthFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} linear ft` : null,
    ].filter(Boolean);
    return {
      resolvedPrice: total,
      areaNote: measurementParts.length > 0 ? `Resolved from property measurements (${measurementParts.join(", ")})` : null,
      pricingMode: "sum_services",
    };
  }

  return { resolvedPrice: template.price, areaNote: null, pricingMode: mode };
}

// ── Manual renewal ────────────────────────────────────────────────────────────

export async function billPlanPeriod(
  tenantId: number,
  planId: number,
  userId: number,
  options?: { resolvedPrice?: number; areaNote?: string | null },
): Promise<{ invoiceId: number }> {
  const [plan] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, planId), eq(customerPlansTable.tenantId, tenantId)));
  if (!plan) throw new Error("Plan not found");

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, plan.customerId));
  const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const taxRate = tenant?.taxRate ?? 0;
  const subtotal = options?.resolvedPrice ?? plan.billingPrice;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;

  // Build the line item description — append the area note for non-flat pricing
  // so the customer can see exactly why this amount was charged.
  const baseDescription = `${plan.templateName} — ${plan.billingCycle} plan`;
  const lineItemDescription = options?.areaNote
    ? `${baseDescription} (${options.areaNote})`
    : baseDescription;

  // Guard against silently billing $0 — this can happen when a sum-services plan's services
  // have all been deleted since the plan was sold, or when a matrix plan has no matching tier.
  // Surface a clear error instead of creating a $0 invoice that looks like a system bug.
  if (subtotal === 0) {
    throw new Error(
      `Cannot bill plan "${plan.templateName}": the resolved price is $0. ` +
      "This usually means all services linked to the plan template have been deleted, or no pricing tier matched. " +
      "Update the plan template pricing before billing."
    );
  }

  let invoiceId!: number;
  await db.transaction(async tx => {
    const [invoice] = await tx.insert(invoicesTable).values({
      tenantId,
      invoiceNumber: invoiceNum,
      customerId: plan.customerId,
      planId: plan.id,
      status: customer?.email ? "sent" : "draft",
      publicToken: customer?.email ? crypto.randomBytes(32).toString("hex") : null,
      subtotal,
      tax,
      total,
      lineItems: [{ description: lineItemDescription, quantity: 1, unitPrice: subtotal, total: subtotal }],
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    }).returning();
    invoiceId = invoice.id;
    await tx.update(customerPlansTable).set({ lastBilledAt: new Date() }).where(eq(customerPlansTable.id, plan.id));
  });

  await db.insert(activityLogTable).values({
    tenantId, userId, type: "invoice_sent",
    message: `Plan invoice ${invoiceNum} generated for "${plan.templateName}"`,
    entityId: invoiceId,
  });

  if (customer?.email) await enqueueInvoiceEmail(tenantId, invoiceId);
  return { invoiceId };
}

router.post("/customer-plans/:id/renew", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  const [plan] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, id), eq(customerPlansTable.tenantId, tenantId)));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }
  if (plan.status === "cancelled") { res.status(400).json({ error: "Cannot renew a cancelled plan" }); return; }

  const periodDays = billingCycleDays(plan.billingCycle, plan.customCycleDays);
  const newEndDate = new Date(plan.endDate.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const newNextBillingDate = newEndDate.toISOString().slice(0, 10);

  // Resolve the current price for area-based plans so the renewal invoice
  // reflects the property's current measurements, not the original sale price.
  const { resolvedPrice, areaNote, pricingMode } = await resolvePlanCurrentPrice(tenantId, plan.templateId, plan.propertyId);
  const billingOptions = pricingMode !== "flat"
    ? { resolvedPrice, areaNote }
    : undefined;

  // Update billingPrice on the plan if it has drifted from the resolved value.
  if (pricingMode !== "flat" && resolvedPrice !== plan.billingPrice) {
    await db.update(customerPlansTable)
      .set({ billingPrice: resolvedPrice })
      .where(eq(customerPlansTable.id, id));
  }

  const { invoiceId } = await billPlanPeriod(tenantId, id, userId, billingOptions);

  const [updated] = await db.update(customerPlansTable)
    .set({ endDate: newEndDate, nextBillingDate: newNextBillingDate, status: "active", renewalReminderSentAt: null })
    .where(eq(customerPlansTable.id, id))
    .returning();

  res.json({ ...fmtPlan(updated), invoiceId });
});

// ── Dashboard ──────────────────────────────────────────────────────────────────

router.get("/plans/dashboard", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const now = new Date();
  const [tenantRow] = await db.select({ renewalWarningDays: tenantsTable.renewalWarningDays }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const warningDays = tenantRow?.renewalWarningDays ?? 30;
  const inWarning = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);

  const plans = await db
    .select({ plan: customerPlansTable, customerName: customersTable.name, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(customersTable, eq(customerPlansTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(and(eq(customerPlansTable.tenantId, tenantId), ne(customerPlansTable.status, "cancelled")));

  const activePlans = plans.filter(p => p.plan.status === "active");
  const monthlyEquivalent = (p: typeof customerPlansTable.$inferSelect) => {
    const days = billingCycleDays(p.billingCycle, p.customCycleDays);
    return (p.billingPrice / days) * 30;
  };
  const mrr = activePlans.reduce((sum, p) => sum + monthlyEquivalent(p.plan), 0);
  const autoRenewCount = activePlans.filter(p => p.plan.autoRenew).length;
  const expiringSoon = plans.filter(p => p.plan.status !== "cancelled" && p.plan.endDate <= inWarning && p.plan.endDate >= now);

  const planIds = plans.map(p => p.plan.id);
  const overdueInvoices = planIds.length > 0
    ? await db.select().from(invoicesTable).where(and(
      eq(invoicesTable.tenantId, tenantId),
      inArray(invoicesTable.planId, planIds),
      ne(invoicesTable.status, "paid"),
      sql`${invoicesTable.dueDate} IS NOT NULL AND ${invoicesTable.dueDate} < ${now.toISOString()}::timestamptz`,
    ))
    : [];
  const overduePlanIds = new Set(overdueInvoices.map(i => i.planId));

  res.json({
    activeCount: activePlans.length,
    mrr,
    autoRenewCount,
    expiringSoonCount: expiringSoon.length,
    renewalWarningDays: warningDays,
    overdueCount: overduePlanIds.size,
    plans: plans.map(p => ({
      ...fmtPlan(p.plan, { customerName: p.customerName, propertyAddress: p.propertyAddress }),
      isOverdue: overduePlanIds.has(p.plan.id),
    })),
  });
});

export default router;
