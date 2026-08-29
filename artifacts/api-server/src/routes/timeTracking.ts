import { Router, type IRouter } from "express";
import { db, timeEntriesTable, subTimersTable, geofenceEntriesTable, usersTable, taskBundleCompletionsTable, taskBundlesTable, jobsTable, visitsTable, customersTable, propertiesTable, crewMembersTable, tenantsTable } from "@workspace/db";
import { eq, and, sql, gte, lte, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ADMIN_ROLES, getCallerRole } from "../lib/roles";
import { GEOFENCE_ENTRY_DEBOUNCE_MS, hasExactlyOneWorkLink, haversineMeters, isAssignedToWork, isDuplicateGeofenceEntry, isInsideGeofence, isWithinScheduleDay } from "../lib/geofence";
import { requireVerifiedStaff, verifiedStaffIdentity } from "../lib/verifiedStaff";

const router: IRouter = Router();

export function localDayBounds(value: unknown): { start: Date; end: Date } | null {
  if (value == null || value === "") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return null;
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return null;
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function zonedDayBounds(value: unknown, timeZone: string): { start: Date; end: Date } | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { return null; }
  const [year, month, day] = value.split("-").map(Number);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return null;
  const midnight = (y: number, m: number, d: number) => {
    const guess = Date.UTC(y, m - 1, d);
    const offset = (instant: number) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
      const values = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
      return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - instant;
    };
    let instant = guess - offset(guess);
    instant = guess - offset(instant);
    return new Date(instant);
  };
  const start = midnight(year, month, day);
  const check = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  if (!check.includes(String(year))) return null;
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { start, end: midnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
}

