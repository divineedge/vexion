/**
 * Integration test: portal plan ownership isolation
 *
 * Verifies that a valid portal session belonging to customer A cannot read or
 * modify a plan that belongs to customer B.  The server must return 404 (not
 * 403) in every cross-customer case so it does not leak whether the resource
 * exists at all.
 *
 * Skipped automatically when DATABASE_URL is absent (e.g. bare CI without a
 * DB sidecar) so the suite stays green everywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "crypto";
import {
  db,
  tenantsTable,
  customersTable,
  propertiesTable,
  customerOtpSessionsTable,
  customerPlansTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import portalRouter from "./portal";

// ---------------------------------------------------------------------------
// Guard — skip when there is no real database
// ---------------------------------------------------------------------------
const RUN = !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(portalRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!RUN)("portal plan ownership isolation", () => {
  let tenantId: number;
  let customerAId: number;
  let customerBId: number;
  let propertyBId: number;
  let planBId: number;
  /** Raw (un-hashed) token for customer A's session */
  const rawTokenA = crypto.randomBytes(32).toString("hex");

  // Collected IDs for cleanup
  const insertedSessionIds: number[] = [];
  const insertedPlanIds: number[] = [];
  const insertedTemplateIds: number[] = [];

  // ── Setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    // Tenant
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ name: "__test_plan_isolation__" })
      .returning({ id: tenantsTable.id });
    tenantId = tenant.id;

    // Two customers belonging to the same tenant
    const [custA] = await db
      .insert(customersTable)
      .values({ tenantId, name: "__test_plan_customer_a__", email: "plan-iso-a@example.invalid", phone: "" })
      .returning({ id: customersTable.id });
    customerAId = custA.id;

    const [custB] = await db
      .insert(customersTable)
      .values({ tenantId, name: "__test_plan_customer_b__", email: "plan-iso-b@example.invalid", phone: "" })
      .returning({ id: customersTable.id });
    customerBId = custB.id;

    // A property owned by customer B (plans require a propertyId)
    const [propB] = await db
      .insert(propertiesTable)
      .values({ tenantId, customerId: customerBId, address: "1 Test St" })
      .returning({ id: propertiesTable.id });
    propertyBId = propB.id;

    // A plan that belongs to customer B.
    // templateId is a required FK; we use a sentinel value of 0 which
    // deliberately satisfies the NOT NULL constraint without an existing
    // template — Drizzle/Postgres will accept the integer column value even
    // though it doesn't reference a real row when using a raw insert.
    // If your environment enforces the FK strictly, insert a minimal template
    // first and use its id here.
    // We insert with a try/catch and fall back to a direct insert bypassing
    // the FK guard via a raw query if needed.
    let planInserted = false;
    try {
      const [planB] = await db
        .insert(customerPlansTable)
        .values({
          tenantId,
          customerId: customerBId,
          propertyId: propertyBId,
          templateId: 0,
          templateName: "__test_template__",
          startDate: new Date("2025-01-01"),
          endDate: new Date("2026-01-01"),
          billingCycle: "monthly",
          billingPrice: 100,
          autoRenew: true,
          status: "active",
          nextBillingDate: "2025-02-01",
          serviceState: [],
        })
        .returning({ id: customerPlansTable.id });
      planBId = planB.id;
      planInserted = true;
    } catch {
      // FK on template_id rejected — insert a real plan_template first
    }

    if (!planInserted) {
      // Insert a minimal plan template so FK is satisfied
      const { planTemplatesTable } = await import("@workspace/db");
      const [tmpl] = await db
        .insert(planTemplatesTable)
        .values({ tenantId, name: "__test_plan_tmpl__", services: [], visitCount: 1, price: 0 })
        .returning({ id: planTemplatesTable.id });
      insertedTemplateIds.push(tmpl.id);

      const [planB] = await db
        .insert(customerPlansTable)
        .values({
          tenantId,
          customerId: customerBId,
          propertyId: propertyBId,
          templateId: tmpl.id,
          templateName: "__test_template__",
          startDate: new Date("2025-01-01"),
          endDate: new Date("2026-01-01"),
          billingCycle: "monthly",
          billingPrice: 100,
          autoRenew: true,
          status: "active",
          nextBillingDate: "2025-02-01",
          serviceState: [],
        })
        .returning({ id: customerPlansTable.id });
      planBId = planB.id;
    }
    insertedPlanIds.push(planBId);

    // A valid, non-expired portal session for customer A
    const future = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const [sess] = await db
      .insert(customerOtpSessionsTable)
      .values({
        tenantId,
        customerId: customerAId,
        email: "plan-iso-a@example.invalid",
        otpHash: hashToken("000000"),
        sessionToken: hashToken(rawTokenA),
        expiresAt: future,
      })
      .returning({ id: customerOtpSessionsTable.id });
    insertedSessionIds.push(sess.id);
  });

  // ── Teardown ─────────────────────────────────────────────────────────────

  afterAll(async () => {
    if (insertedPlanIds.length) {
      await db.delete(customerPlansTable).where(inArray(customerPlansTable.id, insertedPlanIds));
    }
    if (insertedSessionIds.length) {
      await db.delete(customerOtpSessionsTable).where(inArray(customerOtpSessionsTable.id, insertedSessionIds));
    }
    await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyBId));
    await db.delete(customersTable).where(inArray(customersTable.id, [customerAId, customerBId]));
    if (insertedTemplateIds.length) {
      const { planTemplatesTable } = await import("@workspace/db");
      await db.delete(planTemplatesTable).where(inArray(planTemplatesTable.id, insertedTemplateIds));
    }
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  });

  // ── Tests ────────────────────────────────────────────────────────────────

  it("GET /portal/plans returns only the authenticated customer's plans (empty — A has none)", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/portal/plans")
      .set("x-portal-token", rawTokenA)
      .set("x-tenant-id", String(tenantId));

    expect(res.status).toBe(200);
    // Customer A has no plans; the list must be empty — B's plan must not appear
    expect(Array.isArray(res.body)).toBe(true);
    const ids = (res.body as Array<{ id: number }>).map((p) => p.id);
    expect(ids).not.toContain(planBId);
  });

  it("GET /portal/plans/:id returns 404 when the plan belongs to a different customer", async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/portal/plans/${planBId}`)
      .set("x-portal-token", rawTokenA)
      .set("x-tenant-id", String(tenantId));

    expect(res.status).toBe(404);
  });

  it("PATCH /portal/plans/:id returns 404 when the plan belongs to a different customer", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch(`/portal/plans/${planBId}`)
      .set("x-portal-token", rawTokenA)
      .set("x-tenant-id", String(tenantId))
      .send({ autoRenew: false });

    expect(res.status).toBe(404);
  });

  it("PATCH /portal/plans/:id does not mutate the target plan when rejected", async () => {
    const app = buildApp();
    await request(app)
      .patch(`/portal/plans/${planBId}`)
      .set("x-portal-token", rawTokenA)
      .set("x-tenant-id", String(tenantId))
      .send({ autoRenew: false });

    // Verify the plan was NOT changed
    const [row] = await db
      .select({ autoRenew: customerPlansTable.autoRenew })
      .from(customerPlansTable)
      .where(eq(customerPlansTable.id, planBId))
      .limit(1);
    expect(row?.autoRenew).toBe(true); // unchanged from insert
  });

  it("GET /portal/plans/:id returns 401 without a portal token", async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/portal/plans/${planBId}`)
      .set("x-tenant-id", String(tenantId));

    expect(res.status).toBe(401);
  });
});
