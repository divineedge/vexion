import { Router, type IRouter } from "express";
import {
  db,
  divisionsTable,
  routeTemplatesTable,
  jobsTable,
  crewsTable,
  customersTable,
  propertiesTable,
  usersTable,
  tenantsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import {
  sequenceStops,
  recomputeDriveTimesForOrder,
  computeCapacity,
  frequencyMatchesWeek,
  estimatedDriveMinutes,
  type RouteStop,
} from "../lib/routeSequencing";
import { getGoogleDriveMinutes } from "../lib/googleRoutes";

const router: IRouter = Router();

function formatDivision(d: typeof divisionsTable.$inferSelect) {
  return {
    id: d.id,
    tenantId: d.tenantId,
    name: d.name,
    category: d.category ?? null,
    depotLabel: d.depotLabel ?? null,
    depotLat: d.depotLat ?? null,
    depotLng: d.depotLng ?? null,
    shiftHoursPerDay: d.shiftHoursPerDay,
    crewIds: (d.crewIds as number[]) ?? [],
    technicianIds: (d.technicianIds as number[]) ?? [],
    isArchived: !!d.isArchived,
    createdAt: d.createdAt.toISOString(),
  };
}

function formatRouteTemplate(rt: typeof routeTemplatesTable.$inferSelect, extras?: { divisionName?: string | null }) {
  return {
    id: rt.id,
    tenantId: rt.tenantId,
    divisionId: rt.divisionId,
    divisionName: extras?.divisionName ?? null,
    name: rt.name,
    frequency: rt.frequency as "weekly" | "biweekly_a" | "biweekly_b" | "monthly",
    dayOfWeek: rt.dayOfWeek,
    exceptionFeeOverride: rt.exceptionFeeOverride ?? null,
    offSeasonStart: rt.offSeasonStart ?? null,
    offSeasonEnd: rt.offSeasonEnd ?? null,
    createdAt: rt.createdAt.toISOString(),
  };
}

// ── Divisions ────────────────────────────────────────────────────────────────

router.get("/divisions", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(divisionsTable).where(eq(divisionsTable.tenantId, tenantId)).orderBy(divisionsTable.name);
  res.json(rows.map(formatDivision));
});

router.get("/divisions/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select().from(divisionsTable).where(and(eq(divisionsTable.id, id), eq(divisionsTable.tenantId, tenantId)));
  if (!row) { res.status(404).json({ error: "Division not found" }); return; }
  res.json(formatDivision(row));
});

router.post("/divisions", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { name, category, depotLabel, depotLat, depotLng, shiftHoursPerDay, crewIds, technicianIds } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [division] = await db.insert(divisionsTable).values({
    tenantId,
    name,
    category: typeof category === "string" && category.trim() ? category.trim() : null,
    depotLabel: depotLabel ?? null,
    depotLat: depotLat != null ? Number(depotLat) : null,
    depotLng: depotLng != null ? Number(depotLng) : null,
    shiftHoursPerDay: shiftHoursPerDay != null ? Number(shiftHoursPerDay) : 8,
    crewIds: crewIds ?? [],
    technicianIds: technicianIds ?? [],
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "division_created", message: `Division "${name}" created`, entityId: division.id });

  res.status(201).json(formatDivision(division));
});