function zonedTodayKey(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

router.post("/time-tracking/geofence-entry", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const { propertyId, jobId, visitId, lat, lng } = req.body ?? {};
  const parsedPropertyId = Number(propertyId);
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!Number.isInteger(parsedPropertyId) || parsedPropertyId <= 0 || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)
    || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
    res.status(400).json({ error: "propertyId, lat, and lng must be valid coordinates" });
    return;
  }
  const [property] = await db.select({
    id: propertiesTable.id, geofenceLat: propertiesTable.geofenceLat, geofenceLng: propertiesTable.geofenceLng, geofenceRadius: propertiesTable.geofenceRadius,
  }).from(propertiesTable).where(and(eq(propertiesTable.id, parsedPropertyId), eq(propertiesTable.tenantId, tenantId)));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }
  if (property.geofenceLat == null || property.geofenceLng == null || property.geofenceRadius == null || property.geofenceRadius <= 0) {
    res.status(400).json({ error: "Property does not have a configured geofence" }); return;
  }

  const parsedJobId = jobId == null ? null : Number(jobId);
  const parsedVisitId = visitId == null ? null : Number(visitId);
  if ((parsedJobId != null && (!Number.isInteger(parsedJobId) || parsedJobId <= 0))
    || (parsedVisitId != null && (!Number.isInteger(parsedVisitId) || parsedVisitId <= 0))) {
    res.status(400).json({ error: "jobId and visitId must be valid integers" }); return;
  }
  if (!hasExactlyOneWorkLink(parsedJobId, parsedVisitId)) {
    res.status(400).json({ error: "Provide exactly one of jobId or visitId" }); return;
  }
  const now = new Date();
  const [tenant] = await db.select({ timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const geofenceBounds = zonedDayBounds(zonedTodayKey(tenant?.timezone ?? "UTC"), tenant?.timezone ?? "UTC");
  if (!geofenceBounds) { res.status(500).json({ error: "Tenant timezone is invalid" }); return; }
  if (parsedJobId != null) {
    const [job] = await db.select({
      propertyId: jobsTable.propertyId, assigneeId: jobsTable.assigneeId, crewId: jobsTable.crewId, scheduledAt: jobsTable.scheduledAt,
    }).from(jobsTable)
      .where(and(eq(jobsTable.id, parsedJobId), eq(jobsTable.tenantId, tenantId)));
    if (!job || job.propertyId !== parsedPropertyId) { res.status(400).json({ error: "Job does not belong to this property" }); return; }
    if (job.scheduledAt < geofenceBounds.start || job.scheduledAt >= geofenceBounds.end) { res.status(403).json({ error: "Job is not scheduled for today" }); return; }
    const [crewMembership] = job.crewId == null ? [] : await db.select({ id: crewMembersTable.id }).from(crewMembersTable).where(and(
      eq(crewMembersTable.tenantId, tenantId), eq(crewMembersTable.crewId, job.crewId), eq(crewMembersTable.userId, userId),
    )).limit(1);
    if (!isAssignedToWork(job.assigneeId, !!crewMembership, userId)) { res.status(403).json({ error: "You are not assigned to this job" }); return; }
  }
  if (parsedVisitId != null) {
    const [visit] = await db.select({
      propertyId: visitsTable.propertyId, assigneeId: visitsTable.assigneeId, scheduledAt: visitsTable.scheduledAt,
    }).from(visitsTable)
      .where(and(eq(visitsTable.id, parsedVisitId), eq(visitsTable.tenantId, tenantId)));
    if (!visit || visit.propertyId !== parsedPropertyId) { res.status(400).json({ error: "Visit does not belong to this property" }); return; }
    if (!visit.scheduledAt || visit.scheduledAt < geofenceBounds.start || visit.scheduledAt >= geofenceBounds.end) { res.status(403).json({ error: "Visit is not scheduled for today" }); return; }
    if (!isAssignedToWork(visit.assigneeId, false, userId)) { res.status(403).json({ error: "You are not assigned to this visit" }); return; }
  }

  const distanceMeters = haversineMeters(parsedLat, parsedLng, property.geofenceLat, property.geofenceLng);
  if (!isInsideGeofence(distanceMeters, property.geofenceRadius)) {
    res.status(422).json({ error: "Coordinates are outside this property's geofence", distanceMeters, radiusMeters: property.geofenceRadius });
    return;
  }

  const cutoff = new Date(Date.now() - GEOFENCE_ENTRY_DEBOUNCE_MS);
  const result = await db.transaction(async tx => {
    // Serialize reports for this tenant/user/property. A time-window cannot be expressed as a useful
    // PostgreSQL unique index, so this advisory transaction lock prevents concurrent duplicate arrivals.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${userId * 1_000_000 + parsedPropertyId})`);
    const [recent] = await tx.select().from(geofenceEntriesTable).where(and(
      eq(geofenceEntriesTable.tenantId, tenantId), eq(geofenceEntriesTable.userId, userId),
      eq(geofenceEntriesTable.propertyId, parsedPropertyId), gte(geofenceEntriesTable.enteredAt, cutoff),
    )).orderBy(desc(geofenceEntriesTable.enteredAt)).limit(1);
    if (isDuplicateGeofenceEntry(recent?.enteredAt ?? null, new Date())) return { entry: recent!, deduplicated: true };
    const [entry] = await tx.insert(geofenceEntriesTable).values({
      tenantId, userId, propertyId: parsedPropertyId, jobId: parsedJobId, visitId: parsedVisitId,
      lat: parsedLat, lng: parsedLng, distanceMeters, enteredAt: new Date(),
    }).returning();
    return { entry, deduplicated: false };
  });
  res.status(result.deduplicated ? 200 : 201).json({ ...result.entry, enteredAt: result.entry.enteredAt.toISOString(), deduplicated: result.deduplicated });
});

router.get("/time-tracking/geofence-entries", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId: callerId } = verifiedStaffIdentity(res);
  const requestedUserId = typeof req.query.userId === "string" ? Number(req.query.userId) : undefined;
  let targetUserId = callerId;
  if (requestedUserId != null) {
    if (!Number.isInteger(requestedUserId) || requestedUserId <= 0) { res.status(400).json({ error: "userId must be a valid integer" }); return; }
    const role = await getCallerRole(tenantId, callerId);
    if (!ADMIN_ROLES.has(role)) { res.status(403).json({ error: "Admin or office role required to view other users" }); return; }
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.id, requestedUserId), eq(usersTable.tenantId, tenantId)));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    targetUserId = requestedUserId;
  }
  const rows = await db.select().from(geofenceEntriesTable).where(and(
    eq(geofenceEntriesTable.tenantId, tenantId), eq(geofenceEntriesTable.userId, targetUserId),
  )).orderBy(desc(geofenceEntriesTable.enteredAt)).limit(200);
  res.json(rows.map(entry => ({ ...entry, enteredAt: entry.enteredAt.toISOString() })));
});

