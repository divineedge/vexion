/**
 * DB-backed + HTTP integration tests for the plan-visit reschedule endpoint.
 *
 * POST /api/customer-plans/:id/visits/:jobId/reschedule
 * (implemented in artifacts/api-server/src/routes/servicePlans.ts ~line 538)
 *
 * Uses Supertest against a real Express app (with the actual servicePlans router)
 * and a real PostgreSQL DB, so route auth, request parsing, status codes,
 * response bodies, activity-log writes, and DB side-effects are all exercised.
 *
 * Covered scenarios:
 *   1. Valid reschedule — 200, response body correct, job keeps planId, scheduledAt
 *      updated, serviceState cursor advances when new date is later.
 *   2. Cursor does NOT regress when the new date is earlier than existing cursor.
 *   3. Non-scheduled visit (completed) returns 400.
 *   4. Job on a different plan (or nonexistent) returns 404.
 *   5. Other visits on the same plan are unaffected.
 *   6. Missing newScheduledAt returns 400 (request validation boundary).
 *
 * Tests are skipped when DATABASE_URL is absent (CI without a DB sidecar).
 * They clean up after themselves and are safe to run against the dev DB.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import {
  db,
  tenantsTable,
  usersTable,
  customersTable,
  propertiesTable,
  planTemplatesTable,
  customerPlansTable,
  jobsTable,
  activityLogTable,
  servicesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import servicePlansRouter from "./servicePlans";

// ---------------------------------------------------------------------------
// Guard — skip when no DB is available
// ---------------------------------------------------------------------------
const RUN = !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Build a minimal test app (mirrors app.ts middleware stack)
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  // Test-only authenticated identity; production ignores caller identity headers.
  app.use((req, _res, next) => {
    Object.assign(req, { verifiedTenantId: Number(req.headers["x-tenant-id"]), verifiedUserId: Number(req.headers["x-user-id"]) });
    next();
  });
  // Mount at /api to match the production app.use("/api", router) path
  app.use("/api", servicePlansRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe.skipIf(!RUN)("POST /api/customer-plans/:id/visits/:jobId/reschedule — HTTP integration", () => {
  const app = buildApp();

  // IDs set in beforeAll
  let tenantId: number;
  let adminUserId: number;
  let customerId: number;
  let propertyId: number;
  let templateId: number;
  let serviceId: number;
  let planId: number;

  // Collected for afterAll cleanup
  const insertedJobIds: number[] = [];
  const insertedPlanIds: number[] = [];
  const insertedUserIds: number[] = [];

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    // Tenant
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ name: "__test_reschedule_http__" })
      .returning({ id: tenantsTable.id });
    tenantId = tenant.id;

    // Admin user (company_owner passes requireAdmin)
    const uniqueEmail = `reschedule-test-${tenantId}@example.test`;
    const [user] = await db
      .insert(usersTable)
      .values({
        tenantId,
        name: "Test Admin",
        email: uniqueEmail,
        passwordHash: "mock",
        role: "company_owner",
      })
      .returning({ id: usersTable.id });
    adminUserId = user.id;
    insertedUserIds.push(adminUserId);

    // Customer
    const [customer] = await db
      .insert(customersTable)
      .values({
        tenantId,
        name: "Reschedule Test Customer",
        email: `customer-${tenantId}@example.test`,
        phone: "555-0100",
      })
      .returning({ id: customersTable.id });
    customerId = customer.id;

    // Property
    const [property] = await db
      .insert(propertiesTable)
      .values({ tenantId, customerId, address: "1 Reschedule Lane" })
      .returning({ id: propertiesTable.id });
    propertyId = property.id;

    // Service
    const [service] = await db
      .insert(servicesTable)
      .values({ tenantId, name: "__test_reschedule_service__" })
      .returning({ id: servicesTable.id });
    serviceId = service.id;

    // Plan template
    const [template] = await db
      .insert(planTemplatesTable)
      .values({
        tenantId,
        name: "__test_reschedule_template__",
        services: [{ serviceId, serviceName: "Test Svc", frequencyDays: 7 }],
      })
      .returning({ id: planTemplatesTable.id });
    templateId = template.id;

    // Customer plan — serviceState cursor starts at 2026-06-01
    const [plan] = await db
      .insert(customerPlansTable)
      .values({
        tenantId,
        customerId,
        propertyId,
        templateId,
        templateName: "__test_reschedule_template__",
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        billingPrice: 0,
        nextBillingDate: "2026-12-01",
        serviceState: [
          {
            serviceId,
            serviceName: "Test Svc",
            frequencyDays: 7,
            lastScheduledAt: "2026-06-01T00:00:00.000Z",
          },
        ],
      })
      .returning({ id: customerPlansTable.id });
    planId = plan.id;
    insertedPlanIds.push(planId);
  });

  afterAll(async () => {
    // Remove activity log rows for this tenant to avoid FK issues
    await db
      .delete(activityLogTable)
      .where(eq(activityLogTable.tenantId, tenantId));

    if (insertedJobIds.length > 0) {
      await db.delete(jobsTable).where(inArray(jobsTable.id, insertedJobIds));
    }
    if (insertedPlanIds.length > 0) {
      await db
        .delete(customerPlansTable)
        .where(inArray(customerPlansTable.id, insertedPlanIds));
    }
    await db
      .delete(planTemplatesTable)
      .where(eq(planTemplatesTable.id, templateId));
    await db.delete(servicesTable).where(eq(servicesTable.id, serviceId));
    await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
    await db.delete(customersTable).where(eq(customersTable.id, customerId));
    if (insertedUserIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, insertedUserIds));
    }
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  });

  /** Insert a minimal scheduled job linked to the shared plan. */
  async function insertPlanJob(
    overrides: Partial<typeof jobsTable.$inferInsert> = {},
  ): Promise<number> {
    const [job] = await db
      .insert(jobsTable)
      .values({
        tenantId,
        title: "__test_reschedule_job__",
        status: "scheduled",
        scheduledAt: new Date("2026-06-15T08:00:00Z"),
        customerId,
        propertyId,
        planId,
        serviceId,
        ...overrides,
      })
      .returning({ id: jobsTable.id });
    insertedJobIds.push(job.id);
    return job.id;
  }

  /** Convenience: POST the reschedule endpoint with admin credentials. */
  function rescheduleRequest(
    pid: number,
    jobId: number,
    body: Record<string, unknown>,
  ) {
    return request(app)
      .post(`/api/customer-plans/${pid}/visits/${jobId}/reschedule`)
      .set("x-tenant-id", String(tenantId))
      .set("x-user-id", String(adminUserId))
      .send(body);
  }

  // ── Test 1: missing newScheduledAt returns 400 (request validation) ───────

  it("returns 400 when newScheduledAt is missing", async () => {
    const jobId = await insertPlanJob();

    const res = await rescheduleRequest(planId, jobId, {});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/newScheduledAt/i);
  });

  // ── Test 2: valid reschedule to a later date ───────────────────────────────

  it("returns 200 with correct body, keeps planId, updates scheduledAt, advances cursor", async () => {
    const jobId = await insertPlanJob();
    const newDate = "2026-07-10T08:00:00.000Z";

    const res = await rescheduleRequest(planId, jobId, { newScheduledAt: newDate });

    // HTTP contract
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body.status).toBe("scheduled");
    expect(new Date(res.body.scheduledAt).toISOString()).toBe(newDate);

    // Job still linked to plan in the DB
    const [dbJob] = await db
      .select({ planId: jobsTable.planId, scheduledAt: jobsTable.scheduledAt })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));
    expect(dbJob.planId).toBe(planId);
    expect(dbJob.scheduledAt.toISOString()).toBe(newDate);

    // serviceState cursor has advanced
    const [plan] = await db
      .select({ serviceState: customerPlansTable.serviceState })
      .from(customerPlansTable)
      .where(eq(customerPlansTable.id, planId));
    const state = plan.serviceState as Array<{
      serviceId: number;
      lastScheduledAt: string;
    }>;
    const entry = state.find((s) => s.serviceId === serviceId);
    expect(entry).toBeDefined();
    expect(new Date(entry!.lastScheduledAt).toISOString()).toBe(newDate);
  });

  // ── Test 3: cursor does NOT regress when new date is earlier ──────────────

  it("returns 200 but does not rewind the serviceState cursor when rescheduling to an earlier date", async () => {
    // Cursor is currently at 2026-07-10 (advanced in test 2).
    // Read it before the reschedule.
    const [planBefore] = await db
      .select({ serviceState: customerPlansTable.serviceState })
      .from(customerPlansTable)
      .where(eq(customerPlansTable.id, planId));
    const stateBefore = planBefore.serviceState as Array<{
      serviceId: number;
      lastScheduledAt: string;
    }>;
    const cursorBefore = stateBefore.find((s) => s.serviceId === serviceId)!
      .lastScheduledAt;

    const jobId = await insertPlanJob({
      scheduledAt: new Date("2026-07-10T08:00:00Z"),
    });
    const earlierDate = "2026-05-01T08:00:00.000Z"; // before cursor

    const res = await rescheduleRequest(planId, jobId, {
      newScheduledAt: earlierDate,
    });

    expect(res.status).toBe(200);
    // scheduledAt on the job IS updated
    expect(new Date(res.body.scheduledAt).toISOString()).toBe(earlierDate);

    // Cursor has NOT moved
    const [planAfter] = await db
      .select({ serviceState: customerPlansTable.serviceState })
      .from(customerPlansTable)
      .where(eq(customerPlansTable.id, planId));
    const stateAfter = planAfter.serviceState as Array<{
      serviceId: number;
      lastScheduledAt: string;
    }>;
    const cursorAfter = stateAfter.find((s) => s.serviceId === serviceId)!
      .lastScheduledAt;
    expect(cursorAfter).toBe(cursorBefore);
  });

  // ── Test 4: non-scheduled visit returns 400 ───────────────────────────────

  it("returns 400 when the visit is not in 'scheduled' status", async () => {
    const jobId = await insertPlanJob({ status: "completed" });

    const res = await rescheduleRequest(planId, jobId, {
      newScheduledAt: "2026-08-01T08:00:00.000Z",
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  // ── Test 5: job belonging to a different plan returns 404 ─────────────────

  it("returns 404 when the jobId does not belong to the given plan", async () => {
    // Create a second plan
    const [otherPlan] = await db
      .insert(customerPlansTable)
      .values({
        tenantId,
        customerId,
        propertyId,
        templateId,
        templateName: "__test_reschedule_template__",
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        billingPrice: 0,
        nextBillingDate: "2026-12-01",
        serviceState: [],
      })
      .returning({ id: customerPlansTable.id });
    insertedPlanIds.push(otherPlan.id);

    // Job belongs to the OTHER plan
    const jobId = await insertPlanJob({ planId: otherPlan.id });

    // Try to reschedule using the ORIGINAL planId
    const res = await rescheduleRequest(planId, jobId, {
      newScheduledAt: "2026-08-01T08:00:00.000Z",
    });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  // ── Test 6: sibling visit on the same plan is unaffected ──────────────────

  it("does not alter the scheduledAt of sibling visits on the same plan", async () => {
    const siblingDate = new Date("2026-09-05T08:00:00Z");
    const siblingId = await insertPlanJob({ scheduledAt: siblingDate });
    const targetId = await insertPlanJob({
      scheduledAt: new Date("2026-09-12T08:00:00Z"),
    });

    const res = await rescheduleRequest(planId, targetId, {
      newScheduledAt: "2026-09-20T08:00:00.000Z",
    });
    expect(res.status).toBe(200);

    // Sibling row is unchanged
    const [sibling] = await db
      .select({ scheduledAt: jobsTable.scheduledAt, planId: jobsTable.planId })
      .from(jobsTable)
      .where(eq(jobsTable.id, siblingId));

    expect(sibling.planId).toBe(planId);
    expect(sibling.scheduledAt.toISOString()).toBe(siblingDate.toISOString());
  });
});
