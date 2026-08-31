import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  crewMembersTable, crewsTable, db, jobsTable, staffSessionsTable, subTimersTable,
  tenantsTable, timeEntriesTable, timeEntryAdjustmentsTable, usersTable,
} from "@workspace/db";
import timeTrackingRouter from "./timeTracking";

const RUN = !!process.env.DATABASE_URL;
const tokens = new Map<number, string>();
const day = "2033-07-14";
const app = express();
app.use(express.json());
app.use("/api", timeTrackingRouter);
const auth = (id: number) => ({ "x-staff-session": tokens.get(id)! });

describe.skipIf(!RUN)("time tracking — verified staff HTTP integration", () => {
  let tenantA: number, tenantB: number, tech: number, other: number, owner: number, foreign: number, crew: number;
  let direct: number, crewJob: number, otherJob: number, unassigned: number, foreignJob: number, routeSecond: number;
  const user = async (tenantId: number, role: string, name: string) => {
    const [row] = await db.insert(usersTable).values({ tenantId, role, name, passwordHash: "test", email: `tt-${name}-${Date.now()}@test.dev` }).returning({ id: usersTable.id });
    const token = `tt-${row.id}-${Date.now()}`;
    await db.insert(staffSessionsTable).values({ tenantId, userId: row.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) });
    tokens.set(row.id, token); return row.id;
  };
  const job = async (tenantId: number, title: string, scheduledAt: string, extra: Partial<typeof jobsTable.$inferInsert> = {}) => {
    const [row] = await db.insert(jobsTable).values({ tenantId, title, scheduledAt: new Date(scheduledAt), ...extra }).returning({ id: jobsTable.id });
    return row.id;
  };
  beforeAll(async () => {
    const stamp = Date.now();
    [{ name: `__tt_a_${stamp}` }, { name: `__tt_b_${stamp}` }].forEach(() => undefined);
    [tenantA, tenantB] = (await db.insert(tenantsTable).values([{ name: `__tt_a_${stamp}` }, { name: `__tt_b_${stamp}` }]).returning({ id: tenantsTable.id })).map(x => x.id) as [number, number];
    tech = await user(tenantA, "technician", "tech"); other = await user(tenantA, "technician", "other");
    owner = await user(tenantA, "company_owner", "owner"); foreign = await user(tenantB, "technician", "foreign");
    [crew] = (await db.insert(crewsTable).values({ tenantId: tenantA, name: "Crew" }).returning({ id: crewsTable.id })).map(x => x.id);
    await db.insert(crewMembersTable).values({ tenantId: tenantA, crewId: crew, userId: tech });
    direct = await job(tenantA, "Direct", `${day}T11:00:00.000Z`, { assigneeId: tech, routeTemplateId: 9, sequenceOrder: 2 });
    crewJob = await job(tenantA, "Crew", `${day}T12:00:00.000Z`, { crewId: crew, routeTemplateId: 9, sequenceOrder: 1 });
    routeSecond = await job(tenantA, "Later", `${day}T09:00:00.000Z`, { assigneeId: tech });
    otherJob = await job(tenantA, "Other", `${day}T10:00:00.000Z`, { assigneeId: other });
    unassigned = await job(tenantA, "Unassigned", `${day}T10:30:00.000Z`);
    await job(tenantA, "Tomorrow", "2033-07-15T09:00:00.000Z", { assigneeId: tech });
    foreignJob = await job(tenantB, "Foreign", `${day}T09:00:00.000Z`, { assigneeId: foreign });
  });
  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.delete(subTimersTable).where(eq(subTimersTable.tenantId, tenantId));
      await db.delete(timeEntryAdjustmentsTable).where(eq(timeEntryAdjustmentsTable.tenantId, tenantId));
      await db.delete(timeEntriesTable).where(eq(timeEntriesTable.tenantId, tenantId));
      await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenantId));
      await db.delete(crewMembersTable).where(eq(crewMembersTable.tenantId, tenantId));
      await db.delete(crewsTable).where(eq(crewsTable.tenantId, tenantId));
      await db.delete(staffSessionsTable).where(eq(staffSessionsTable.tenantId, tenantId));
      await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    }
  });
  it("limits technicians to direct and crew work; owners see their complete tenant only in route order", async () => {
    const techSchedule = await request(app).get(`/api/time-tracking/today-schedule?date=${day}`).set(auth(tech));
    expect(techSchedule.status).toBe(200);
    expect(techSchedule.body.map((x: { id: number }) => x.id)).toEqual([crewJob, direct, routeSecond]);
    const ownerSchedule = await request(app).get(`/api/time-tracking/today-schedule?date=${day}`).set(auth(owner));
    expect(ownerSchedule.body.map((x: { id: number }) => x.id)).toEqual([crewJob, direct, routeSecond, otherJob, unassigned]);
    expect(ownerSchedule.body.some((x: { id: number }) => x.id === foreignJob)).toBe(false);
  });
  it("starts only assigned tenant jobs, switches atomically, and never mutates master entries", async () => {
    const beforeMasters = await db.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.tenantId, tenantA), eq(timeEntriesTable.userId, tech)));
    expect((await request(app).post("/api/time-tracking/sub-timers").set(auth(tech)).send({ label: "Direct", type: "job", jobId: direct })).status).toBe(201);
    expect((await request(app).post("/api/time-tracking/sub-timers").set(auth(tech)).send({ label: "No", type: "job", jobId: unassigned })).status).toBe(403);
    expect((await request(app).post("/api/time-tracking/sub-timers").set(auth(tech)).send({ label: "Foreign", type: "job", jobId: foreignJob })).status).toBe(404);
    await request(app).post("/api/time-tracking/sub-timers").set(auth(tech)).send({ label: "Crew", type: "job", jobId: crewJob });
    const active = await db.select().from(subTimersTable).where(and(eq(subTimersTable.tenantId, tenantA), eq(subTimersTable.userId, tech), eq(subTimersTable.isActive, true)));
    expect(active).toHaveLength(1); expect(active[0].jobId).toBe(crewJob);
    expect(await db.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.tenantId, tenantA), eq(timeEntriesTable.userId, tech)))).toEqual(beforeMasters);
  });
  it("requires timer ownership to explicitly stop and concurrent starts still leave one active timer", async () => {
    const [timer] = await db.select().from(subTimersTable).where(and(eq(subTimersTable.userId, tech), eq(subTimersTable.isActive, true)));
    expect((await request(app).post(`/api/time-tracking/sub-timers/${timer.id}/stop`).set(auth(other)).send({})).status).toBe(404);
    expect((await request(app).post(`/api/time-tracking/sub-timers/${timer.id}/stop`).set(auth(tech)).send({})).status).toBe(200);
    await Promise.all([direct, crewJob].map(jobId => request(app).post("/api/time-tracking/sub-timers").set(auth(tech)).send({ label: `job-${jobId}`, type: "job", jobId })));
    expect(await db.select().from(subTimersTable).where(and(eq(subTimersTable.userId, tech), eq(subTimersTable.isActive, true)))).toHaveLength(1);
  });
  it("rejects malformed, future, and reversed time adjustments", async () => {
    const [stopped] = await db.select().from(subTimersTable).where(and(eq(subTimersTable.userId, tech), eq(subTimersTable.isActive, false)));
    expect((await request(app).patch(`/api/time-tracking/sub-timers/${stopped.id}/adjust`).set(auth(tech)).send({ adjustedStartedAt: "not-a-date" })).status).toBe(400);
    expect((await request(app).patch(`/api/time-tracking/sub-timers/${stopped.id}/adjust`).set(auth(tech)).send({ adjustedStartedAt: "2099-01-01T00:00:00.000Z" })).status).toBe(400);
    expect((await request(app).patch(`/api/time-tracking/sub-timers/${stopped.id}/adjust`).set(auth(tech)).send({ adjustedStartedAt: "2033-07-14T12:00:00.000Z", adjustedStoppedAt: "2033-07-14T11:00:00.000Z" })).status).toBe(400);
  });
  it("keeps master clock state independent of job timers", async () => {
    await request(app).post("/api/time-tracking/master-clock/start").set(auth(tech)).send({});
    await request(app).post("/api/time-tracking/sub-timers").set(auth(tech)).send({ label: "Direct", type: "job", jobId: direct });
    expect((await request(app).get("/api/time-tracking/master-clock").set(auth(tech))).body.isClockedIn).toBe(true);
  });
  it("rejects spoofed identity headers on protected reads", async () => {
    for (const endpoint of ["/api/time-tracking/entries", "/api/time-tracking/geofence-entries"]) {
      expect((await request(app).get(endpoint).set({ "x-tenant-id": String(tenantB), "x-user-id": String(foreign) })).status).toBe(401);
    }
  });
  it("serializes idempotent master starts and leaves zero active rows after concurrent stops", async () => {
    await request(app).post("/api/time-tracking/master-clock/stop").set(auth(other)).send({}); // ensure clean test user
    const starts = await Promise.all([1, 2].map(() => request(app).post("/api/time-tracking/master-clock/start").set(auth(other)).send({})));
    expect(starts.map(x => x.status)).toEqual([200, 200]);
    expect(await db.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.tenantId, tenantA), eq(timeEntriesTable.userId, other), eq(timeEntriesTable.isMasterClock, true), sql`clocked_out_at IS NULL`))).toHaveLength(1);
    await Promise.all([1, 2].map(() => request(app).post("/api/time-tracking/master-clock/stop").set(auth(other)).send({})));
    expect(await db.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.tenantId, tenantA), eq(timeEntriesTable.userId, other), eq(timeEntriesTable.isMasterClock, true), sql`clocked_out_at IS NULL`))).toHaveLength(0);
  });
  it("lets authorized staff adjust completed entries, preserves raw timestamps, audits changes, and updates payroll totals", async () => {
    const rawIn = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const rawOut = new Date(Date.now() - 60 * 60 * 1000);
    const [entry] = await db.insert(timeEntriesTable).values({
      tenantId: tenantA, userId: tech, clockedInAt: rawIn, clockedOutAt: rawOut,
      totalMinutes: 120, isMasterClock: true,
    }).returning();
    const adjustedIn = new Date(rawIn.getTime() + 15 * 60 * 1000);
    const adjustedOut = new Date(rawOut.getTime() - 15 * 60 * 1000);
    const body = {
      adjustedClockedInAt: adjustedIn.toISOString(),
      adjustedClockedOutAt: adjustedOut.toISOString(),
      reason: "Corrected from signed supervisor timesheet",
    };

    expect((await request(app).patch(`/api/time-tracking/entries/${entry.id}/adjust`).set(auth(tech)).send(body)).status).toBe(403);
    expect((await request(app).patch(`/api/time-tracking/entries/${entry.id}/adjust`).set(auth(owner)).send({ ...body, reason: " " })).status).toBe(400);
    expect((await request(app).patch(`/api/time-tracking/entries/${entry.id}/adjust`).set(auth(foreign)).send(body)).status).toBe(403);
    const adjusted = await request(app).patch(`/api/time-tracking/entries/${entry.id}/adjust`).set(auth(owner)).send(body);
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.totalMinutes).toBe(90);

    const [stored] = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, entry.id));
    expect(stored.clockedInAt.toISOString()).toBe(rawIn.toISOString());
    expect(stored.clockedOutAt?.toISOString()).toBe(rawOut.toISOString());
    expect(stored.adjustedClockedInAt?.toISOString()).toBe(adjustedIn.toISOString());
    expect(stored.adjustedClockedOutAt?.toISOString()).toBe(adjustedOut.toISOString());
    const adjustedAgain = await request(app).patch(`/api/time-tracking/entries/${entry.id}/adjust`).set(auth(owner)).send({
      ...body, adjustedClockedOutAt: new Date(adjustedOut.getTime() - 5 * 60 * 1000).toISOString(), reason: "Final supervisor correction",
    });
    expect(adjustedAgain.status).toBe(200);
    const history = await request(app).get(`/api/time-tracking/entries/${entry.id}/adjustments`).set(auth(owner));
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
    expect(history.body[0]).toMatchObject({ actorUserId: owner, reason: "Final supervisor correction" });

    const summary = await request(app).get("/api/time-tracking/clock-in-hours/summary").set(auth(owner));
    expect(summary.status).toBe(200);
    expect(summary.body.find((row: { userId: number }) => row.userId === tech)?.totalMinutes).toBe(85);
  });
  it("rejects active, future, reversed, and cross-day completed-entry adjustments", async () => {
    const [active] = await db.insert(timeEntriesTable).values({
      tenantId: tenantA, userId: tech, clockedInAt: new Date(Date.now() - 10 * 60 * 1000), isMasterClock: true,
    }).returning();
    const validPast = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect((await request(app).patch(`/api/time-tracking/entries/${active.id}/adjust`).set(auth(owner)).send({
      adjustedClockedInAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(), adjustedClockedOutAt: validPast, reason: "Correction",
    })).status).toBe(409);
    expect((await request(app).patch(`/api/time-tracking/entries/${active.id}/adjust`).set(auth(owner)).send({
      adjustedClockedInAt: "2099-01-01T10:00:00.000Z", adjustedClockedOutAt: "2099-01-01T11:00:00.000Z", reason: "Correction",
    })).status).toBe(400);
    expect((await request(app).patch(`/api/time-tracking/entries/${active.id}/adjust`).set(auth(owner)).send({
      adjustedClockedInAt: "2020-01-01T11:00:00.000Z", adjustedClockedOutAt: "2020-01-01T10:00:00.000Z", reason: "Correction",
    })).status).toBe(400);
    const [completed] = await db.insert(timeEntriesTable).values({
      tenantId: tenantA, userId: tech, clockedInAt: new Date("2020-01-01T22:00:00.000Z"),
      clockedOutAt: new Date("2020-01-01T23:00:00.000Z"), totalMinutes: 60, isMasterClock: true,
    }).returning();
    expect((await request(app).patch(`/api/time-tracking/entries/${completed.id}/adjust`).set(auth(owner)).send({
      adjustedClockedInAt: "2020-01-01T23:30:00.000Z", adjustedClockedOutAt: "2020-01-02T00:30:00.000Z", reason: "Same local work day",
    })).status).toBe(200);
    expect((await request(app).patch(`/api/time-tracking/entries/${completed.id}/adjust`).set(auth(owner)).send({
      adjustedClockedInAt: "2020-01-02T04:30:00.000Z", adjustedClockedOutAt: "2020-01-02T06:30:00.000Z", reason: "Crosses local midnight",
    })).status).toBe(400);
  });
});