router.get("/time-tracking/master-clock", requireVerifiedStaff, async (_req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);

  const [active] = await db.select().from(timeEntriesTable).where(and(
    eq(timeEntriesTable.userId, userId),
    eq(timeEntriesTable.tenantId, tenantId),
    eq(timeEntriesTable.isMasterClock, true),
    sql`clocked_out_at IS NULL`
  ));

  const today = new Date(); today.setHours(0,0,0,0);
  const [todayTotal] = await db
    .select({ total: sql<number>`COALESCE(sum(total_minutes),0)::int` })
    .from(timeEntriesTable)
    .where(and(
      eq(timeEntriesTable.userId, userId),
      eq(timeEntriesTable.tenantId, tenantId),
      eq(timeEntriesTable.isMasterClock, true),
      sql`clocked_in_at >= ${today}`
    ));

  res.json({
    userId,
    isClockedIn: !!active,
    clockedInAt: active?.clockedInAt?.toISOString() ?? null,
    totalMinutesToday: todayTotal?.total ?? 0,
    entryId: active?.id ?? null,
  });
});

router.post("/time-tracking/master-clock/start", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const { lat, lng } = req.body ?? {};

  const entry = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${userId})`);
    const [active] = await tx.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.userId, userId), eq(timeEntriesTable.tenantId, tenantId), eq(timeEntriesTable.isMasterClock, true), sql`clocked_out_at IS NULL`)).for("update");
    if (active) return active;
    const [created] = await tx.insert(timeEntriesTable).values({ tenantId, userId, clockedInAt: new Date(), isMasterClock: true, clockInLat: lat != null ? Number(lat) : null, clockInLng: lng != null ? Number(lng) : null }).returning();
    return created;
  });

  res.json({ userId, isClockedIn: true, clockedInAt: entry.clockedInAt.toISOString(), totalMinutesToday: 0, entryId: entry.id });
});

router.post("/time-tracking/master-clock/stop", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const { lat, lng } = req.body ?? {};

  const stopped = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${userId})`);
    const [active] = await tx.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.userId, userId), eq(timeEntriesTable.tenantId, tenantId), eq(timeEntriesTable.isMasterClock, true), sql`clocked_out_at IS NULL`)).for("update");
    if (!active) return null;
    const now = new Date(); const totalMinutes = Math.floor((now.getTime() - active.clockedInAt.getTime()) / 60000);
    await tx.update(timeEntriesTable).set({ clockedOutAt: now, totalMinutes, clockOutLat: lat != null ? Number(lat) : null, clockOutLng: lng != null ? Number(lng) : null }).where(eq(timeEntriesTable.id, active.id));
    return totalMinutes;
  });
  if (stopped == null) { res.status(400).json({ error: "Not clocked in" }); return; }

  res.json({ userId, isClockedIn: false, clockedInAt: null, totalMinutesToday: stopped, entryId: null });
});

router.get("/time-tracking/sub-timers", requireVerifiedStaff, async (_req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);

  const timers = await db.select().from(subTimersTable).where(and(
    eq(subTimersTable.userId, userId),
    eq(subTimersTable.tenantId, tenantId),
    eq(subTimersTable.isActive, true)
  ));

  res.json(timers.map(t => ({
    ...t,
    startedAt: t.startedAt.toISOString(),
    stoppedAt: t.stoppedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  })));
});

