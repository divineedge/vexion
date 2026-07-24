/**
 * Route-level integration tests for POST /customer-plans/:id/renew
 *
 * Covers:
 *   1. Matrix-priced plan: when the property's serviceableAreaSqft has changed
 *      since the original sale, the renewal invoice reflects the new
 *      area-resolved price and the plan's billingPrice column is updated.
 *   2. Matrix-priced plan: area shrinks → lower tier price applied.
 *   3. Flat-priced plan: billingPrice and invoice total are unaffected by any
 *      property area value.
 *   4. Flat-priced plan: property area changes between runs but price stays.
 *
 * DB integration tests are skipped when DATABASE_URL is absent (CI without a
 * DB sidecar). They clean up after themselves and are safe against the dev DB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  db,
  tenantsTable,
  customersTable,
  propertiesTable,
  planTemplatesTable,
  customerPlansTable,
  invoicesTable,
  activityLogTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Mock external I/O — no real HTTP calls, email queues, or admin-role DB checks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../lib/emailProvider", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, externalId: "mock-id" }),
}));

vi.mock("../lib/billingScheduler", () => ({
  enqueueInvoiceEmail: vi.fn().mockResolvedValue(undefined),
}));

// Allow the route to proceed without a real DB user with admin role.
vi.mock("../lib/roles", () => ({
  isAdminRole: vi.fn().mockResolvedValue(true),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Build a minimal Express app that only mounts the servicePlans router.
// This avoids starting the scheduler timers that app.ts kicks off.
// ─────────────────────────────────────────────────────────────────────────────

async function buildTestApp() {
  const { default: servicePlansRouter } = await import("./servicePlans");
  const app = express();
  app.use(express.json());
  app.use("/", servicePlansRouter);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB integration tests
// ─────────────────────────────────────────────────────────────────────────────

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("POST /customer-plans/:id/renew — area-based pricing", () => {
  let tenantId: number;
  let customerId: number;
  let propertyId: number;
  let templateId: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  // A simple two-tier matrix: ≤6000 sqft → $100, >6000 sqft → $200
  const MATRIX = [
    { minSqft: 0, maxSqft: 6000, price: 100 },
    { minSqft: 6001, maxSqft: null, price: 200 },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  // ── Fixture helpers ─────────────────────────────────────────────────────────

  async function setupTenant(): Promise<void> {
    const [t] = await db
      .insert(tenantsTable)
      .values({ name: `__test_manualrenew_${Date.now()}__`, taxRate: 0 })
      .returning();
    tenantId = t.id;
  }

  async function setupCustomer(): Promise<void> {
    const [c] = await db
      .insert(customersTable)
      .values({
        tenantId,
        name: "Manual Renewal Test Customer",
        email: `manualrenew_${Date.now()}@example.com`,
        phone: "555-0300",
      })
      .returning();
    customerId = c.id;
  }

  async function setupProperty(serviceableAreaSqft: number | null): Promise<void> {
    const [p] = await db
      .insert(propertiesTable)
      .values({ tenantId, customerId, address: "99 Renewal Rd", serviceableAreaSqft })
      .returning();
    propertyId = p.id;
  }

  async function setupMatrixTemplate(): Promise<void> {
    const [tmpl] = await db
      .insert(planTemplatesTable)
      .values({
        tenantId,
        name: "Matrix Lawn Plan",
        services: [],
        visitCount: 1,
        billingCycle: "monthly",
        price: 100,
        pricingMode: "matrix",
        pricingMatrix: MATRIX,
      })
      .returning();
    templateId = tmpl.id;
  }

  async function setupFlatTemplate(): Promise<void> {
    const [tmpl] = await db
      .insert(planTemplatesTable)
      .values({
        tenantId,
        name: "Flat Lawn Plan",
        services: [],
        visitCount: 1,
        billingCycle: "monthly",
        price: 150,
        pricingMode: "flat",
      })
      .returning();
    templateId = tmpl.id;
  }

  /** Creates a plan whose period has already elapsed (endDate = now). */
  async function setupActivePlan(
    billingPrice: number,
    overrides: Partial<typeof customerPlansTable.$inferInsert> = {},
  ): Promise<typeof customerPlansTable.$inferSelect> {
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = new Date(); // ending today
    const [plan] = await db
      .insert(customerPlansTable)
      .values({
        tenantId,
        customerId,
        propertyId,
        templateId,
        templateName: "Test Plan",
        startDate: start,
        endDate: end,
        billingCycle: "monthly",
        billingPrice,
        autoRenew: true,
        status: "active",
        nextBillingDate: today,
        serviceState: [],
        ...overrides,
      })
      .returning();
    return plan;
  }

  // ── Cleanup — FK-safe delete order ──────────────────────────────────────────

  afterEach(async () => {
    if (!tenantId) return;
    await db.delete(activityLogTable).where(eq(activityLogTable.tenantId, tenantId));
    await db.delete(invoicesTable).where(eq(invoicesTable.tenantId, tenantId));
    await db.delete(customerPlansTable).where(eq(customerPlansTable.tenantId, tenantId));
    await db.delete(planTemplatesTable).where(eq(planTemplatesTable.tenantId, tenantId));
    await db.delete(propertiesTable).where(eq(propertiesTable.tenantId, tenantId));
    await db.delete(customersTable).where(eq(customersTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  });

  // ── Helper queries ──────────────────────────────────────────────────────────

  async function getPlan(id: number) {
    const [row] = await db.select().from(customerPlansTable).where(eq(customerPlansTable.id, id));
    return row;
  }

  async function getInvoicesForPlan(planId: number) {
    return db.select().from(invoicesTable).where(eq(invoicesTable.planId, planId));
  }

  /** POST /customer-plans/:id/renew with tenant + user headers. */
  function callRenew(planId: number) {
    return request(app)
      .post(`/customer-plans/${planId}/renew`)
      .set("x-tenant-id", String(tenantId))
      .set("x-user-id", "1")
      .send();
  }

  // ── Tests ───────────────────────────────────────────────────────────────────

  it("updates billingPrice and invoices at the new tier price when property area grows", async () => {
    // Original sale: property was 5000 sqft → tier-1 price = $100
    await setupTenant();
    await setupCustomer();
    await setupProperty(5000);
    await setupMatrixTemplate();
    const plan = await setupActivePlan(100); // sold at $100 (5000 sqft tier)

    // Property re-measured at 8000 sqft → should now fall in tier-2 ($200)
    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 8000 })
      .where(eq(propertiesTable.id, propertyId));

    const res = await callRenew(plan.id);
    expect(res.status).toBe(200);

    // billingPrice on the plan must have been bumped to the new tier
    const updatedPlan = await getPlan(plan.id);
    expect(updatedPlan.billingPrice).toBe(200);

    // The renewal invoice must be billed at the new price
    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].subtotal).toBe(200);
    expect(invoices[0].total).toBe(200); // taxRate = 0 on this tenant
  });

  it("updates billingPrice and invoices at the lower tier price when property area shrinks", async () => {
    // Original sale: property was 8000 sqft → tier-2 price = $200
    await setupTenant();
    await setupCustomer();
    await setupProperty(8000);
    await setupMatrixTemplate();
    const plan = await setupActivePlan(200); // sold at $200 (8000 sqft tier)

    // Property re-measured at 4000 sqft → tier-1 price = $100
    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 4000 })
      .where(eq(propertiesTable.id, propertyId));

    const res = await callRenew(plan.id);
    expect(res.status).toBe(200);

    const updatedPlan = await getPlan(plan.id);
    expect(updatedPlan.billingPrice).toBe(100);

    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].subtotal).toBe(100);
    expect(invoices[0].total).toBe(100);
  });

  it("does NOT change billingPrice when property area stays within the same tier", async () => {
    // Both 5000 and 5500 sqft fall in tier-1 (≤6000 → $100)
    await setupTenant();
    await setupCustomer();
    await setupProperty(5000);
    await setupMatrixTemplate();
    const plan = await setupActivePlan(100);

    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 5500 })
      .where(eq(propertiesTable.id, propertyId));

    const res = await callRenew(plan.id);
    expect(res.status).toBe(200);

    const updatedPlan = await getPlan(plan.id);
    expect(updatedPlan.billingPrice).toBe(100); // unchanged — same tier

    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].subtotal).toBe(100);
  });

  it("flat-priced plan: billingPrice and invoice total are unchanged regardless of property area", async () => {
    await setupTenant();
    await setupCustomer();
    await setupProperty(99999); // large area — flat plans ignore it
    await setupFlatTemplate();
    const plan = await setupActivePlan(150);

    const res = await callRenew(plan.id);
    expect(res.status).toBe(200);

    const updatedPlan = await getPlan(plan.id);
    expect(updatedPlan.billingPrice).toBe(150); // unchanged

    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].subtotal).toBe(150);
    expect(invoices[0].total).toBe(150);
  });

  it("flat-priced plan: renewal does not update billingPrice even when property area changes between runs", async () => {
    await setupTenant();
    await setupCustomer();
    await setupProperty(1000);
    await setupFlatTemplate();
    const plan = await setupActivePlan(150);

    // Simulate a large area update — must have zero effect on flat billing
    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 50000 })
      .where(eq(propertiesTable.id, propertyId));

    const res = await callRenew(plan.id);
    expect(res.status).toBe(200);

    const updatedPlan = await getPlan(plan.id);
    expect(updatedPlan.billingPrice).toBe(150);

    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices[0].subtotal).toBe(150);
  });

  it("returns 404 for a non-existent plan", async () => {
    await setupTenant();
    const res = await callRenew(999999999);
    expect(res.status).toBe(404);
  });

  it("returns 400 when trying to renew a cancelled plan", async () => {
    await setupTenant();
    await setupCustomer();
    await setupProperty(5000);
    await setupMatrixTemplate();
    const plan = await setupActivePlan(100, { status: "cancelled" });

    const res = await callRenew(plan.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancelled/i);
  });

  it("response body includes the updated plan and invoiceId", async () => {
    await setupTenant();
    await setupCustomer();
    await setupProperty(8000);
    await setupMatrixTemplate();
    const plan = await setupActivePlan(100); // area changed → will update to $200

    const res = await callRenew(plan.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(plan.id);
    expect(typeof res.body.invoiceId).toBe("number");
    // endDate should have advanced by ~30 days (monthly cycle)
    const newEnd = new Date(res.body.endDate);
    const origEnd = plan.endDate;
    const diffDays = Math.round((newEnd.getTime() - origEnd.getTime()) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBeCloseTo(30, 0);
  });
});
