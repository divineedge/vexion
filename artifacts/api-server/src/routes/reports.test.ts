/**
 * Unit/integration tests for the Business Reports Suite (reports.ts).
 *
 * Strategy: mock @workspace/db so no real DB is needed, bypass the in-process
 * cache so compute() always runs, and stub isAdminRole to always return true.
 * Each test controls db.execute return values via mockResolvedValueOnce to
 * simulate the exact query sequence the route handler issues.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks (must be hoisted above imports that pull in the mocked modules) ──────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
  },
  tenantsTable: {},
  usersTable: {},
}));

vi.mock("../lib/roles", () => ({
  isAdminRole: vi.fn().mockResolvedValue(true),
}));

// Pass-through cache so compute() always runs in tests
vi.mock("../lib/reportsCache", () => ({
  getCachedReport: vi.fn().mockImplementation(
    async (_tenantId: number, _key: string, _params: unknown, compute: () => Promise<unknown>) => {
      const data = await compute();
      return { data, generatedAt: new Date().toISOString(), cached: false };
    },
  ),
}));

// ── Imports (after mocks are set up) ─────────────────────────────────────────

import { db } from "@workspace/db";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

/** Attach tenant/user headers that getTenantId/getUserId read from the request. */
function tenantHeaders(tenantId = 1, userId = 1) {
  return { "x-tenant-id": String(tenantId), "x-user-id": String(userId) };
}

/** Make db.select chain return a single tenant row with a given p4pMasterPercentage. */
function mockTenantP4p(pct: number) {
  const whereFn = vi.fn().mockResolvedValue([{ p4pMasterPercentage: pct }]);
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromFn });
}

/** Wrap rows in the shape Drizzle's db.execute returns. */
function rows<T>(data: T[]): { rows: T[] } {
  return { rows: data };
}

// ── Report A: Job Profitability ───────────────────────────────────────────────