router.patch("/divisions/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, category, depotLabel, depotLat, depotLng, shiftHoursPerDay, crewIds, technicianIds, isArchived } = req.body;

  const updates: Partial<typeof divisionsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (category !== undefined) updates.category = typeof category === "string" && category.trim() ? category.trim() : null;
  if (depotLabel !== undefined) updates.depotLabel = depotLabel || null;
  if (depotLat !== undefined) updates.depotLat = depotLat != null ? Number(depotLat) : null;
  if (depotLng !== undefined) updates.depotLng = depotLng != null ? Number(depotLng) : null;
  if (shiftHoursPerDay !== undefined) updates.shiftHoursPerDay = Number(shiftHoursPerDay);
  if (crewIds !== undefined) updates.crewIds = crewIds;
  if (technicianIds !== undefined) updates.technicianIds = technicianIds;
  if (isArchived !== undefined) updates.isArchived = isArchived ? 1 : 0;

  const [updated] = await db.update(divisionsTable).set(updates).where(and(eq(divisionsTable.id, id), eq(divisionsTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Division not found" }); return; }
  res.json(formatDivision(updated));
});

router.delete("/divisions/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [inUse] = await db.select({ id: routeTemplatesTable.id }).from(routeTemplatesTable).where(and(eq(routeTemplatesTable.divisionId, id), eq(routeTemplatesTable.tenantId, tenantId))).limit(1);
  if (inUse) { res.status(409).json({ error: "Cannot delete a division with route templates. Delete or reassign its routes first." }); return; }

  await db.delete(divisionsTable).where(and(eq(divisionsTable.id, id), eq(divisionsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ── Route Templates ──────────────────────────────────────────────────────────

router.get("/route-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { divisionId } = req.query as Record<string, string>;

  let where = eq(routeTemplatesTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (divisionId) where = and(where, eq(routeTemplatesTable.divisionId, parseInt(divisionId, 10))) as typeof where;

  const rows = await db
    .select({ rt: routeTemplatesTable, divisionName: divisionsTable.name })
    .from(routeTemplatesTable)
    .leftJoin(divisionsTable, eq(routeTemplatesTable.divisionId, divisionsTable.id))
    .where(where)
    .orderBy(routeTemplatesTable.dayOfWeek, routeTemplatesTable.name);

  res.json(rows.map(r => formatRouteTemplate(r.rt, { divisionName: r.divisionName })));
});

router.post("/route-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { divisionId, name, frequency, dayOfWeek, exceptionFeeOverride, offSeasonStart, offSeasonEnd } = req.body;
  if (!divisionId || !name) { res.status(400).json({ error: "divisionId and name are required" }); return; }
  if ((offSeasonStart || offSeasonEnd) && (!/^\d{2}-\d{2}$/.test(offSeasonStart ?? "") || !/^\d{2}-\d{2}$/.test(offSeasonEnd ?? ""))) {
    res.status(400).json({ error: "offSeasonStart and offSeasonEnd must both use MM-DD" }); return;
  }

  const [division] = await db.select().from(divisionsTable).where(and(eq(divisionsTable.id, parseInt(divisionId, 10)), eq(divisionsTable.tenantId, tenantId)));
  if (!division) { res.status(404).json({ error: "Division not found" }); return; }

  const [rt] = await db.insert(routeTemplatesTable).values({
    tenantId,
    divisionId: parseInt(divisionId, 10),
    name,
    frequency: frequency ?? "weekly",
    dayOfWeek: dayOfWeek != null ? parseInt(dayOfWeek, 10) : 1,
    exceptionFeeOverride: exceptionFeeOverride != null ? Number(exceptionFeeOverride) : null,
    offSeasonStart: offSeasonStart || null,
    offSeasonEnd: offSeasonEnd || null,
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "route_template_created", message: `Route "${name}" created in ${division.name}`, entityId: rt.id });

  res.status(201).json(formatRouteTemplate(rt, { divisionName: division.name }));
});

router.patch("/route-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, frequency, dayOfWeek, exceptionFeeOverride, divisionId, offSeasonStart, offSeasonEnd } = req.body;
  if ((offSeasonStart !== undefined || offSeasonEnd !== undefined) && (
    (offSeasonStart || offSeasonEnd) && (!/^\d{2}-\d{2}$/.test(offSeasonStart ?? "") || !/^\d{2}-\d{2}$/.test(offSeasonEnd ?? ""))
  )) { res.status(400).json({ error: "offSeasonStart and offSeasonEnd must both use MM-DD" }); return; }

  const updates: Partial<typeof routeTemplatesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (frequency !== undefined) updates.frequency = frequency;
  if (dayOfWeek !== undefined) updates.dayOfWeek = parseInt(dayOfWeek, 10);
  if (exceptionFeeOverride !== undefined) updates.exceptionFeeOverride = exceptionFeeOverride != null ? Number(exceptionFeeOverride) : null;
  if (offSeasonStart !== undefined || offSeasonEnd !== undefined) {
    updates.offSeasonStart = offSeasonStart || null;
    updates.offSeasonEnd = offSeasonEnd || null;
  }
  if (divisionId !== undefined) {
    const targetDivisionId = parseInt(divisionId, 10);
    const [targetDivision] = await db.select({ id: divisionsTable.id }).from(divisionsTable).where(and(eq(divisionsTable.id, targetDivisionId), eq(divisionsTable.tenantId, tenantId)));
    if (!targetDivision) { res.status(404).json({ error: "Division not found" }); return; }
    updates.divisionId = targetDivisionId;
  }

  const [updated] = await db.transaction(async tx => {
    const [route] = await tx.update(routeTemplatesTable).set(updates).where(and(eq(routeTemplatesTable.id, id), eq(routeTemplatesTable.tenantId, tenantId))).returning();
    if (route) await tx.update(jobsTable).set({ offSeasonStart: route.offSeasonStart, offSeasonEnd: route.offSeasonEnd }).where(and(eq(jobsTable.routeTemplateId, id), eq(jobsTable.tenantId, tenantId)));
    return [route];
  });
  if (!updated) { res.status(404).json({ error: "Route template not found" }); return; }

  const [division] = await db.select({ name: divisionsTable.name }).from(divisionsTable).where(and(eq(divisionsTable.id, updated.divisionId), eq(divisionsTable.tenantId, tenantId)));
  res.json(formatRouteTemplate(updated, { divisionName: division?.name ?? null }));
});

router.delete("/route-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  await db.update(jobsTable).set({ routeTemplateId: null, sequenceOrder: null, offSeasonStart: null, offSeasonEnd: null }).where(and(eq(jobsTable.routeTemplateId, id), eq(jobsTable.tenantId, tenantId)));
  await db.delete(routeTemplatesTable).where(and(eq(routeTemplatesTable.id, id), eq(routeTemplatesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ── Routes Dashboard ─────────────────────────────────────────────────────────
// GET /routes/dashboard?weekStart=YYYY-MM-DD&divisionId= — one row per route
// template that runs during that week, with its jobs + capacity summary.
router.get("/routes/dashboard", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { weekStart, divisionId } = req.query as Record<string, string>;
  if (!weekStart) { res.status(400).json({ error: "weekStart is required (YYYY-MM-DD, a Sunday)" }); return; }

  const anchor = new Date("2024-01-07T00:00:00Z"); // arbitrary Sunday anchor for biweekly parity
  const weekStartDate = new Date(`${weekStart}T00:00:00Z`);

  let divWhere = eq(divisionsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (divisionId) divWhere = and(divWhere, eq(divisionsTable.id, parseInt(divisionId, 10))) as typeof divWhere;
  const divisions = await db.select().from(divisionsTable).where(divWhere).orderBy(divisionsTable.name);
  if (divisions.length === 0) { res.json([]); return; }

  const divisionIds = divisions.map(d => d.id);
  const templates = await db.select().from(routeTemplatesTable).where(and(eq(routeTemplatesTable.tenantId, tenantId), inArray(routeTemplatesTable.divisionId, divisionIds)));
  const divisionMap = new Map(divisions.map(d => [d.id, d]));

  const templateIds = templates.map(t => t.id);
  const weekEndDate = new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const jobs = templateIds.length > 0
    ? await db
        .select({ job: jobsTable, propertyAddress: propertiesTable.address, propertyLat: propertiesTable.lat, propertyLng: propertiesTable.lng, customerName: customersTable.name })
        .from(jobsTable)
        .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
        .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
        .where(
          and(
            eq(jobsTable.tenantId, tenantId),
            inArray(jobsTable.routeTemplateId, templateIds),
            sql`${jobsTable.scheduledAt} >= ${weekStartDate.toISOString()}::timestamptz`,
            sql`${jobsTable.scheduledAt} < ${weekEndDate.toISOString()}::timestamptz`,
          )
        )
    : [];

  const jobsByTemplate = new Map<number, typeof jobs>();
  for (const row of jobs) {
    const tid = row.job.routeTemplateId!;
    if (!jobsByTemplate.has(tid)) jobsByTemplate.set(tid, []);
    jobsByTemplate.get(tid)!.push(row);
  }

  const result = templates
    .filter(t => {
      const runDate = new Date(weekStartDate.getTime() + t.dayOfWeek * 24 * 60 * 60 * 1000);
      return frequencyMatchesWeek(t.frequency, runDate, anchor);
    })
    .map(t => {
      const division = divisionMap.get(t.divisionId)!;
      const runDateStr = new Date(weekStartDate.getTime() + t.dayOfWeek * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // Only count jobs actually scheduled on this route's concrete run date this week —
      // a job that was moved to a different day (e.g. a one-time reschedule) must not
      // inflate this template's capacity/stop count for a day it no longer occupies.
      const rows = (jobsByTemplate.get(t.id) ?? []).filter(r => r.job.scheduledAt.toISOString().slice(0, 10) === runDateStr);
      const stops: RouteStop[] = rows.map(r => ({
        jobId: r.job.id,
        lat: r.propertyLat,
        lng: r.propertyLng,
        durationMinutes: r.job.estimatedDuration ?? 0,
      }));
      const { totalDriveMinutes } = sequenceStops({ lat: division.depotLat, lng: division.depotLng }, stops);
      const budgetedJobMinutes = stops.reduce((s, x) => s + x.durationMinutes, 0);
      const capacity = computeCapacity(division.shiftHoursPerDay, budgetedJobMinutes, totalDriveMinutes);

      return {
        routeTemplateId: t.id,
        routeTemplateName: t.name,
        divisionId: division.id,
        divisionName: division.name,
        frequency: t.frequency,
        dayOfWeek: t.dayOfWeek,
        runDate: new Date(weekStartDate.getTime() + t.dayOfWeek * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        stopCount: rows.length,
        completedStops: rows.filter(r => r.job.status === 'completed').length,
        capacity,
      };
    });

  res.json(result);
});

// GET /routes/:id/day?date=YYYY-MM-DD — sequenced stop detail for one route/day
router.get("/routes/:id/day", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { date } = req.query as Record<string, string>;
  if (!date) { res.status(400).json({ error: "date is required (YYYY-MM-DD)" }); return; }

  const [rt] = await db.select().from(routeTemplatesTable).where(and(eq(routeTemplatesTable.id, id), eq(routeTemplatesTable.tenantId, tenantId)));
  if (!rt) { res.status(404).json({ error: "Route template not found" }); return; }
  const [division] = await db.select().from(divisionsTable).where(and(eq(divisionsTable.id, rt.divisionId), eq(divisionsTable.tenantId, tenantId)));
  if (!division) { res.status(404).json({ error: "Division not found" }); return; }

  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ job: jobsTable, propertyAddress: propertiesTable.address, propertyLat: propertiesTable.lat, propertyLng: propertiesTable.lng, customerName: customersTable.name, assigneeName: usersTable.name, crewName: crewsTable.name })
    .from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .where(
      and(
        eq(jobsTable.tenantId, tenantId),
        eq(jobsTable.routeTemplateId, id),
        sql`${jobsTable.scheduledAt} >= ${dayStart.toISOString()}::timestamptz`,
        sql`${jobsTable.scheduledAt} < ${dayEnd.toISOString()}::timestamptz`,
      )
    )
    .orderBy(jobsTable.sequenceOrder);

  const hasManualOrder = rows.every(r => r.job.sequenceOrder != null);
  const stops: RouteStop[] = rows.map(r => ({ jobId: r.job.id, lat: r.propertyLat, lng: r.propertyLng, durationMinutes: r.job.estimatedDuration ?? 0 }));

  const { sequenced } = hasManualOrder && stops.length > 0
    ? recomputeDriveTimesForOrder({ lat: division.depotLat, lng: division.depotLng }, [...stops].sort((a, b) => {
        const aOrder = rows.find(r => r.job.id === a.jobId)!.job.sequenceOrder!;
        const bOrder = rows.find(r => r.job.id === b.jobId)!.job.sequenceOrder!;
        return aOrder - bOrder;
      }))
    : sequenceStops({ lat: division.depotLat, lng: division.depotLng }, stops);

  // Sequencing remains deterministic and local; road durations are then resolved
  // for the resulting ordered legs without persisting any schedule changes.
  const depot = { lat: division.depotLat, lng: division.depotLng };
  const legOrigins = sequenced.map((stop, index) => index === 0
    ? depot
    : { lat: sequenced[index - 1].lat, lng: sequenced[index - 1].lng });
  const legDestinations = sequenced.map(stop => ({ lat: stop.lat, lng: stop.lng }));
  const driveLegs = await Promise.all(sequenced.map(async (stop, index) => {
    const origin = legOrigins[index];
    const destination = legDestinations[index];
    const estimatedMinutes = estimatedDriveMinutes(origin, destination);
    if (origin.lat == null || origin.lng == null || destination.lat == null || destination.lng == null) {
      return { minutes: estimatedMinutes, source: "estimated" as const };
    }
    const googleMinutes = await getGoogleDriveMinutes(
      { lat: origin.lat, lng: origin.lng },
      { lat: destination.lat, lng: destination.lng },
    );
    return googleMinutes == null
      ? { minutes: estimatedMinutes, source: "estimated" as const }
      : { minutes: googleMinutes, source: "google" as const };
  }));
  const returnOrigin = sequenced.length > 0 ? legDestinations[legDestinations.length - 1] : null;
  const returnLeg = returnOrigin && depot.lat != null && depot.lng != null && returnOrigin.lat != null && returnOrigin.lng != null
    ? await getGoogleDriveMinutes({ lat: returnOrigin.lat, lng: returnOrigin.lng }, { lat: depot.lat, lng: depot.lng })
    : null;
  const returnDriveMinutes = returnLeg ?? (returnOrigin ? estimatedDriveMinutes(returnOrigin, depot) : 0);
  const totalRoadDriveMinutes = driveLegs.reduce((total, leg) => total + leg.minutes, 0) + returnDriveMinutes;
  const allLegSources = [...driveLegs.map(leg => leg.source), ...(returnOrigin ? [returnLeg == null ? "estimated" : "google"] : [])];
  const timingSource = allLegSources.length > 0 && allLegSources.every(source => source === "google")
    ? "google"
    : allLegSources.some(source => source === "google") ? "mixed" : "estimated";
  const earliestScheduledAt = rows.reduce<Date | null>((earliest, row) => {
    const scheduledAt = row.job.scheduledAt;
    return !earliest || scheduledAt < earliest ? scheduledAt : earliest;
  }, null);
  const routeStartAnchor = earliestScheduledAt ?? new Date(`${date}T09:00:00`);
  let previousStart = routeStartAnchor;
  let previousDurationMinutes = 0;
  const estimatedStarts = driveLegs.map((leg, index) => {
    const start = new Date(previousStart.getTime() + (previousDurationMinutes + leg.minutes) * 60_000);
    previousStart = start;
    previousDurationMinutes = sequenced[index].durationMinutes;
    return start.toISOString();
  });

  const rowById = new Map(rows.map(r => [r.job.id, r]));
  const budgetedJobMinutes = stops.reduce((s, x) => s + x.durationMinutes, 0);
  const capacity = computeCapacity(division.shiftHoursPerDay, budgetedJobMinutes, totalRoadDriveMinutes);

  res.json({
    routeTemplateId: rt.id,
    routeTemplateName: rt.name,
    divisionId: division.id,
    divisionName: division.name,
    depotLabel: division.depotLabel,
    date,
    timingSource,
    capacity,
    stops: sequenced.map((s, index) => {
      const r = rowById.get(s.jobId)!;
      return {
        jobId: s.jobId,
        sequenceOrder: s.sequenceOrder,
        driveMinutesFromPrev: driveLegs[index].minutes,
        estimatedStartAt: estimatedStarts[index],
        driveTimeSource: driveLegs[index].source,
        title: r.job.title,
        customerName: r.customerName,
        propertyAddress: r.propertyAddress,
        assigneeName: r.assigneeName,
        crewName: r.crewName,
        estimatedDuration: r.job.estimatedDuration,
        status: r.job.status,
      };
    }),
  });
});

// POST /routes/:id/resequence — auto-resequence (nearest-neighbor) or apply a manual order
// Body: { date, jobOrder?: number[] } — if jobOrder given, use that exact order; else auto-optimize.
router.post("/routes/:id/resequence", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { date, jobOrder } = req.body;
  if (!date) { res.status(400).json({ error: "date is required" }); return; }

  const [rt] = await db.select().from(routeTemplatesTable).where(and(eq(routeTemplatesTable.id, id), eq(routeTemplatesTable.tenantId, tenantId)));
  if (!rt) { res.status(404).json({ error: "Route template not found" }); return; }
  const [division] = await db.select().from(divisionsTable).where(and(eq(divisionsTable.id, rt.divisionId), eq(divisionsTable.tenantId, tenantId)));
  if (!division) { res.status(404).json({ error: "Division not found" }); return; }

  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ job: jobsTable, propertyLat: propertiesTable.lat, propertyLng: propertiesTable.lng })
    .from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(
      and(
        eq(jobsTable.tenantId, tenantId),
        eq(jobsTable.routeTemplateId, id),
        sql`${jobsTable.scheduledAt} >= ${dayStart.toISOString()}::timestamptz`,
        sql`${jobsTable.scheduledAt} < ${dayEnd.toISOString()}::timestamptz`,
      )
    );

  const stopsByJobId = new Map<number, RouteStop>(rows.map(r => [r.job.id, { jobId: r.job.id, lat: r.propertyLat, lng: r.propertyLng, durationMinutes: r.job.estimatedDuration ?? 0 }]));

  let sequenced;
  if (Array.isArray(jobOrder) && jobOrder.length > 0) {
    const ordered = jobOrder.map((jid: number) => stopsByJobId.get(jid)).filter((s): s is RouteStop => !!s);
    sequenced = recomputeDriveTimesForOrder({ lat: division.depotLat, lng: division.depotLng }, ordered).sequenced;
  } else {
    sequenced = sequenceStops({ lat: division.depotLat, lng: division.depotLng }, [...stopsByJobId.values()]).sequenced;
  }

  await Promise.all(sequenced.map(s =>
    db.update(jobsTable).set({ sequenceOrder: s.sequenceOrder }).where(and(eq(jobsTable.id, s.jobId), eq(jobsTable.tenantId, tenantId)))
  ));

  res.json({ ok: true, stopCount: sequenced.length });
});

// PATCH /jobs/:id/route — assign/reassign a job to a route template + date
router.patch("/jobs/:id/route", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { routeTemplateId, scheduledAt } = req.body;

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const updates: Partial<typeof jobsTable.$inferInsert> = { sequenceOrder: null };
  if (routeTemplateId !== undefined) {
    if (routeTemplateId != null) {
      const targetTemplateId = parseInt(routeTemplateId, 10);
      const [targetTemplate] = await db.select({ id: routeTemplatesTable.id, offSeasonStart: routeTemplatesTable.offSeasonStart, offSeasonEnd: routeTemplatesTable.offSeasonEnd }).from(routeTemplatesTable).where(and(eq(routeTemplatesTable.id, targetTemplateId), eq(routeTemplatesTable.tenantId, tenantId)));
      if (!targetTemplate) { res.status(404).json({ error: "Route template not found" }); return; }
      updates.routeTemplateId = targetTemplateId;
      updates.offSeasonStart = targetTemplate.offSeasonStart;
      updates.offSeasonEnd = targetTemplate.offSeasonEnd;
    } else {
      updates.routeTemplateId = null;
      updates.offSeasonStart = null;
      updates.offSeasonEnd = null;
    }
  }
  if (scheduledAt !== undefined) updates.scheduledAt = new Date(scheduledAt);

  const [updated] = await db.update(jobsTable).set(updates).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).returning();
  res.json({ id: updated.id, routeTemplateId: updated.routeTemplateId, sequenceOrder: updated.sequenceOrder, scheduledAt: updated.scheduledAt.toISOString() });
});

// POST /jobs/:id/reschedule-once — move a single occurrence to a new date without
// touching its recurring series, and append the route exception trip-charge fee
// to the job's line items so it flows into whatever invoice gets generated for it.
router.post("/jobs/:id/reschedule-once", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const { newScheduledAt } = req.body;
  if (!newScheduledAt) { res.status(400).json({ error: "newScheduledAt is required" }); return; }

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.isOneTimeReschedule) {
    res.status(409).json({ error: "This job has already been rescheduled once off its regular route. Move it back onto its route before rescheduling it again." });
    return;
  }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  let fee = tenant?.routeExceptionFee ?? 0;
  if (job.routeTemplateId) {
    const [rt] = await db.select({ exceptionFeeOverride: routeTemplatesTable.exceptionFeeOverride }).from(routeTemplatesTable).where(and(eq(routeTemplatesTable.id, job.routeTemplateId), eq(routeTemplatesTable.tenantId, tenantId)));
    if (rt?.exceptionFeeOverride != null) fee = rt.exceptionFeeOverride;
  }

  const existingLineItems = (job.lineItems as { id: number; name: string; quantity: number; unitPrice: number; total: number }[]) ?? [];
  const nextLineItemId = existingLineItems.length > 0 ? Math.max(...existingLineItems.map(li => li.id)) + 1 : 1;
  const updatedLineItems = fee > 0
    ? [...existingLineItems, { id: nextLineItemId, name: "Route exception trip charge", quantity: 1, unitPrice: fee, total: fee }]
    : existingLineItems;
  const feeTotal = fee > 0 ? fee : 0;

  const [updated] = await db.update(jobsTable).set({
    scheduledAt: new Date(newScheduledAt),
    originalScheduledDate: job.originalScheduledDate ?? job.scheduledAt,
    isOneTimeReschedule: 1,
    lineItems: updatedLineItems,
    totalAmount: sql`${jobsTable.totalAmount} + ${feeTotal}`,
    sequenceOrder: null,
  }).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).returning();

  await db.insert(activityLogTable).values({
    tenantId,
    userId,
    type: "job_rescheduled_once",
    message: `Job "${job.title}" rescheduled to ${new Date(newScheduledAt).toLocaleDateString()}${fee > 0 ? ` with a $${fee} trip charge` : ""}`,
    entityId: job.id,
  });

  res.json({
    id: updated.id,
    scheduledAt: updated.scheduledAt.toISOString(),
    originalScheduledDate: updated.originalScheduledDate?.toISOString() ?? null,
    isOneTimeReschedule: !!updated.isOneTimeReschedule,
    lineItems: updated.lineItems,
    totalAmount: updated.totalAmount,
    exceptionFeeCharged: feeTotal,
  });
});

export default router;
