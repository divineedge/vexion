/**
 * Integration tests for processRenewals() in planScheduler.ts
 *
 * Covers:
 *   1. Matrix-priced plan: when the property's serviceableAreaSqft has changed
 *      since the original sale, the renewal invoice reflects the new
 *      area-resolved price and the plan's billingPrice column is updated.
 *   2. Flat-priced plan: billingPrice and invoice total are unaffected by any
 *      property area value.
 *   3. Area unchanged: matrix plan whose area hasn't moved keeps the same
 *      billingPrice and generates an invoice at that price.
 *
 * DB integration tests are skipped when DATABASE_URL is absent (CI without a
 * DB sidecar). They clean up after themselves and are safe against the dev DB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import { processRenewals } from "./planScheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Mock external I/O so no real HTTP calls or email queues fire during tests.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./emailProvider", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, externalId: "mock-id" }),
}));

vi.mock("../lib/billingScheduler", () => ({
  enqueueInvoiceEmail: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// DB integration tests
// ─────────────────────────────────────────────────────────────────────────────

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("processRenewals — area-based pricing DB integration", () => {
  let tenantId: number;
  let customerId: number;
  let propertyId: number;
  let templateId: number;

  // A simple two-tier matrix: ≤6000 sqft → $100, >6000 sqft → $200
  const MATRIX = [
    { minSqft: 0, maxSqft: 6000, price: 100 },
    { minSqft: 6001, maxSqft: null, price: 200 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Fixture helpers ─────────────────────────────────────────────────────────

  async function setupTenant(): Promise<void> {
    const [t] = await db
      .insert(tenantsTable)
      .values({ name: `__test_renewal_pricing_${Date.now()}__`, taxRate: 0 })
      .returning();
    tenantId = t.id;
  }

  async function setupCustomer(): Promise<void> {
    const [c] = await db
      .insert(customersTable)
      .values({
        tenantId,
        name: "Renewal Test Customer",
        email: `renewal_test_${Date.now()}@example.com`,
        phone: "555-0200",
      })
      .returning();
    customerId = c.id;
  }

  async function setupProperty(serviceableAreaSqft: number | null): Promise<void> {
    const [p] = await db
      .insert(propertiesTable)
      .values({ tenantId, customerId, address: "42 Renewal Lane", serviceableAreaSqft })
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

  /** Creates a plan whose nextBillingDate is today (due for renewal now). */
  async function setupDuePlan(
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

  // ── Tests ───────────────────────────────────────────────────────────────────

  it("updates billingPrice and invoices at the new area-tier price when property area grows", async () => {
    // Original sale: property was 5000 sqft → tier-1 price = $100
    await setupTenant();
    await setupCustomer();
    await setupProperty(5000);
    await setupMatrixTemplate();
    const plan = await setupDuePlan(100); // sold at $100 (5000 sqft tier)

    // Property area later updated to 8000 sqft → tier-2 price should be $200
    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 8000 })
      .where(eq(propertiesTable.id, propertyId));

    await processRenewals();

    // billingPrice column on the plan must reflect the new tier
    const updatedPlan = await getPlan(plan.id);
    expect(updatedPlan.billingPrice).toBe(200);

    // The renewal invoice must be billed at the new price
    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].subtotal).toBe(200);
    expect(invoices[0].total).toBe(200); // taxRate = 0 on this tenant
  });

  it("updates billingPrice and invoices at the new area-tier price when property area shrinks", async () => {
    // Original sale: property was 8000 sqft → tier-2 price = $200
    await setupTenant();
    await setupCustomer();
    await setupProperty(8000);
    await setupMatrixTemplate();
    const plan = await setupDuePlan(200); // sold at $200 (8000 sqft tier)

    // Property area later re-measured at 4000 sqft → tier-1 price should be $100
    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 4000 })
      .where(eq(propertiesTable.id, propertyId));

    await processRenewals();

    const updatedPlan = await getPlan(plan.id);
    expect(updatedPlan.billingPrice).toBe(100);

    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].subtotal).toBe(100);
    expect(invoices[0].total).toBe(100);
  });

  it("does NOT change billingPrice when property area stays in the same tier", async () => {
    // Both 5000 and 5500 sqft fall in tier-1 (≤6000 → $100)
    await setupTenant();
    await setupCustomer();
    await setupProperty(5000);
    await setupMatrixTemplate();
    const plan = await setupDuePlan(100);

    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 5500 })
      .where(eq(propertiesTable.id, propertyId));

    await processRenewals();

    const updatedPlan = await getPlan(plan.id);
    // Price should not change — still in tier-1
    expect(updatedPlan.billingPrice).toBe(100);

    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].subtotal).toBe(100);
  });

  it("flat-priced plan: billingPrice is unchanged regardless of property area", async () => {
    // Give the property an area; a flat plan should ignore it entirely
    await setupTenant();
    await setupCustomer();
    await setupProperty(99999); // large area — irrelevant for flat plans
    await setupFlatTemplate();
    const plan = await setupDuePlan(150);

    await processRenewals();

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
    const plan = await setupDuePlan(150);

    // Simulate an area update — should have zero effect on flat billing
    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 50000 })
      .where(eq(propertiesTable.id, propertyId));

    await processRenewals();

    const updatedPlan = await getPlan(plan.id);
    expect(updatedPlan.billingPrice).toBe(150);

    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices[0].subtotal).toBe(150);
  });

  it("plan with autoRenew=false is skipped by processRenewals entirely", async () => {
    await setupTenant();
    await setupCustomer();
    await setupProperty(8000);
    await setupMatrixTemplate();
    const plan = await setupDuePlan(100, { autoRenew: false });

    await db.update(propertiesTable)
      .set({ serviceableAreaSqft: 8000 })
      .where(eq(propertiesTable.id, propertyId));

    await processRenewals();

    // No invoice should have been created
    const invoices = await getInvoicesForPlan(plan.id);
    expect(invoices).toHaveLength(0);

    // billingPrice should remain at the original sale price
    const unchanged = await getPlan(plan.id);
    expect(unchanged.billingPrice).toBe(100);
  });
});
