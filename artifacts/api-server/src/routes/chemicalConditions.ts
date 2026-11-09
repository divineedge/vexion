import { Router } from "express";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, jobsTable, propertiesTable, servicesTable, tenantsTable } from "@workspace/db";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { fetchCurrentConditions } from "../lib/currentWeather";
import { checkRainBeforeWindow } from "../lib/weatherCheck";
import { logger } from "../lib/logger";

const router = Router();
router.use(["/jobs/:id/chemical-conditions", "/schedule/rain-risk"], requireVerifiedStaff);

router.get("/jobs/:id/chemical-conditions", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const jobId = Number(req.params.id);
  const [row] = await db.select({
    lat: propertiesTable.lat,
    lng: propertiesTable.lng,
    geofenceLat: propertiesTable.geofenceLat,
    geofenceLng: propertiesTable.geofenceLng,
    serviceableAreaSqft: propertiesTable.serviceableAreaSqft,
    size: propertiesTable.size,
    sizeUnit: propertiesTable.sizeUnit,
  }).from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  if (!row) { res.status(404).json({ error: "Job not found" }); return; }
  const lat = row.lat ?? row.geofenceLat;
  const lng = row.lng ?? row.geofenceLng;
  let weather = null;
  if (lat != null && lng != null) {
    try { weather = await fetchCurrentConditions(lat, lng); }
    catch (error) { logger.warn({ err: error, jobId }, "Current weather was not available"); }
  }
  const treatedAreaSqft = row.serviceableAreaSqft ?? (row.sizeUnit === "acres" && row.size ? row.size * 43560 : row.size ?? null);
  res.json({ weather, treatedAreaSqft, areaUnit: "sqft" });
});

router.get("/schedule/rain-risk", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "Choose a calendar date" }); return; }
  const [tenant] = await db.select({ rainfastRainThresholdPct: tenantsTable.rainfastRainThresholdPct }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const threshold = tenant?.rainfastRainThresholdPct ?? 50;
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start.getTime() + 86400000);
  const jobs = await db.select({
    id: jobsTable.id,
    title: jobsTable.title,
    scheduledAt: jobsTable.scheduledAt,
    lat: propertiesTable.lat,
    lng: propertiesTable.lng,
    address: propertiesTable.address,
  }).from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(servicesTable, eq(jobsTable.serviceId, servicesTable.id))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      gte(jobsTable.scheduledAt, start),
      lt(jobsTable.scheduledAt, end),
      sql`${jobsTable.status} in ('scheduled','in_progress')`,
      sql`(
        coalesce(${servicesTable.fieldRequirements}->>'requiresChemicalApplication','') = 'true'
        OR exists (select 1 from chemical_applications ca where ca.job_id = ${jobsTable.id} and ca.tenant_id = ${tenantId})
      )`,
    ));
  const flagged = [];
  for (const job of jobs) {
    if (job.lat == null || job.lng == null) continue;
    const forecast = await checkRainBeforeWindow(job.lat, job.lng, end, threshold);
    if (!forecast) continue;
    flagged.push({ id: job.id, title: job.title, address: job.address, scheduledAt: job.scheduledAt?.toISOString() ?? null, probability: forecast.probability, forecastTime: forecast.forecastTime });
  }
  res.json({ date, threshold, count: flagged.length, jobs: flagged });
});

router.post("/schedule/rain-risk/reschedule", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const toDate = String(req.body?.toDate ?? "");
  const jobIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds.filter((id: unknown) => Number.isInteger(id) && id > 0) : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate) || jobIds.length === 0 || jobIds.length > 100) {
    res.status(400).json({ error: "Choose a date and the jobs to move" });
    return;
  }
  const moved: number[] = [];
  for (const id of jobIds) {
    const [job] = await db.select({ scheduledAt: jobsTable.scheduledAt }).from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
    if (!job?.scheduledAt) continue;
    const next = new Date(job.scheduledAt);
    const [year, month, day] = toDate.split("-").map(Number);
    next.setUTCFullYear(year, month - 1, day);
    const [updated] = await db.update(jobsTable).set({ scheduledAt: next }).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).returning({ id: jobsTable.id });
    if (updated) moved.push(updated.id);
  }
  res.json({ moved });
});

export default router;