router.post("/time-tracking/sub-timers", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const { label, type, jobId, lat, lng } = req.body;

  if (!label || !type) { res.status(400).json({ error: "label and type required" }); return; }

  // Detect late arrival: compare now vs job's scheduledAt (5-min grace period)
  let isLateArrival = false;
  let lateByMinutes: number | null = null;
  const jobIdNum = jobId == null ? null : Number(jobId);
  if (jobIdNum != null && (!Number.isInteger(jobIdNum) || jobIdNum <= 0)) {
    res.status(400).json({ error: "jobId must be a valid integer" });
    return;
  }
  if (jobIdNum != null) {
    const [job] = await db
      .select({ scheduledAt: jobsTable.scheduledAt, assigneeId: jobsTable.assigneeId, crewId: jobsTable.crewId })
      .from(jobsTable)
      .where(and(eq(jobsTable.id, jobIdNum), eq(jobsTable.tenantId, tenantId)));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    const role = await getCallerRole(tenantId, userId);
    const [crewMembership] = job.crewId == null ? [] : await db.select({ id: crewMembersTable.id }).from(crewMembersTable).where(and(
      eq(crewMembersTable.tenantId, tenantId), eq(crewMembersTable.crewId, job.crewId), eq(crewMembersTable.userId, userId),
    )).limit(1);
    if (!ADMIN_ROLES.has(role) && !isAssignedToWork(job.assigneeId, !!crewMembership, userId)) {
      res.status(403).json({ error: "You are not assigned to this job" });
      return;
    }
    if (job.scheduledAt) {
      const diffMin = Math.floor((Date.now() - job.scheduledAt.getTime()) / 60000);
      if (diffMin > 5) {
        isLateArrival = true;
        lateByMinutes = diffMin;
      }
    }
  }

  // Atomically stop any active timers and start the new one
  const timer = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}, ${userId})`);
    const activeTimers = await tx
      .select()
      .from(subTimersTable)
      .where(and(
        eq(subTimersTable.tenantId, tenantId),
        eq(subTimersTable.userId, userId),
        eq(subTimersTable.isActive, true),
      ))
      .for("update"); // row-level lock prevents concurrent start races

    const now = new Date();
    for (const active of activeTimers) {
      const elapsed = Math.floor((now.getTime() - active.startedAt.getTime()) / 1000);
      await tx.update(subTimersTable)
        .set({ stoppedAt: now, elapsedSeconds: elapsed, isActive: false })
        .where(eq(subTimersTable.id, active.id));
    }

    const [newTimer] = await tx.insert(subTimersTable).values({
      tenantId,
      userId,
      label,
      type,
      jobId: jobIdNum,
      startLat: lat != null ? Number(lat) : null,
      startLng: lng != null ? Number(lng) : null,
      isLateArrival,
      lateByMinutes,
    }).returning();

    return newTimer;
  });

  res.status(201).json({
    ...timer,
    startedAt: timer.startedAt.toISOString(),
    stoppedAt: null,
    adjustedStartedAt: null,
    adjustedStoppedAt: null,
    jobScheduledAt: null,
    createdAt: timer.createdAt.toISOString(),
  });
});

router.post("/time-tracking/sub-timers/:id/stop", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const { lat, lng } = req.body ?? {};

  const [timer] = await db.select().from(subTimersTable).where(and(
    eq(subTimersTable.id, id), eq(subTimersTable.tenantId, tenantId), eq(subTimersTable.userId, userId),
  ));
  if (!timer) { res.status(404).json({ error: "Not found" }); return; }

  const now = new Date();
  const elapsed = Math.floor((now.getTime() - timer.startedAt.getTime()) / 1000);

  const [updated] = await db.update(subTimersTable).set({
    stoppedAt: now,
    elapsedSeconds: elapsed,
    isActive: false,
    endLat: lat != null ? Number(lat) : null,
    endLng: lng != null ? Number(lng) : null,
  }).where(and(
    eq(subTimersTable.id, id), eq(subTimersTable.tenantId, tenantId),
    eq(subTimersTable.userId, userId), eq(subTimersTable.isActive, true),
  )).returning();
  if (!updated) { res.status(409).json({ error: "Timer is already stopped" }); return; }

  // When a late-arrival job timer is stopped, fetch the job's scheduledAt so the
  // field app can show the confirmation/adjustment dialog.
  let jobScheduledAt: string | null = null;
  if (updated.isLateArrival && updated.jobId) {
    const [job] = await db.select({ scheduledAt: jobsTable.scheduledAt }).from(jobsTable).where(and(
      eq(jobsTable.id, updated.jobId), eq(jobsTable.tenantId, tenantId),
    ));
    jobScheduledAt = job?.scheduledAt?.toISOString() ?? null;
  }

  res.json({
    ...updated,
    startedAt: updated.startedAt.toISOString(),
    stoppedAt: updated.stoppedAt?.toISOString() ?? null,
    adjustedStartedAt: updated.adjustedStartedAt?.toISOString() ?? null,
    adjustedStoppedAt: updated.adjustedStoppedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    jobScheduledAt,
  });
});

router.patch("/time-tracking/sub-timers/:id/adjust", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const { adjustedStartedAt, adjustedStoppedAt } = req.body ?? {};

  const [timer] = await db.select().from(subTimersTable).where(and(
    eq(subTimersTable.id, id),
    eq(subTimersTable.tenantId, tenantId),
    eq(subTimersTable.userId, userId),
  ));
  if (!timer) { res.status(404).json({ error: "Not found" }); return; }

  const parseIso = (value: unknown): Date | null => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
    const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date;
  };
  const adjustedStart = adjustedStartedAt == null ? null : parseIso(adjustedStartedAt);
  const adjustedEnd = adjustedStoppedAt == null ? null : parseIso(adjustedStoppedAt);
  if ((adjustedStartedAt != null && !adjustedStart) || (adjustedStoppedAt != null && !adjustedEnd)) { res.status(400).json({ error: "Adjustment times must be valid ISO dates" }); return; }
  const effectiveStart = adjustedStart ?? timer.adjustedStartedAt ?? timer.startedAt;
  const effectiveEnd = adjustedEnd ?? timer.adjustedStoppedAt ?? timer.stoppedAt;
  const now = new Date();
  if ((effectiveEnd && effectiveEnd < effectiveStart) || effectiveStart > now || (effectiveEnd && effectiveEnd > now)) { res.status(400).json({ error: "Adjustment times must not be future or end before start" }); return; }
  if (effectiveStart.toISOString().slice(0, 10) !== (effectiveEnd ?? effectiveStart).toISOString().slice(0, 10)) { res.status(400).json({ error: "Adjustments must remain within one work day" }); return; }
  const updates: Partial<typeof subTimersTable.$inferInsert> = {};
  if (adjustedStart) updates.adjustedStartedAt = adjustedStart;
  if (adjustedEnd) updates.adjustedStoppedAt = adjustedEnd;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No adjustment values provided" });
    return;
  }

  const [updated] = await db.update(subTimersTable).set(updates).where(eq(subTimersTable.id, id)).returning();
  res.json({
    ...updated,
    startedAt: updated.startedAt.toISOString(),
    stoppedAt: updated.stoppedAt?.toISOString() ?? null,
    adjustedStartedAt: updated.adjustedStartedAt?.toISOString() ?? null,
    adjustedStoppedAt: updated.adjustedStoppedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    jobScheduledAt: null,
  });
});

router.get("/time-tracking/entries", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const { date } = req.query as Record<string, string>;

  let where = and(eq(timeEntriesTable.tenantId, tenantId), eq(timeEntriesTable.userId, userId)) as ReturnType<typeof and>;
  if (date) {
    const d = new Date(date);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    where = and(where, sql`clocked_in_at >= ${d} AND clocked_in_at < ${next}`) as typeof where;
  }

  const rows = await db
    .select({ entry: timeEntriesTable, userName: usersTable.name })
    .from(timeEntriesTable)
    .leftJoin(usersTable, eq(timeEntriesTable.userId, usersTable.id))
    .where(where)
    .orderBy(sql`${timeEntriesTable.clockedInAt} DESC`);

  res.json(rows.map(r => ({
    id: r.entry.id,
    userId: r.entry.userId,
    userName: r.userName ?? null,
    clockedInAt: r.entry.clockedInAt.toISOString(),
    clockedOutAt: r.entry.clockedOutAt?.toISOString() ?? null,
    totalMinutes: r.entry.totalMinutes,
  })));
});

/**
 * GET /time-tracking/today-schedule
 * Returns today's jobs + visits for the calling user, sorted by scheduledAt,
 * with an activeTimerId field indicating whether there's an active sub-timer.
 */
router.get("/time-tracking/today-schedule", requireVerifiedStaff, async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const role = await getCallerRole(tenantId, userId);
  const isAdmin = ADMIN_ROLES.has(role);

  const [tenant] = await db.select({ timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const timezone = tenant?.timezone ?? "UTC";
  const bounds = zonedDayBounds(req.query.date ?? zonedTodayKey(timezone), timezone);
  if (!bounds) { res.status(400).json({ error: "date must be a valid YYYY-MM-DD local date" }); return; }

  // Fetch active sub-timers for the user
  const activeTimers = await db
    .select()
    .from(subTimersTable)
    .where(and(
      eq(subTimersTable.tenantId, tenantId),
      eq(subTimersTable.userId, userId),
      eq(subTimersTable.isActive, true),
    ));

  // Fetch today's jobs
  const jobWhere = and(
    eq(jobsTable.tenantId, tenantId),
    gte(jobsTable.scheduledAt, bounds.start),
    sql`${jobsTable.scheduledAt} < ${bounds.end}`,
    ...(isAdmin ? [] : [sql`(
      ${jobsTable.assigneeId} = ${userId}
      OR EXISTS (
        SELECT 1 FROM ${crewMembersTable}
        WHERE ${crewMembersTable.tenantId} = ${tenantId}
          AND ${crewMembersTable.crewId} = ${jobsTable.crewId}
          AND ${crewMembersTable.userId} = ${userId}
      )
    )`]),
  )!;

  const jobRows = await db
    .select({
      id: jobsTable.id,
      title: jobsTable.title,
      status: jobsTable.status,
      scheduledAt: jobsTable.scheduledAt,
      customerName: customersTable.name,
      propertyAddress: propertiesTable.address,
      propertyId: propertiesTable.id,
      propertyLat: propertiesTable.lat,
      propertyLng: propertiesTable.lng,
      propertyGeofenceLat: propertiesTable.geofenceLat,
      propertyGeofenceLng: propertiesTable.geofenceLng,
      propertyGeofenceRadius: propertiesTable.geofenceRadius,
      routeTemplateId: jobsTable.routeTemplateId,
      sequenceOrder: jobsTable.sequenceOrder,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(jobWhere)
    .orderBy(
      sql`CASE WHEN ${jobsTable.sequenceOrder} IS NULL THEN 1 ELSE 0 END`,
      jobsTable.routeTemplateId,
      jobsTable.sequenceOrder,
      jobsTable.scheduledAt,
    );

  // Fetch today's visits
  const visitWhere = and(
    eq(visitsTable.tenantId, tenantId),
    gte(visitsTable.scheduledAt, bounds.start),
    sql`${visitsTable.scheduledAt} < ${bounds.end}`,
    ...(isAdmin ? [] : [eq(visitsTable.assigneeId, userId)]),
  )!;

  const visitRows = await db
    .select({
      id: visitsTable.id,
      purpose: visitsTable.purpose,
      visitMode: visitsTable.visitMode,
      completedAt: visitsTable.completedAt,
      scheduledAt: visitsTable.scheduledAt,
      customerName: customersTable.name,
      propertyAddress: propertiesTable.address,
      propertyId: propertiesTable.id,
      propertyLat: propertiesTable.lat,
      propertyLng: propertiesTable.lng,
      propertyGeofenceLat: propertiesTable.geofenceLat,
      propertyGeofenceLng: propertiesTable.geofenceLng,
      propertyGeofenceRadius: propertiesTable.geofenceRadius,
    })
    .from(visitsTable)
    .leftJoin(customersTable, eq(visitsTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(visitsTable.propertyId, propertiesTable.id))
    .where(visitWhere)
    .orderBy(visitsTable.scheduledAt);

  // Build schedule items
  const scheduleItems: object[] = [];

  for (const j of jobRows) {
    const timer = activeTimers.find(t => t.jobId === j.id);
    const elapsed = timer
      ? Math.floor((Date.now() - timer.startedAt.getTime()) / 1000)
      : 0;
    scheduleItems.push({
      kind: "job",
      id: j.id,
      label: j.title,
      scheduledAt: j.scheduledAt.toISOString(),
      customerName: j.customerName ?? null,
      propertyAddress: j.propertyAddress ?? null,
      propertyId: j.propertyId ?? null,
      status: j.status,
      activeTimerId: timer?.id ?? null,
      activeTimerStartedAt: timer?.startedAt.toISOString() ?? null,
      elapsedSeconds: elapsed,
      propertyLat: j.propertyLat ?? null,
      propertyLng: j.propertyLng ?? null,
      propertyGeofenceLat: j.propertyGeofenceLat ?? null,
      propertyGeofenceLng: j.propertyGeofenceLng ?? null,
      propertyGeofenceRadius: j.propertyGeofenceRadius ?? null,
      routeTemplateId: j.routeTemplateId ?? null,
      sequenceOrder: j.sequenceOrder ?? null,
    });
  }

  for (const v of visitRows) {
    const timerLabel = `visit:${v.id}:`;
    const timer = activeTimers.find(t => t.label.startsWith(timerLabel));
    const elapsed = timer
      ? Math.floor((Date.now() - timer.startedAt.getTime()) / 1000)
      : 0;
    // Derive a display status: completed if completedAt is set, otherwise use visitMode
    const visitStatus = v.completedAt ? "completed" : (v.visitMode ?? "scheduled");
    scheduleItems.push({
      kind: "visit",
      id: v.id,
      label: v.purpose,
      scheduledAt: v.scheduledAt?.toISOString() ?? null,
      customerName: v.customerName ?? null,
      propertyAddress: v.propertyAddress ?? null,
      propertyId: v.propertyId ?? null,
      status: visitStatus,
      activeTimerId: timer?.id ?? null,
      activeTimerStartedAt: timer?.startedAt.toISOString() ?? null,
      elapsedSeconds: elapsed,
      propertyLat: v.propertyLat ?? null,
      propertyLng: v.propertyLng ?? null,
      propertyGeofenceLat: v.propertyGeofenceLat ?? null,
      propertyGeofenceLng: v.propertyGeofenceLng ?? null,
      propertyGeofenceRadius: v.propertyGeofenceRadius ?? null,
    });
  }

  // Preserve explicit job route order. Unrouted work and visits then follow scheduled time.
  scheduleItems.sort((a: any, b: any) => {
    const aRouted = a.kind === "job" && a.sequenceOrder != null;
    const bRouted = b.kind === "job" && b.sequenceOrder != null;
    if (aRouted !== bRouted) return aRouted ? -1 : 1;
    if (aRouted && bRouted) {
      const route = (a.routeTemplateId ?? 0) - (b.routeTemplateId ?? 0);
      if (route) return route;
      const sequence = a.sequenceOrder - b.sequenceOrder;
      if (sequence) return sequence;
    }
    if (!a.scheduledAt) return 1;
    if (!b.scheduledAt) return -1;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  res.json(scheduleItems);
});

/**
 * GET /time-tracking/daily-task-hours
 * Returns completed task bundle durations for the calling user for a given date (or today).
 * Admins may pass ?userId=N to view another user's data.
 */
router.get("/time-tracking/daily-task-hours", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const callerId = getUserId(req);
  const { date, userId: userIdParam } = req.query as Record<string, string | undefined>;

  let targetUserId = callerId;
  if (userIdParam) {
    const role = await getCallerRole(tenantId, callerId);
    if (!ADMIN_ROLES.has(role)) { res.status(403).json({ error: "Admin or office role required to view other users" }); return; }
    targetUserId = parseInt(userIdParam, 10);
  }

  const d = date ? new Date(date) : new Date();
  d.setHours(0, 0, 0, 0);
  // Exclusive upper bound: < midnight of next day (not <=, to avoid including next-day records)
  const dNext = new Date(d); dNext.setDate(d.getDate() + 1);

  const rows = await db
    .select({
      completion: taskBundleCompletionsTable,
      bundleName: taskBundlesTable.name,
    })
    .from(taskBundleCompletionsTable)
    .leftJoin(taskBundlesTable, eq(taskBundleCompletionsTable.bundleId, taskBundlesTable.id))
    .where(and(
      eq(taskBundleCompletionsTable.tenantId, tenantId),
      eq(taskBundleCompletionsTable.userId, targetUserId),
      eq(taskBundleCompletionsTable.status, "completed"),
      gte(taskBundleCompletionsTable.completedAt, d),
      sql`${taskBundleCompletionsTable.completedAt} < ${dNext}`,
    ))
    .orderBy(desc(taskBundleCompletionsTable.completedAt));

  const totalSeconds = rows.reduce((s, r) => s + (r.completion.durationSeconds ?? 0), 0);

  res.json({
    userId: targetUserId,
    date: d.toISOString().split("T")[0],
    totalSeconds,
    totalMinutes: Math.round(totalSeconds / 60),
    entries: rows.map(r => ({
      completionId: r.completion.id,
      bundleId: r.completion.bundleId,
      bundleName: r.bundleName ?? null,
      durationSeconds: r.completion.durationSeconds ?? 0,
      startedAt: r.completion.startedAt.toISOString(),
      completedAt: r.completion.completedAt?.toISOString() ?? null,
      hasFlags: r.completion.hasFlags,
    })),
  });
});

/**
 * GET /time-tracking/daily-task-hours/summary
 * Returns per-user daily task hour totals for a date range.
 * Admins see all users; non-admins see only their own data.
 */
router.get("/time-tracking/daily-task-hours/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const callerId = getUserId(req);
  const role = await getCallerRole(tenantId, callerId);
  const isAdmin = ADMIN_ROLES.has(role);

  const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;

  const conditions = [
    eq(taskBundleCompletionsTable.tenantId, tenantId),
    eq(taskBundleCompletionsTable.status, "completed"),
  ];
  // Non-admins can only see their own task hours
  if (!isAdmin) conditions.push(eq(taskBundleCompletionsTable.userId, callerId));
  if (dateFrom) conditions.push(gte(taskBundleCompletionsTable.completedAt, new Date(dateFrom)));
  if (dateTo) {
    const dt = new Date(`${dateTo}T23:59:59.999Z`);
    conditions.push(lte(taskBundleCompletionsTable.completedAt, dt));
  }

  const rows = await db
    .select({
      userId: taskBundleCompletionsTable.userId,
      totalSeconds: sql<number>`COALESCE(sum(duration_seconds),0)::int`,
      runCount: sql<number>`count(*)::int`,
    })
    .from(taskBundleCompletionsTable)
    .where(and(...conditions))
    .groupBy(taskBundleCompletionsTable.userId);

  const userIds = rows.map(r => r.userId);
  const users = userIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
        .where(eq(usersTable.tenantId, tenantId))
    : [];
  const userMap = new Map(users.map(u => [u.id, u.name]));

  res.json(rows.map(r => ({
    userId: r.userId,
    userName: userMap.get(r.userId) ?? null,
    totalSeconds: r.totalSeconds,
    totalMinutes: Math.round(r.totalSeconds / 60),
    runCount: r.runCount,
  })));
});

/**
 * GET /time-tracking/clock-in-hours/summary
 * Returns per-user clock-in (master-clock) hour totals for a date range.
 * Admin-only endpoint.
 */
router.get("/time-tracking/clock-in-hours/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const callerId = getUserId(req);
  const role = await getCallerRole(tenantId, callerId);
  if (!ADMIN_ROLES.has(role)) {
    res.status(403).json({ error: "Admin or office role required" });
    return;
  }

  const { dateFrom, dateTo } = req.query as Record<string, string | undefined>;

  const conditions = [
    eq(timeEntriesTable.tenantId, tenantId),
    eq(timeEntriesTable.isMasterClock, true),
    sql`clocked_out_at IS NOT NULL`,
  ];
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    conditions.push(gte(timeEntriesTable.clockedInAt, from));
  }
  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59.999Z`);
    conditions.push(lte(timeEntriesTable.clockedInAt, to));
  }

  const rows = await db
    .select({
      userId: timeEntriesTable.userId,
      totalMinutes: sql<number>`COALESCE(sum(total_minutes),0)::int`,
    })
    .from(timeEntriesTable)
    .where(and(...conditions))
    .groupBy(timeEntriesTable.userId);

  const userIds = rows.map(r => r.userId);
  const users = userIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
        .where(eq(usersTable.tenantId, tenantId))
    : [];
  const userMap = new Map(users.map(u => [u.id, u.name]));

  res.json(rows.map(r => ({
    userId: r.userId,
    userName: userMap.get(r.userId) ?? null,
    totalMinutes: r.totalMinutes,
  })));
});

export default router;
