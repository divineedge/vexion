import { Router, type IRouter } from "express";
import { db, timeEntriesTable, subTimersTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

router.get("/time-tracking/master-clock", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

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

router.post("/time-tracking/master-clock/start", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

  const [entry] = await db.insert(timeEntriesTable).values({
    tenantId,
    userId,
    clockedInAt: new Date(),
    isMasterClock: true,
  }).returning();

  res.json({ userId, isClockedIn: true, clockedInAt: entry.clockedInAt.toISOString(), totalMinutesToday: 0, entryId: entry.id });
});

router.post("/time-tracking/master-clock/stop", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

  const [active] = await db.select().from(timeEntriesTable).where(and(
    eq(timeEntriesTable.userId, userId),
    eq(timeEntriesTable.tenantId, tenantId),
    eq(timeEntriesTable.isMasterClock, true),
    sql`clocked_out_at IS NULL`
  ));

  if (!active) { res.status(400).json({ error: "Not clocked in" }); return; }

  const now = new Date();
  const totalMinutes = Math.floor((now.getTime() - active.clockedInAt.getTime()) / 60000);

  await db.update(timeEntriesTable).set({ clockedOutAt: now, totalMinutes }).where(eq(timeEntriesTable.id, active.id));

  res.json({ userId, isClockedIn: false, clockedInAt: null, totalMinutesToday: totalMinutes, entryId: null });
});

router.get("/time-tracking/sub-timers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

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

router.post("/time-tracking/sub-timers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { label, type, jobId } = req.body;

  if (!label || !type) { res.status(400).json({ error: "label and type required" }); return; }

  const [timer] = await db.insert(subTimersTable).values({
    tenantId,
    userId,
    label,
    type,
    jobId: jobId ? parseInt(jobId, 10) : null,
  }).returning();

  res.status(201).json({ ...timer, startedAt: timer.startedAt.toISOString(), stoppedAt: null, createdAt: timer.createdAt.toISOString() });
});

router.post("/time-tracking/sub-timers/:id/stop", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [timer] = await db.select().from(subTimersTable).where(and(eq(subTimersTable.id, id), eq(subTimersTable.tenantId, tenantId)));
  if (!timer) { res.status(404).json({ error: "Not found" }); return; }

  const now = new Date();
  const elapsed = Math.floor((now.getTime() - timer.startedAt.getTime()) / 1000);

  const [updated] = await db.update(subTimersTable).set({ stoppedAt: now, elapsedSeconds: elapsed, isActive: false }).where(eq(subTimersTable.id, id)).returning();
  res.json({ ...updated, startedAt: updated.startedAt.toISOString(), stoppedAt: updated.stoppedAt?.toISOString() ?? null, createdAt: updated.createdAt.toISOString() });
});

router.get("/time-tracking/entries", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
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

export default router;