describe("GET /reports/job-profitability", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    const { default: reportsRouter } = await import("./reports");
    app.use("/", reportsRouter);
  });

  it("computes revenue, costs, net profit, and margin for two jobs", async () => {
    // Tenant uses 30 % P4P
    mockTenantP4p(30);

    // ① Main jobs query — two completed jobs
    // Job A: invoice_total=500, parts_cost=100 (blueprint override p4p=25%)
    // Job B: invoice_total=200, parts_cost=50  (uses global 30%)
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        {
          id: 1, title: "Job A", completed_at: "2024-03-15T10:00:00Z",
          crew_id: null, assignee_id: null, property_id: null,
          total_amount: "500.00", parts_cost: "100.00",
          blueprint_p4p_pct: 25,
          invoice_total: "500.00",
          crew_name: null, assignee_name: null,
          property_address: null, customer_name: "Alice",
        },
        {
          id: 2, title: "Job B", completed_at: "2024-03-16T10:00:00Z",
          crew_id: null, assignee_id: null, property_id: null,
          total_amount: "200.00", parts_cost: "50.00",
          blueprint_p4p_pct: null, // falls back to global 30%
          invoice_total: "200.00",
          crew_name: null, assignee_name: null,
          property_address: null, customer_name: "Bob",
        },
      ]),
    );

    // ② Fuel aggregate — $60 total for the period (2 jobs → $30/job)
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([{ total: 60 }]),
    );

    const resp = await request(app)
      .get("/reports/job-profitability?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const { rows: jobRows, totals } = resp.body;

    // Verify Job A math:
    //   revenue=500, parts=100, netLaborPool=400, labor=400*25/100=100,
    //   fuel=30, netProfit=500-100-100-30=270, margin=270/500*100=54%
    const jobA = jobRows.find((r: { jobId: number }) => r.jobId === 1);
    expect(jobA.revenue).toBe(500);
    expect(jobA.partsCost).toBe(100);
    expect(jobA.laborCost).toBe(100);
    expect(jobA.fuelCost).toBe(30);
    expect(jobA.netProfit).toBe(270);
    expect(jobA.marginPct).toBe(54);

    // Verify Job B math:
    //   revenue=200, parts=50, netLaborPool=150, labor=150*30/100=45,
    //   fuel=30, netProfit=200-50-45-30=75, margin=75/200*100=37.5%
    const jobB = jobRows.find((r: { jobId: number }) => r.jobId === 2);
    expect(jobB.revenue).toBe(200);
    expect(jobB.partsCost).toBe(50);
    expect(jobB.laborCost).toBe(45);
    expect(jobB.fuelCost).toBe(30);
    expect(jobB.netProfit).toBe(75);
    expect(jobB.marginPct).toBe(37.5);

    // Totals
    expect(totals.revenue).toBe(700);
    expect(totals.partsCost).toBe(150);
    expect(totals.laborCost).toBe(145);
    expect(totals.fuelCost).toBe(60);
    expect(totals.netProfit).toBe(345);
  });

  it("uses total_amount as revenue when invoice_total is null", async () => {
    mockTenantP4p(20);

    // Job with no invoice yet — revenue falls back to total_amount
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        {
          id: 3, title: "No Invoice Job", completed_at: "2024-03-10T10:00:00Z",
          crew_id: null, assignee_id: null, property_id: null,
          total_amount: "300.00", parts_cost: "0.00",
          blueprint_p4p_pct: null,
          invoice_total: null,      // ← no linked invoice
          crew_name: null, assignee_name: null,
          property_address: null, customer_name: null,
        },
      ]),
    );
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([{ total: 0 }]));

    const resp = await request(app)
      .get("/reports/job-profitability?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const job = resp.body.rows[0];
    expect(job.revenue).toBe(300);
    //   laborCost = max(0, 300-0)*20/100 = 60
    expect(job.laborCost).toBe(60);
  });

  it("returns zero margin for a zero-revenue job without dividing by zero", async () => {
    mockTenantP4p(30);

    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        {
          id: 4, title: "Free Job", completed_at: "2024-03-10T10:00:00Z",
          crew_id: null, assignee_id: null, property_id: null,
          total_amount: "0.00", parts_cost: "0.00",
          blueprint_p4p_pct: null,
          invoice_total: "0.00",
          crew_name: null, assignee_name: null,
          property_address: null, customer_name: null,
        },
      ]),
    );
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([{ total: 0 }]));

    const resp = await request(app)
      .get("/reports/job-profitability?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const job = resp.body.rows[0];
    expect(job.revenue).toBe(0);
    expect(job.marginPct).toBe(0);     // must not be NaN or Infinity
    expect(job.netProfit).toBe(0);
  });

  it("returns an empty rows array for an empty date range", async () => {
    mockTenantP4p(30);
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([]));
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([{ total: 0 }]));

    const resp = await request(app)
      .get("/reports/job-profitability?startDate=2024-01-01&endDate=2024-01-01")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.rows).toHaveLength(0);
    expect(resp.body.totals.revenue).toBe(0);
    expect(resp.body.totals.netProfit).toBe(0);
  });

  it("allocates zero fuel cost per job when there are no fuel records", async () => {
    mockTenantP4p(30);

    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        {
          id: 5, title: "Job With No Fuel", completed_at: "2024-03-10T10:00:00Z",
          crew_id: null, assignee_id: null, property_id: null,
          total_amount: "400.00", parts_cost: "100.00",
          blueprint_p4p_pct: null,
          invoice_total: "400.00",
          crew_name: null, assignee_name: null,
          property_address: null, customer_name: null,
        },
      ]),
    );
    // Fuel total = 0
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([{ total: 0 }]));

    const resp = await request(app)
      .get("/reports/job-profitability?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const job = resp.body.rows[0];
    expect(job.fuelCost).toBe(0);
    // labor = max(0, 400-100)*30/100 = 90; netProfit = 400-100-90-0 = 210
    expect(job.laborCost).toBe(90);
    expect(job.netProfit).toBe(210);
  });

  it("clamps labor cost pool to zero when parts_cost exceeds revenue", async () => {
    // Parts > revenue → netLaborRevenue = max(0, …) = 0
    mockTenantP4p(30);

    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        {
          id: 6, title: "Loss Job", completed_at: "2024-03-10T10:00:00Z",
          crew_id: null, assignee_id: null, property_id: null,
          total_amount: "100.00", parts_cost: "200.00",  // parts > revenue
          blueprint_p4p_pct: null,
          invoice_total: "100.00",
          crew_name: null, assignee_name: null,
          property_address: null, customer_name: null,
        },
      ]),
    );
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([{ total: 0 }]));

    const resp = await request(app)
      .get("/reports/job-profitability?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const job = resp.body.rows[0];
    expect(job.laborCost).toBe(0);      // max(0, 100-200) = 0
    expect(job.netProfit).toBe(-100);   // 100 - 200 - 0 - 0
  });
});

// ── Report B: Employee Revenue ────────────────────────────────────────────────

