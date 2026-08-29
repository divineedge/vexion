/**
 * DB-backed HTTP coverage for the staff job-request workflow.  These tests
 * intentionally exercise the router (rather than exported helpers), including
 * the tenant/user headers used by the production authentication boundary.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  customersTable, db, internalTasksTable, jobRequestsTable, jobsTable,
  propertiesTable, servicesTable, staffSessionsTable, taskNotificationsTable, tenantsTable, usersTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import jobRequestsRouter from "./jobRequests";

const RUN = !!process.env.DATABASE_URL;
const start = "2031-05-14T09:00:00.000Z";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api", jobRequestsRouter);
  instance.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });
  return instance;
}
const tokens = new Map<number, string>();
function auth(_tenantId: number, userId: number) { return { "x-staff-session": tokens.get(userId)! }; }

describe.skipIf(!RUN)("job requests — tenant-safe HTTP integration", () => {
  const server = app();
  let tenantA: number, tenantB: number;
  let techA: number, techA2: number, managerA: number, managerB: number;
  let customerA: number, propertyA: number, serviceA: number;
  let customerB: number, propertyB: number, serviceB: number;

  const createUser = async (tenantId: number, role: string, label: string) => {
    const [user] = await db.insert(usersTable).values({
      tenantId, name: label, role, passwordHash: "test",
      email: `job-request-${label}-${Date.now()}@example.test`,
    }).returning({ id: usersTable.id });
    const token = `job-request-session-${tenantId}-${user.id}-${Date.now()}`;
    await db.insert(staffSessionsTable).values({
      tenantId, userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000 * 60),
    });
    tokens.set(user.id, token);
    return user.id;
  };
  const submit = (headers: Record<string, string>, key: string, body: Record<string, unknown> = {}) =>
    request(server).post("/api/job-requests").set(headers).send({ requestedStartDate: start, idempotencyKey: key, ...body });

  beforeAll(async () => {
    const [a] = await db.insert(tenantsTable).values({ name: `__job_request_a_${Date.now()}__` }).returning({ id: tenantsTable.id });
    const [b] = await db.insert(tenantsTable).values({ name: `__job_request_b_${Date.now()}__` }).returning({ id: tenantsTable.id });
    tenantA = a.id; tenantB = b.id;
    techA = await createUser(tenantA, "technician", "tech-a");
    techA2 = await createUser(tenantA, "technician", "tech-a2");
    managerA = await createUser(tenantA, "crew_manager", "manager-a");
    managerB = await createUser(tenantB, "company_owner", "manager-b");
    const [ca] = await db.insert(customersTable).values({ tenantId: tenantA, name: "Customer A", email: `a-${tenantA}@example.test`, phone: "555-0101" }).returning({ id: customersTable.id });
    const [cb] = await db.insert(customersTable).values({ tenantId: tenantB, name: "Customer B", email: `b-${tenantB}@example.test`, phone: "555-0102" }).returning({ id: customersTable.id });
    customerA = ca.id; customerB = cb.id;
    const [pa] = await db.insert(propertiesTable).values({ tenantId: tenantA, customerId: customerA, address: "1 Tenant A Way" }).returning({ id: propertiesTable.id });
    const [pb] = await db.insert(propertiesTable).values({ tenantId: tenantB, customerId: customerB, address: "1 Tenant B Way" }).returning({ id: propertiesTable.id });
    propertyA = pa.id; propertyB = pb.id;
    const [sa] = await db.insert(servicesTable).values({ tenantId: tenantA, name: "Tenant A Service" }).returning({ id: servicesTable.id });
    const [sb] = await db.insert(servicesTable).values({ tenantId: tenantB, name: "Tenant B Service" }).returning({ id: servicesTable.id });
    serviceA = sa.id; serviceB = sb.id;
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.delete(taskNotificationsTable).where(eq(taskNotificationsTable.tenantId, tenantId));
      await db.delete(internalTasksTable).where(eq(internalTasksTable.tenantId, tenantId));
      await db.delete(jobRequestsTable).where(eq(jobRequestsTable.tenantId, tenantId));
      await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenantId));
      await db.delete(staffSessionsTable).where(eq(staffSessionsTable.tenantId, tenantId));
      await db.delete(propertiesTable).where(eq(propertiesTable.tenantId, tenantId));
      await db.delete(servicesTable).where(eq(servicesTable.tenantId, tenantId));
      await db.delete(customersTable).where(eq(customersTable.tenantId, tenantId));
      await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    }
  });

  it("rejects customer, property, and service IDs belonging to another tenant", async () => {
    for (const body of [{ customerId: customerB }, { propertyId: propertyB }, { serviceId: serviceB }]) {
      const response = await submit(auth(tenantA, techA), `foreign-${Object.keys(body)[0]}`, body);
      expect(response.status).toBe(404);
    }
  });

  it("uses only a verified staff session, never spoofable identity headers", async () => {
    const response = await request(server).get("/api/job-requests").set({ "x-tenant-id": String(tenantA), "x-user-id": String(managerA) });
    expect(response.status).toBe(401);
  });

  it("lets technicians submit, lists only their own, and blocks review actions", async () => {
    const created = await submit(auth(tenantA, techA), "tech-own", { customerId: customerA, propertyId: propertyA, serviceId: serviceA, notes: "Please schedule" });
    expect(created.status).toBe(201);
    const other = await submit(auth(tenantA, techA2), "tech-other");
    expect(other.status).toBe(201);
    const mine = await request(server).get("/api/job-requests").set(auth(tenantA, techA));
    expect(mine.status).toBe(200);
    expect(mine.body.map((row: { requesterId: number }) => row.requesterId)).toEqual([techA]);
    for (const endpoint of ["approve", "reject", "request-clarification"]) {
      const response = await request(server).post(`/api/job-requests/${created.body.id}/${endpoint}`).set(auth(tenantA, techA)).send({ adminResponse: "No", idempotencyKey: `unauthorized-${endpoint}` });
      expect(response.status).toBe(403);
    }
  });

  it("allows a manager to list only its tenant's requests", async () => {
    await submit(auth(tenantB, managerB), "tenant-b-visible");
    const a = await request(server).get("/api/job-requests").set(auth(tenantA, managerA));
    const b = await request(server).get("/api/job-requests").set(auth(tenantB, managerB));
    expect(a.body.every((row: { customerName?: string }) => row.customerName !== "Customer B")).toBe(true);
    expect(b.body).toHaveLength(1);
  });

  it("normalizes idempotent duplicate submission without another row or notification", async () => {
    const headers = auth(tenantA, techA);
    const beforeRows = await db.select({ count: sql<number>`count(*)` }).from(jobRequestsTable).where(and(eq(jobRequestsTable.tenantId, tenantA), eq(jobRequestsTable.requesterId, techA)));
    const beforeNotifications = await db.select({ count: sql<number>`count(*)` }).from(taskNotificationsTable).where(eq(taskNotificationsTable.tenantId, tenantA));
    const first = await submit(headers, "same-retry-key", { notes: "first" });
    const second = await submit(headers, "same-retry-key", { notes: "ignored on retry" });
    expect(first.status).toBe(201); expect(second.status).toBe(200); expect(second.body.id).toBe(first.body.id);
    const afterRows = await db.select({ count: sql<number>`count(*)` }).from(jobRequestsTable).where(and(eq(jobRequestsTable.tenantId, tenantA), eq(jobRequestsTable.requesterId, techA)));
    const afterNotifications = await db.select({ count: sql<number>`count(*)` }).from(taskNotificationsTable).where(eq(taskNotificationsTable.tenantId, tenantA));
    expect(Number(afterRows[0].count)).toBe(Number(beforeRows[0].count) + 1);
    expect(Number(afterNotifications[0].count)).toBe(Number(beforeNotifications[0].count) + 1);
  });

  it("does not create a job while a request is pending", async () => {
    const before = await db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(eq(jobsTable.tenantId, tenantA));
    const response = await submit(auth(tenantA, techA), "no-job-until-approved", { customerId: customerA, propertyId: propertyA, serviceId: serviceA });
    expect(response.status).toBe(201); expect(response.body.status).toBe("pending");
    const after = await db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(eq(jobsTable.tenantId, tenantA));
    expect(Number(after[0].count)).toBe(Number(before[0].count));
  });

  it("approves exactly once with the tenant-scoped linked records and safely returns the existing job", async () => {
    const created = await submit(auth(tenantA, techA), "approve-once", { customerId: customerA, propertyId: propertyA, serviceId: serviceA });
    const [approved, concurrent] = await Promise.all([
      request(server).post(`/api/job-requests/${created.body.id}/approve`).set(auth(tenantA, managerA)).send({ scheduledAt: "2031-05-15T10:00:00.000Z" }),
      request(server).post(`/api/job-requests/${created.body.id}/approve`).set(auth(tenantA, managerA)).send({ scheduledAt: "2031-05-15T10:00:00.000Z" }),
    ]);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200); expect(approved.body.status).toBe("approved");
    expect(concurrent.status).toBe(200); expect(concurrent.body.approvedJobId).toBe(approved.body.approvedJobId);
    const jobs = await db.select().from(jobsTable).where(and(eq(jobsTable.tenantId, tenantA), eq(jobsTable.id, approved.body.approvedJobId)));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ customerId: customerA, propertyId: propertyA, serviceId: serviceA, status: "scheduled" });
  });

  it("revalidates related records inside approval and creates no job when one was removed", async () => {
    const [removedService] = await db.insert(servicesTable).values({ tenantId: tenantA, name: "Removed before review" }).returning({ id: servicesTable.id });
    const created = await submit(auth(tenantA, techA), "service-removed-before-approval", { serviceId: removedService.id });
    await db.delete(servicesTable).where(and(eq(servicesTable.id, removedService.id), eq(servicesTable.tenantId, tenantA)));
    const before = await db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(eq(jobsTable.tenantId, tenantA));
    const response = await request(server).post(`/api/job-requests/${created.body.id}/approve`).set(auth(tenantA, managerA)).send({});
    const after = await db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(eq(jobsTable.tenantId, tenantA));
    expect(response.status).toBe(409);
    expect(Number(after[0].count)).toBe(Number(before[0].count));
  });

  it("rejects stale approval and exposes rejection/clarification responses to the requester", async () => {
    const rejected = await submit(auth(tenantA, techA), "reject-visible");
    const rejection = await request(server).post(`/api/job-requests/${rejected.body.id}/reject`).set(auth(tenantA, managerA)).send({ adminResponse: "Not enough capacity", idempotencyKey: "reject-visible-key" });
    expect(rejection.status, JSON.stringify(rejection.body)).toBe(200);
    const staleApprove = await request(server).post(`/api/job-requests/${rejected.body.id}/approve`).set(auth(tenantA, managerA)).send({});
    expect(staleApprove.status).toBe(409);
    const clarify = await submit(auth(tenantA, techA), "clarify-visible");
    expect((await request(server).post(`/api/job-requests/${clarify.body.id}/request-clarification`).set(auth(tenantA, managerA)).send({ adminResponse: "Which gate code?", idempotencyKey: "clarify-visible-key" })).status).toBe(200);
    const mine = await request(server).get("/api/job-requests").set(auth(tenantA, techA));
    expect(mine.body.find((row: { id: number }) => row.id === rejected.body.id).adminResponse).toBe("Not enough capacity");
    expect(mine.body.find((row: { id: number }) => row.id === clarify.body.id).status).toBe("clarification_requested");
  });
});