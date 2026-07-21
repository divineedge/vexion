/**
 * Tests for processOverduePlanFlags() in planScheduler.ts
 *
 * Covers:
 *   1. Happy path — plan with an overdue invoice past the threshold:
 *      - plan status flips to 'paused'
 *      - future scheduled plan visits are cancelled
 *      - a stop-service flag is created (status = 'pending')
 *      - admin/office users receive an email notification
 *   2. Idempotency — re-running the cycle after the plan is already paused
 *      does NOT create a duplicate stop-service flag.
 *   3. Tenant gate — plans whose tenant has stopServiceRuleEnabled = false
 *      are never touched.
 *   4. Threshold boundary — plan with an overdue invoice that has NOT yet
 *      crossed the threshold is left alone.
 *   5. Existing-flag guard — if another scheduler (payment reminders) already
 *      raised a pending flag for the same invoice, a duplicate is not created.
 *   6. Past-job guard — only future scheduled visits are cancelled; jobs that
 *      already happened are untouched.
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
  jobsTable,
  usersTable,
  stopServiceFlagsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

import { processOverduePlanFlags } from "./planScheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Mock external I/O so no real HTTP calls are made during tests.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./emailProvider", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, externalId: "mock-id" }),
}));

// planScheduler also imports billPlanPeriod and startPlanScheduler via the
// top-level import of servicePlans — we only call processOverduePlanFlags in
// these tests, but we still need the import to resolve without crashing.
vi.mock("../routes/servicePlans", () => ({
  billPlanPeriod: vi.fn().mockResolvedValue({ invoiceId: 9999 }),
}));

import { sendEmail } from "./emailProvider";

// ─────────────────────────────────────────────────────────────────────────────
// DB integration tests
// ─────────────────────────────────────────────────────────────────────────────

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("processOverduePlanFlags — DB integration", () => {
  // IDs collected per test for cleanup in afterEach.
  let tenantId: number;
  let customerId: number;
  let propertyId: number;
  let templateId: number;

  // ── Reset email mock before each test ─────────────────────────────────────
  beforeEach(() => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true, externalId: "mock-id" });
    vi.clearAllMocks();
    vi.mocked(sendEmail).mockResolvedValue({ success: true, externalId: "mock-id" });
  });

  // ── Fixture helpers ────────────────────────────────────────────────────────

  async function setupTenant(
    overrides: Partial<typeof tenantsTable.$inferInsert> = {},
  ): Promise<typeof tenantsTable.$inferSelect> {
    const [t] = await db
      .insert(tenantsTable)
      .values({
        name: `__test_plan_pause_${Date.now()}__`,
        stopServiceRuleEnabled: true,
        stopServiceThresholdDays: 30,
        ...overrides,
      })
      .returning();
    tenantId = t.id;
    return t;
  }

  async function setupCustomer(): Promise<typeof customersTable.$inferSelect> {
    const [c] = await db
      .insert(customersTable)
      .values({
        tenantId,
        name: "Overdue Customer",
        email: `overdue_${Date.now()}@example.com`,
        phone: "555-0100",
      })
      .returning();
    customerId = c.id;
    return c;
  }

  async function setupProperty(): Promise<typeof propertiesTable.$inferSelect> {
    const [p] = await db
      .insert(propertiesTable)
      .values({
        tenantId,
        customerId,
        address: "1 Test Street",
      })
      .returning();
    propertyId = p.id;
    return p;
  }

  async function setupTemplate(): Promise<typeof planTemplatesTable.$inferSelect> {
    const [tmpl] = await db
      .insert(planTemplatesTable)
      .values({
        tenantId,
        name: "Monthly Lawn Care",
        services: [],
        visitCount: 1,
        billingCycle: "monthly",
        price: 150,
      })
      .returning();
    templateId = tmpl.id;
    return tmpl;
  }

  async function setupPlan(
    overrides: Partial<typeof customerPlansTable.$inferInsert> = {},
  ): Promise<typeof customerPlansTable.$inferSelect> {
    const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
    const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);   // 30 days from now
    const [plan] = await db
      .insert(customerPlansTable)
      .values({
        tenantId,
        customerId,
        propertyId,
        templateId,
        templateName: "Monthly Lawn Care",
        startDate: start,
        endDate: end,
        billingCycle: "monthly",
        billingPrice: 150,
        status: "active",
        nextBillingDate: end.toISOString().slice(0, 10),
        serviceState: [],
        ...overrides,
      })
      .returning();
    return plan;
  }

  async function setupOverdueInvoice(
    planId: number,
    daysOverdue: number,
    overrides: Partial<typeof invoicesTable.$inferInsert> = {},
  ): Promise<typeof invoicesTable.$inferSelect> {
    const dueDate = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000);
    const [inv] = await db
      .insert(invoicesTable)
      .values({
        tenantId,
        customerId,
        planId,
        invoiceNumber: `INV-PLAN-TEST-${Date.now()}`,
        status: "sent",
        total: 150,
        subtotal: 150,
        tax: 0,
        dueDate,
        ...overrides,
      })
      .returning();
    return inv;
  }

  /** A plan-linked job scheduled in the future (should be cancelled on pause). */
  async function setupFutureJob(
    planId: number,
    daysFromNow = 7,
  ): Promise<typeof jobsTable.$inferSelect> {
    const scheduledAt = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
    const [job] = await db
      .insert(jobsTable)
      .values({
        tenantId,
        customerId,
        planId,
        title: "__test_plan_visit__",
        status: "scheduled",
        scheduledAt,
        totalAmount: 0,
      })
      .returning();
    return job;
  }

  /** A plan-linked job scheduled in the past (should NOT be touched on pause). */
  async function setupPastJob(planId: number): Promise<typeof jobsTable.$inferSelect> {
    const scheduledAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const [job] = await db
      .insert(jobsTable)
      .values({
        tenantId,
        customerId,
        planId,
        title: "__test_plan_visit_past__",
        status: "scheduled",
        scheduledAt,
        totalAmount: 0,
      })
      .returning();
    return job;
  }

  /** An office/owner user who should receive the admin notification email. */
  async function setupAdminUser(role: "owner" | "office" = "owner"): Promise<typeof usersTable.$inferSelect> {
    const [u] = await db
      .insert(usersTable)
      .values({
        tenantId,
        name: "Admin User",
        email: `admin_plan_test_${Date.now()}@example.com`,
        role,
        passwordHash: "mock",
      })
      .returning();
    return u;
  }

  // ── Cleanup — FK-safe delete order ────────────────────────────────────────

  afterEach(async () => {
    if (!tenantId) return;
    await db.delete(activityLogTable).where(eq(activityLogTable.tenantId, tenantId));
    await db.delete(stopServiceFlagsTable).where(eq(stopServiceFlagsTable.tenantId, tenantId));
    await db.delete(invoicesTable).where(eq(invoicesTable.tenantId, tenantId));
    await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenantId));
    await db.delete(customerPlansTable).where(eq(customerPlansTable.tenantId, tenantId));
    await db.delete(planTemplatesTable).where(eq(planTemplatesTable.tenantId, tenantId));
    await db.delete(propertiesTable).where(eq(propertiesTable.tenantId, tenantId));
    await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
    await db.delete(customersTable).where(eq(customersTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  });

  // ── Helper queries ─────────────────────────────────────────────────────────

  async function getPlan(id: number) {
    const [row] = await db.select().from(customerPlansTable).where(eq(customerPlansTable.id, id));
    return row;
  }

  async function getJob(id: number) {
    const [row] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
    return row;
  }

  async function getFlags() {
    return db.select().from(stopServiceFlagsTable).where(eq(stopServiceFlagsTable.tenantId, tenantId));
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  it("pauses the plan when an invoice crosses the overdue threshold", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35); // 35 days overdue, threshold = 30

    await processOverduePlanFlags();

    const updated = await getPlan(plan.id);
    expect(updated.status).toBe("paused");
  });

  it("cancels future scheduled plan visits when the plan is paused", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35);
    const futureJob = await setupFutureJob(plan.id);

    await processOverduePlanFlags();

    const updated = await getJob(futureJob.id);
    expect(updated.status).toBe("cancelled");
  });

  it("does NOT cancel past visits when pausing (only future ones)", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35);
    const pastJob = await setupPastJob(plan.id);
    await setupFutureJob(plan.id);

    await processOverduePlanFlags();

    const untouched = await getJob(pastJob.id);
    // Past visit remains scheduled (it happened — not our concern)
    expect(untouched.status).toBe("scheduled");
  });

  it("creates a stop-service flag for the paused plan", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    const invoice = await setupOverdueInvoice(plan.id, 35);

    await processOverduePlanFlags();

    const flags = await getFlags();
    expect(flags).toHaveLength(1);
    expect(flags[0].invoiceId).toBe(invoice.id);
    expect(flags[0].customerId).toBe(customerId);
    expect(flags[0].status).toBe("pending");
    expect(flags[0].daysOverdue).toBeGreaterThanOrEqual(35);
  });

  it("emails admin/office users when a plan is auto-paused", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35);
    const admin = await setupAdminUser("owner");

    await processOverduePlanFlags();

    expect(sendEmail).toHaveBeenCalledOnce();
    const [, toAddress] = vi.mocked(sendEmail).mock.calls[0];
    expect(toAddress).toBe(admin.email);
  });

  it("emails both owner and office users when both exist", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35);
    await setupAdminUser("owner");
    await setupAdminUser("office");

    await processOverduePlanFlags();

    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it("does NOT create a duplicate flag when the scheduler runs twice (idempotency)", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35);

    await processOverduePlanFlags(); // first run — pauses plan, creates flag
    await processOverduePlanFlags(); // second run — plan is 'paused', should be skipped

    const flags = await getFlags();
    expect(flags).toHaveLength(1);
  });

  it("does NOT re-cancel jobs on the second run (plan already paused, not in eligible set)", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35);
    await setupFutureJob(plan.id);

    await processOverduePlanFlags();
    vi.clearAllMocks();

    await processOverduePlanFlags(); // second run
    // Email must not have been sent again
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does NOT create a duplicate flag when a pending flag for the same invoice already exists", async () => {
    // This covers the case where the payment-reminder scheduler already raised
    // the flag before the plan scheduler runs.
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    const invoice = await setupOverdueInvoice(plan.id, 35);

    // Pre-insert a pending flag (simulates the payment-reminder scheduler having run first)
    await db.insert(stopServiceFlagsTable).values({
      tenantId,
      customerId,
      invoiceId: invoice.id,
      daysOverdue: 35,
      message: "Pre-existing flag",
      status: "pending",
    });

    await processOverduePlanFlags();

    const flags = await getFlags();
    expect(flags).toHaveLength(1); // only the pre-existing one
  });

  // ── Tenant gate ────────────────────────────────────────────────────────────

  it("does NOT pause a plan when the tenant has stopServiceRuleEnabled = false", async () => {
    await setupTenant({ stopServiceRuleEnabled: false, stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35);
    await setupFutureJob(plan.id);

    await processOverduePlanFlags();

    const unchanged = await getPlan(plan.id);
    expect(unchanged.status).toBe("active");

    const flags = await getFlags();
    expect(flags).toHaveLength(0);

    expect(sendEmail).not.toHaveBeenCalled();
  });

  // ── Threshold boundary ────────────────────────────────────────────────────

  it("does NOT pause a plan when the invoice is overdue but below the threshold", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    // Only 20 days overdue — threshold is 30
    await setupOverdueInvoice(plan.id, 20);

    await processOverduePlanFlags();

    const unchanged = await getPlan(plan.id);
    expect(unchanged.status).toBe("active");

    const flags = await getFlags();
    expect(flags).toHaveLength(0);
  });

  it("pauses a plan whose invoice is EXACTLY at the threshold (>= semantics)", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    // Exactly 30 days overdue — should cross the threshold
    await setupOverdueInvoice(plan.id, 30);

    await processOverduePlanFlags();

    const updated = await getPlan(plan.id);
    expect(updated.status).toBe("paused");

    const flags = await getFlags();
    expect(flags).toHaveLength(1);
  });

  it("does NOT pause a plan whose invoice is already paid", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan();
    await setupOverdueInvoice(plan.id, 35, { status: "paid" });

    await processOverduePlanFlags();

    const unchanged = await getPlan(plan.id);
    expect(unchanged.status).toBe("active");

    const flags = await getFlags();
    expect(flags).toHaveLength(0);
  });

  // ── pending_renewal status is also eligible ───────────────────────────────

  it("also pauses a plan whose status is pending_renewal when threshold crossed", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();
    const plan = await setupPlan({ status: "pending_renewal" });
    await setupOverdueInvoice(plan.id, 35);

    await processOverduePlanFlags();

    const updated = await getPlan(plan.id);
    expect(updated.status).toBe("paused");
  });

  // ── Multi-plan isolation ─────────────────────────────────────────────────

  it("only pauses the overdue plan and leaves an up-to-date plan on the same tenant untouched", async () => {
    await setupTenant({ stopServiceThresholdDays: 30 });
    await setupCustomer();
    await setupProperty();
    await setupTemplate();

    const overduePlan = await setupPlan();
    await setupOverdueInvoice(overduePlan.id, 35);

    // A second plan on the same tenant with no overdue invoice
    const goodPlan = await setupPlan();
    // goodPlan has no invoice at all — no overdue invoices → not paused

    await processOverduePlanFlags();

    const pausedRow = await getPlan(overduePlan.id);
    expect(pausedRow.status).toBe("paused");

    const goodRow = await getPlan(goodPlan.id);
    expect(goodRow.status).toBe("active");
  });
});