describe("GET /reports/employee-revenue", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    const { default: reportsRouter } = await import("./reports");
    app.use("/", reportsRouter);
  });

  it("aggregates revenue and P4P earnings across multiple jobs for the same tech", async () => {
    mockTenantP4p(30);

    // Tech 1 has two jobs; Tech 2 has one job
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        { assignee_id: 10, assignee_name: "Alice", total_amount: "400.00", parts_cost: "100.00", blueprint_p4p_pct: null, invoice_total: "400.00" },
        { assignee_id: 10, assignee_name: "Alice", total_amount: "600.00", parts_cost: "50.00",  blueprint_p4p_pct: 20,   invoice_total: "600.00" },
        { assignee_id: 20, assignee_name: "Bob",   total_amount: "200.00", parts_cost: "0.00",   blueprint_p4p_pct: null, invoice_total: "200.00" },
      ]),
    );

    const resp = await request(app)
      .get("/reports/employee-revenue?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const { rows: techRows } = resp.body;

    // Alice:
    //   Job1 revenue=400, parts=100, pool=300, earnings=300*30/100=90
    //   Job2 revenue=600, parts=50,  pool=550, earnings=550*20/100=110
    //   totalRevenue=1000, totalP4p=200, avgJobValue=500, p4pRatio=200/1000*100=20%
    const alice = techRows.find((r: { userId: number }) => r.userId === 10);
    expect(alice.jobCount).toBe(2);
    expect(alice.totalRevenue).toBe(1000);
    expect(alice.totalP4pEarnings).toBe(200);
    expect(alice.averageJobValue).toBe(500);
    expect(alice.p4pToRevenueRatioPct).toBe(20);

    // Bob:
    //   revenue=200, parts=0, pool=200, earnings=200*30/100=60
    //   p4pRatio=60/200*100=30%
    const bob = techRows.find((r: { userId: number }) => r.userId === 20);
    expect(bob.jobCount).toBe(1);
    expect(bob.totalRevenue).toBe(200);
    expect(bob.totalP4pEarnings).toBe(60);
    expect(bob.averageJobValue).toBe(200);
    expect(bob.p4pToRevenueRatioPct).toBe(30);
  });

  it("returns an empty rows array when no jobs exist in the range", async () => {
    mockTenantP4p(30);
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([]));

    const resp = await request(app)
      .get("/reports/employee-revenue?startDate=2024-01-01&endDate=2024-01-02")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.rows).toHaveLength(0);
  });

  it("returns zero p4pToRevenueRatioPct when tech revenue is zero", async () => {
    mockTenantP4p(30);
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        { assignee_id: 10, assignee_name: "Zero Rev", total_amount: "0.00", parts_cost: "0.00", blueprint_p4p_pct: null, invoice_total: "0.00" },
      ]),
    );

    const resp = await request(app)
      .get("/reports/employee-revenue?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const tech = resp.body.rows[0];
    expect(tech.p4pToRevenueRatioPct).toBe(0);
  });
});

// ── Report C: P&L Statement ───────────────────────────────────────────────────

describe("GET /reports/pl-statement", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    const { default: reportsRouter } = await import("./reports");
    app.use("/", reportsRouter);
  });

  /**
   * Helper that sets up all four db.execute calls the route makes:
   *  1. Paid invoices (with optional job join)
   *  2. Fuel aggregate
   *  3. Expense aggregate
   *  4. Expense by category
   */
  function setupPlMocks(
    invoiceRows: unknown[],
    totalFuel: number,
    totalExpenses: number,
    categoryRows: unknown[] = [],
  ) {
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rows(invoiceRows))
      .mockResolvedValueOnce(rows([{ total: totalFuel }]))
      .mockResolvedValueOnce(rows([{ total: totalExpenses }]))
      .mockResolvedValueOnce(rows(categoryRows));
  }

  it("computes gross profit and net income correctly", async () => {
    mockTenantP4p(30);

    // Two paid invoices:
    //   Inv1: total=1000, parts=200, p4p_pct=null(→30%), pool=800, labor=240
    //   Inv2: total=500,  parts=50,  p4p_pct=20,          pool=450, labor=90
    setupPlMocks(
      [
        { invoice_id: 1, invoice_total: "1000.00", subtotal: "900.00", tax: "100.00", total_amount: "1000.00", parts_cost: "200.00", blueprint_p4p_pct: null },
        { invoice_id: 2, invoice_total: "500.00",  subtotal: "450.00", tax: "50.00",  total_amount: "500.00",  parts_cost: "50.00",  blueprint_p4p_pct: 20 },
      ],
      120,   // fuel
      200,   // operating expenses
      [{ category: "Office", total: 200 }],
    );

    const resp = await request(app)
      .get("/reports/pl-statement?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const body = resp.body;

    // revenue = 1000 + 500 = 1500
    expect(body.revenue).toBe(1500);

    // partsCost = 200 + 50 = 250
    expect(body.costOfGoodsSold.partsCost).toBe(250);

    // laborCost = 240 + 90 = 330
    expect(body.costOfGoodsSold.laborCost).toBe(330);

    // fuelCost = 120
    expect(body.costOfGoodsSold.fuelCost).toBe(120);

    // COGS = 250+330+120 = 700
    expect(body.costOfGoodsSold.total).toBe(700);

    // grossProfit = 1500-700 = 800
    expect(body.grossProfit).toBe(800);

    // operatingExpenses.total = 200
    expect(body.operatingExpenses.total).toBe(200);

    // netIncome = 800-200 = 600
    expect(body.netIncome).toBe(600);
  });

  it("handles an invoice with no linked job (parts_cost and total_amount are null)", async () => {
    mockTenantP4p(30);

    // Invoice with no job join — parts_cost is null, total_amount is null
    setupPlMocks(
      [
        {
          invoice_id: 99, invoice_total: "400.00", subtotal: "380.00", tax: "20.00",
          total_amount: null, parts_cost: null, blueprint_p4p_pct: null,
        },
      ],
      0,   // no fuel
      0,   // no expenses
    );

    const resp = await request(app)
      .get("/reports/pl-statement?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const body = resp.body;

    // revenue = 400
    expect(body.revenue).toBe(400);

    // parts=0, labor pool=max(0,400-0)*30/100=120 (revenue drives labor even with no job link)
    expect(body.costOfGoodsSold.partsCost).toBe(0);
    expect(body.costOfGoodsSold.laborCost).toBe(120);

    // grossProfit = 400 - 120 = 280
    expect(body.grossProfit).toBe(280);
  });

  it("returns all zeros for an empty date range", async () => {
    mockTenantP4p(30);
    setupPlMocks([], 0, 0);

    const resp = await request(app)
      .get("/reports/pl-statement?startDate=2024-01-01&endDate=2024-01-01")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const body = resp.body;
    expect(body.revenue).toBe(0);
    expect(body.grossProfit).toBe(0);
    expect(body.netIncome).toBe(0);
  });

  it("produces negative net income when expenses exceed gross profit", async () => {
    mockTenantP4p(0);  // No P4P so COGS = just parts

    setupPlMocks(
      [{ invoice_id: 1, invoice_total: "500.00", subtotal: "500.00", tax: "0.00", total_amount: "500.00", parts_cost: "100.00", blueprint_p4p_pct: null }],
      0,
      800,  // heavy operating expenses
    );

    const resp = await request(app)
      .get("/reports/pl-statement?startDate=2024-03-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    // grossProfit = 500-100-0-0 = 400; netIncome = 400-800 = -400
    const body = resp.body;
    expect(body.grossProfit).toBe(400);
    expect(body.netIncome).toBe(-400);
  });
});

// ── Report D: Aging Invoices ──────────────────────────────────────────────────

describe("GET /reports/aging-invoices", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    const { default: reportsRouter } = await import("./reports");
    app.use("/", reportsRouter);
  });

  /** Build an invoice row with a due_date offset from today by `daysAgo`. */
  function makeInvoice(id: number, total: string, daysAgo: number | null) {
    let due_date: string | null = null;
    if (daysAgo !== null) {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      due_date = d.toISOString();
    }
    return {
      id,
      invoice_number: `INV-${id}`,
      total,
      due_date,
      status: daysAgo != null && daysAgo > 0 ? "overdue" : "sent",
      customer_name: `Customer ${id}`,
      created_at: new Date().toISOString(),
    };
  }

  it("routes invoices into the correct aging buckets", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        makeInvoice(1, "100.00", 0),    // due today → current
        makeInvoice(2, "200.00", 15),   // 15 days overdue → 1–30
        makeInvoice(3, "300.00", 45),   // 45 days overdue → 31–60
        makeInvoice(4, "400.00", 75),   // 75 days overdue → 61–90
        makeInvoice(5, "500.00", 100),  // 100 days overdue → 90+
      ]),
    );

    const resp = await request(app)
      .get("/reports/aging-invoices")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const { buckets, totalOutstanding } = resp.body;

    expect(buckets.current.total).toBe(100);
    expect(buckets["1-30"].total).toBe(200);
    expect(buckets["31-60"].total).toBe(300);
    expect(buckets["61-90"].total).toBe(400);
    expect(buckets["90+"].total).toBe(500);
    expect(totalOutstanding).toBe(1500);
  });

  it("places invoices with no due_date into the current bucket", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([makeInvoice(10, "250.00", null)]),
    );

    const resp = await request(app)
      .get("/reports/aging-invoices")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const { buckets } = resp.body;
    expect(buckets.current.total).toBe(250);
    expect(buckets.current.invoices).toHaveLength(1);
    expect(buckets.current.invoices[0].daysOverdue).toBe(0);
  });

  it("returns zero totals for all buckets when there are no outstanding invoices", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([]));

    const resp = await request(app)
      .get("/reports/aging-invoices")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const { buckets, totalOutstanding } = resp.body;
    expect(totalOutstanding).toBe(0);
    for (const key of ["current", "1-30", "31-60", "61-90", "90+"]) {
      expect(buckets[key].total).toBe(0);
      expect(buckets[key].invoices).toHaveLength(0);
    }
  });

  it("routes an invoice due exactly 30 days ago into 1–30 bucket (boundary check)", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([makeInvoice(20, "150.00", 30)]),
    );

    const resp = await request(app)
      .get("/reports/aging-invoices")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.buckets["1-30"].total).toBe(150);
    expect(resp.body.buckets["31-60"].total).toBe(0);
  });

  it("routes an invoice due exactly 31 days ago into 31–60 bucket (boundary check)", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([makeInvoice(21, "175.00", 31)]),
    );

    const resp = await request(app)
      .get("/reports/aging-invoices")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.buckets["31-60"].total).toBe(175);
    expect(resp.body.buckets["1-30"].total).toBe(0);
  });
});

// ── Report E: Sales Tax Tracker ───────────────────────────────────────────────

describe("GET /reports/sales-tax", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    const { default: reportsRouter } = await import("./reports");
    app.use("/", reportsRouter);
  });

  it("computes effective tax rate and totals correctly across months", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([
        { month: "2024-01", taxable_revenue: 1000, tax_collected: 80 },  // 8%
        { month: "2024-02", taxable_revenue: 2000, tax_collected: 200 }, // 10%
        { month: "2024-03", taxable_revenue: 500,  tax_collected: 0 },   // 0% — no tax
      ]),
    );

    const resp = await request(app)
      .get("/reports/sales-tax?startDate=2024-01-01&endDate=2024-03-31")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    const { rows: monthly, totals } = resp.body;

    expect(monthly).toHaveLength(3);

    const jan = monthly.find((m: { month: string }) => m.month === "2024-01");
    expect(jan.taxableRevenue).toBe(1000);
    expect(jan.taxCollected).toBe(80);
    expect(jan.effectiveTaxRatePct).toBe(8);

    const feb = monthly.find((m: { month: string }) => m.month === "2024-02");
    expect(feb.effectiveTaxRatePct).toBe(10);

    // March: taxable_revenue=500 but no tax → 0%
    const mar = monthly.find((m: { month: string }) => m.month === "2024-03");
    expect(mar.taxCollected).toBe(0);
    expect(mar.effectiveTaxRatePct).toBe(0);

    expect(totals.taxableRevenue).toBe(3500);
    expect(totals.taxCollected).toBe(280);
  });

  it("returns zero totals for an empty date range", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows([]));

    const resp = await request(app)
      .get("/reports/sales-tax?startDate=2024-01-01&endDate=2024-01-01")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.rows).toHaveLength(0);
    expect(resp.body.totals.taxableRevenue).toBe(0);
    expect(resp.body.totals.taxCollected).toBe(0);
  });

  it("returns zero effective rate when taxable_revenue is zero (no divide-by-zero)", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows([{ month: "2024-06", taxable_revenue: 0, tax_collected: 0 }]),
    );

    const resp = await request(app)
      .get("/reports/sales-tax?startDate=2024-06-01&endDate=2024-06-30")
      .set(tenantHeaders());

    expect(resp.status).toBe(200);
    expect(resp.body.rows[0].effectiveTaxRatePct).toBe(0);
  });

  it("returns 400 for an invalid date format", async () => {
    const resp = await request(app)
      .get("/reports/sales-tax?startDate=not-a-date")
      .set(tenantHeaders());

    expect(resp.status).toBe(400);
    expect(resp.body.error).toMatch(/invalid/i);
  });
});
