/**
 * Business Reports Suite — job profitability, employee revenue, P&L, aging invoices,
 * and the sales tax tracker. All queries are tenant-scoped and cached for up to 1 hour
 * (see reportsCache.ts) to avoid re-running expensive aggregate queries on every page view.
 *
 * Cost/allocation assumptions:
 *   - Parts cost uses the marked-up sell price recorded on the job at completion time
 *     (jobs.job_parts[].total) — the same figure used elsewhere in the app (P4P engine).
 *   - Labor cost is the P4P payout pool: max(0, jobRevenue - partsCost) × p4pPct/100,
 *     using the job's blueprint override or the tenant's master P4P percentage.
 *   - Equipment fuel: when a fuel log has a job_id link the cost is attributed directly
 *     to that job. Unlinked fuel logs (job_id IS NULL) are split evenly across jobs in
 *     the range that have no directly-linked fuel. Jobs with linked fuel absorb no share
 *     of unlinked fuel, preserving a clean split between attributed and overhead fuel.
 */

import { Router, type IRouter } from "express";
import { db, tenantsTable, inventoryItemsTable, inventorySuppliersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { getCachedReport } from "../lib/reportsCache";

const router: IRouter = Router();

function requireAdmin(tenantId: number, userId: number, res: import("express").Response): Promise<boolean> {
  return isAdminRole(tenantId, userId).then(ok => {
    if (!ok) res.status(403).json({ error: "Reports are restricted to owner/admin roles" });
    return ok;
  });
}

function parseDateRange(query: Record<string, string>): { startDate: Date; endDate: Date } {
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const startDate = query.startDate ? new Date(query.startDate) : defaultStart;
  const endDate = query.endDate ? new Date(`${query.endDate}T23:59:59.999`) : now;
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("startDate/endDate must be valid dates (YYYY-MM-DD)");
  }
  return { startDate, endDate };
}

/** Parses startDate/endDate from the query, sending a 400 and returning null if invalid. */
function tryParseDateRange(query: Record<string, string>, res: import("express").Response): { startDate: Date; endDate: Date } | null {
  try {
    return parseDateRange(query);
  } catch {
    res.status(400).json({ error: "Invalid startDate/endDate — expected format YYYY-MM-DD" });
    return null;
  }
}

async function getTenantP4pPct(tenantId: number): Promise<number> {
  const [tenant] = await db.select({ p4pMasterPercentage: tenantsTable.p4pMasterPercentage }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  return tenant?.p4pMasterPercentage ?? 0;
}

// ── Report A: Job Profitability ───────────────────────────────────────────────
router.get("/reports/job-profitability", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await requireAdmin(tenantId, userId, res))) return;

  const q = req.query as Record<string, string>;
  const range = tryParseDateRange(q, res);
  if (!range) return;
  const { startDate, endDate } = range;
  const crewId = q.crewId ? parseInt(q.crewId, 10) : null;
  const assigneeId = q.assigneeId ? parseInt(q.assigneeId, 10) : null;
  const propertyId = q.propertyId ? parseInt(q.propertyId, 10) : null;

  const { data, generatedAt, cached } = await getCachedReport(tenantId, "job-profitability", { ...q }, async () => {
    const globalPct = await getTenantP4pPct(tenantId);

    const rows = await db.execute(sql`
      SELECT
        j.id, j.title, j.completed_at, j.crew_id, j.assignee_id, j.property_id,
        j.total_amount,
        COALESCE((SELECT SUM((part->>'total')::numeric) FROM jsonb_array_elements(COALESCE(j.job_parts, '[]'::jsonb)) AS part), 0) AS parts_cost,
        b.p4p_percentage AS blueprint_p4p_pct,
        i.total AS invoice_total,
        cr.name AS crew_name,
        u.name AS assignee_name,
        p.address AS property_address,
        c.name AS customer_name
      FROM jobs j
      LEFT JOIN blueprints b ON b.id = j.blueprint_id AND b.tenant_id = j.tenant_id
      LEFT JOIN invoices i ON i.job_id = j.id AND i.tenant_id = j.tenant_id
      LEFT JOIN crews cr ON cr.id = j.crew_id AND cr.tenant_id = j.tenant_id
      LEFT JOIN users u ON u.id = j.assignee_id AND u.tenant_id = j.tenant_id
      LEFT JOIN properties p ON p.id = j.property_id AND p.tenant_id = j.tenant_id
      LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
      WHERE j.tenant_id = ${tenantId}
        AND j.status = 'completed'
        AND j.completed_at >= ${startDate.toISOString()}::timestamptz
        AND j.completed_at <= ${endDate.toISOString()}::timestamptz
        ${crewId != null ? sql`AND j.crew_id = ${crewId}` : sql``}
        ${assigneeId != null ? sql`AND j.assignee_id = ${assigneeId}` : sql``}
        ${propertyId != null ? sql`AND j.property_id = ${propertyId}` : sql``}
      ORDER BY j.completed_at DESC
    `);

    type Row = {
      id: number; title: string; completed_at: string; crew_id: number | null; assignee_id: number | null; property_id: number | null;
      total_amount: string; parts_cost: string; blueprint_p4p_pct: number | null; invoice_total: string | null;
      crew_name: string | null; assignee_name: string | null; property_address: string | null; customer_name: string | null;
    };
    const jobs = (rows.rows as Row[]);

    // Fuel allocation: linked logs go directly to their job; unlinked logs are
    // split evenly across jobs that have no linked fuel (see module doc).
    const fuelByJobRows = (await db.execute(sql`
      SELECT job_id, COALESCE(SUM(cost), 0)::float AS total
      FROM equipment_fuel_logs
      WHERE tenant_id = ${tenantId}
        AND date >= ${startDate.toISOString().slice(0, 10)}
        AND date <= ${endDate.toISOString().slice(0, 10)}
      GROUP BY job_id
    `)).rows as { job_id: number | null; total: number }[];

    // Build per-job fuel map (for linked logs) and collect unlinked total.
    // Fuel linked to a job NOT in this report's result set (e.g. job outside date range
    // or filtered out) is folded into the unlinked pool so no cost is silently dropped.
    const jobIdSet = new Set(jobs.map(j => j.id));
    const linkedFuelByJob = new Map<number, number>();
    let unlinkedFuelTotal = 0;
    for (const row of fuelByJobRows) {
      if (row.job_id != null && jobIdSet.has(row.job_id)) {
        linkedFuelByJob.set(row.job_id, Number(row.total));
      } else {
        // null job_id = fleet overhead; non-null but not in result set = out-of-range job
        unlinkedFuelTotal += Number(row.total);
      }
    }

    // Jobs with no directly-linked fuel share the unlinked overhead evenly
    const jobsWithNoLinkedFuel = jobs.filter(j => !linkedFuelByJob.has(j.id));
    const unlinkedFuelPerJob = jobsWithNoLinkedFuel.length > 0 ? unlinkedFuelTotal / jobsWithNoLinkedFuel.length : 0;

    const results = jobs.map(j => {
      const revenue = j.invoice_total != null ? Number(j.invoice_total) : Number(j.total_amount ?? 0);
      const partsCost = Math.round(Number(j.parts_cost ?? 0) * 100) / 100;
      const p4pPct = j.blueprint_p4p_pct != null ? Number(j.blueprint_p4p_pct) : globalPct;
      const netLaborRevenue = Math.max(0, revenue - partsCost);
      const laborCost = Math.round((netLaborRevenue * p4pPct / 100) * 100) / 100;
      const fuelIsLinked = linkedFuelByJob.has(j.id);
      const rawFuelCost = fuelIsLinked ? linkedFuelByJob.get(j.id)! : unlinkedFuelPerJob;
      const fuelCost = Math.round(rawFuelCost * 100) / 100;
      const netProfit = Math.round((revenue - partsCost - laborCost - fuelCost) * 100) / 100;
      const marginPct = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0;
      return {
        jobId: j.id,
        jobTitle: j.title,
        customerName: j.customer_name,
        completedAt: j.completed_at,
        crewId: j.crew_id,
        crewName: j.crew_name,
        assigneeId: j.assignee_id,
        assigneeName: j.assignee_name,
        propertyId: j.property_id,
        propertyAddress: j.property_address,
        revenue: Math.round(revenue * 100) / 100,
        partsCost,
        laborCost,
        fuelCost,
        fuelCostSource: fuelIsLinked ? 'actual' : 'estimated',
        netProfit,
        marginPct,
      };
    }).sort((a, b) => b.marginPct - a.marginPct);

    return {
      rows: results,
      totals: {
        revenue: Math.round(results.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
        partsCost: Math.round(results.reduce((s, r) => s + r.partsCost, 0) * 100) / 100,
        laborCost: Math.round(results.reduce((s, r) => s + r.laborCost, 0) * 100) / 100,
        fuelCost: Math.round(results.reduce((s, r) => s + r.fuelCost, 0) * 100) / 100,
        netProfit: Math.round(results.reduce((s, r) => s + r.netProfit, 0) * 100) / 100,
      },
    };
  });

  res.json({ ...data, generatedAt, cached, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
});

// ── Report B: Employee Revenue ────────────────────────────────────────────────
router.get("/reports/employee-revenue", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await requireAdmin(tenantId, userId, res))) return;

  const q = req.query as Record<string, string>;
  const range = tryParseDateRange(q, res);
  if (!range) return;
  const { startDate, endDate } = range;

  const { data, generatedAt, cached } = await getCachedReport(tenantId, "employee-revenue", { ...q }, async () => {
    const globalPct = await getTenantP4pPct(tenantId);

    const rows = await db.execute(sql`
      SELECT
        j.assignee_id, u.name AS assignee_name,
        j.total_amount,
        COALESCE((SELECT SUM((part->>'total')::numeric) FROM jsonb_array_elements(COALESCE(j.job_parts, '[]'::jsonb)) AS part), 0) AS parts_cost,
        b.p4p_percentage AS blueprint_p4p_pct,
        i.total AS invoice_total
      FROM jobs j
      LEFT JOIN blueprints b ON b.id = j.blueprint_id AND b.tenant_id = j.tenant_id
      LEFT JOIN invoices i ON i.job_id = j.id AND i.tenant_id = j.tenant_id
      LEFT JOIN users u ON u.id = j.assignee_id AND u.tenant_id = j.tenant_id
      WHERE j.tenant_id = ${tenantId}
        AND j.status = 'completed'
        AND j.assignee_id IS NOT NULL
        AND j.completed_at >= ${startDate.toISOString()}::timestamptz
        AND j.completed_at <= ${endDate.toISOString()}::timestamptz
    `);

    type Row = {
      assignee_id: number; assignee_name: string | null; total_amount: string; parts_cost: string;
      blueprint_p4p_pct: number | null; invoice_total: string | null;
    };
    const jobs = rows.rows as Row[];

    const byTech = new Map<number, { name: string; revenue: number; p4pEarnings: number; jobCount: number }>();
    for (const j of jobs) {
      const revenue = j.invoice_total != null ? Number(j.invoice_total) : Number(j.total_amount ?? 0);
      const partsCost = Number(j.parts_cost ?? 0);
      const p4pPct = j.blueprint_p4p_pct != null ? Number(j.blueprint_p4p_pct) : globalPct;
      const netLaborRevenue = Math.max(0, revenue - partsCost);
      const earnings = netLaborRevenue * p4pPct / 100;
      const prev = byTech.get(j.assignee_id) ?? { name: j.assignee_name ?? `User ${j.assignee_id}`, revenue: 0, p4pEarnings: 0, jobCount: 0 };
      byTech.set(j.assignee_id, {
        name: prev.name,
        revenue: prev.revenue + revenue,
        p4pEarnings: prev.p4pEarnings + earnings,
        jobCount: prev.jobCount + 1,
      });
    }

    const results = Array.from(byTech.entries()).map(([id, stats]) => ({
      userId: id,
      name: stats.name,
      jobCount: stats.jobCount,
      totalRevenue: Math.round(stats.revenue * 100) / 100,
      averageJobValue: stats.jobCount > 0 ? Math.round((stats.revenue / stats.jobCount) * 100) / 100 : 0,
      totalP4pEarnings: Math.round(stats.p4pEarnings * 100) / 100,
      p4pToRevenueRatioPct: stats.revenue > 0 ? Math.round((stats.p4pEarnings / stats.revenue) * 1000) / 10 : 0,
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);

    return { rows: results };
  });

  res.json({ ...data, generatedAt, cached, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
});

// ── Report C: P&L Statement ───────────────────────────────────────────────────
router.get("/reports/pl-statement", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await requireAdmin(tenantId, userId, res))) return;

  const q = req.query as Record<string, string>;
  const range = tryParseDateRange(q, res);
  if (!range) return;
  const { startDate, endDate } = range;

  const { data, generatedAt, cached } = await getCachedReport(tenantId, "pl-statement", { ...q }, async () => {
    const globalPct = await getTenantP4pPct(tenantId);

    // Revenue is recognized on paid invoices; COGS is derived from the jobs those invoices bill.
    const rows = await db.execute(sql`
      SELECT
        i.id AS invoice_id, i.total AS invoice_total, i.subtotal, i.tax,
        j.total_amount,
        COALESCE((SELECT SUM((part->>'total')::numeric) FROM jsonb_array_elements(COALESCE(j.job_parts, '[]'::jsonb)) AS part), 0) AS parts_cost,
        b.p4p_percentage AS blueprint_p4p_pct
      FROM invoices i
      LEFT JOIN jobs j ON j.id = i.job_id AND j.tenant_id = i.tenant_id
      LEFT JOIN blueprints b ON b.id = j.blueprint_id AND b.tenant_id = j.tenant_id
      WHERE i.tenant_id = ${tenantId}
        AND i.status = 'paid'
        AND i.paid_at >= ${startDate.toISOString()}::timestamptz
        AND i.paid_at <= ${endDate.toISOString()}::timestamptz
    `);

    type Row = { invoice_id: number; invoice_total: string; subtotal: string; tax: string; total_amount: string | null; parts_cost: string | null; blueprint_p4p_pct: number | null };
    const invoiceRows = rows.rows as Row[];

    let revenue = 0, partsCost = 0, laborCost = 0;
    for (const r of invoiceRows) {
      const total = Number(r.invoice_total ?? 0);
      revenue += total;
      const parts = Number(r.parts_cost ?? 0);
      partsCost += parts;
      const p4pPct = r.blueprint_p4p_pct != null ? Number(r.blueprint_p4p_pct) : globalPct;
      const netLaborRevenue = Math.max(0, total - parts);
      laborCost += netLaborRevenue * p4pPct / 100;
    }

    const fuelAggRows = (await db.execute(sql`
      SELECT COALESCE(SUM(cost), 0)::float AS total FROM equipment_fuel_logs
      WHERE tenant_id = ${tenantId} AND date >= ${startDate.toISOString().slice(0, 10)} AND date <= ${endDate.toISOString().slice(0, 10)}
    `)).rows as { total: number }[];
    const fuelCost = fuelAggRows[0] ? Number(fuelAggRows[0].total) : 0;

    const expenseAggRows = (await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::float AS total FROM expense_entries
      WHERE tenant_id = ${tenantId} AND date >= ${startDate.toISOString().slice(0, 10)} AND date <= ${endDate.toISOString().slice(0, 10)}
    `)).rows as { total: number }[];
    const operatingExpenses = expenseAggRows[0] ? Number(expenseAggRows[0].total) : 0;

    const costOfGoodsSold = Math.round((partsCost + laborCost + fuelCost) * 100) / 100;
    const grossProfit = Math.round((revenue - costOfGoodsSold) * 100) / 100;
    const netIncome = Math.round((grossProfit - operatingExpenses) * 100) / 100;

    // Expense breakdown by category for the operating expenses section
    const expenseByCategory = (await db.execute(sql`
      SELECT category, COALESCE(SUM(amount), 0)::float AS total FROM expense_entries
      WHERE tenant_id = ${tenantId} AND date >= ${startDate.toISOString().slice(0, 10)} AND date <= ${endDate.toISOString().slice(0, 10)}
      GROUP BY category ORDER BY total DESC
    `)).rows as { category: string; total: number }[];

    return {
      revenue: Math.round(revenue * 100) / 100,
      costOfGoodsSold: {
        partsCost: Math.round(partsCost * 100) / 100,
        laborCost: Math.round(laborCost * 100) / 100,
        fuelCost: Math.round(fuelCost * 100) / 100,
        total: costOfGoodsSold,
      },
      grossProfit,
      operatingExpenses: {
        total: Math.round(operatingExpenses * 100) / 100,
        byCategory: expenseByCategory.map(e => ({ category: e.category, amount: Math.round(Number(e.total) * 100) / 100 })),
      },
      netIncome,
    };
  });

  res.json({ ...data, generatedAt, cached, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
});

// ── Report D: Aging Invoices ──────────────────────────────────────────────────
router.get("/reports/aging-invoices", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await requireAdmin(tenantId, userId, res))) return;

  const { data, generatedAt, cached } = await getCachedReport(tenantId, "aging-invoices", {}, async () => {
    const rows = await db.execute(sql`
      SELECT i.id, i.invoice_number, i.total, i.due_date, i.status, c.name AS customer_name, i.created_at
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
      WHERE i.tenant_id = ${tenantId}
        AND i.status IN ('sent', 'overdue')
      ORDER BY i.due_date ASC NULLS LAST
    `);

    type Row = { id: number; invoice_number: string; total: string; due_date: string | null; status: string; customer_name: string | null; created_at: string };
    const invoices = rows.rows as Row[];
    const now = Date.now();

    const buckets: Record<string, { label: string; total: number; invoices: unknown[] }> = {
      current: { label: "Current", total: 0, invoices: [] },
      "1-30": { label: "1–30 days overdue", total: 0, invoices: [] },
      "31-60": { label: "31–60 days overdue", total: 0, invoices: [] },
      "61-90": { label: "61–90 days overdue", total: 0, invoices: [] },
      "90+": { label: "90+ days overdue", total: 0, invoices: [] },
    };

    for (const inv of invoices) {
      const total = Number(inv.total ?? 0);
      const daysOverdue = inv.due_date ? Math.floor((now - new Date(inv.due_date).getTime()) / 86400000) : -1;
      let bucket: keyof typeof buckets;
      if (daysOverdue <= 0) bucket = "current";
      else if (daysOverdue <= 30) bucket = "1-30";
      else if (daysOverdue <= 60) bucket = "31-60";
      else if (daysOverdue <= 90) bucket = "61-90";
      else bucket = "90+";

      buckets[bucket].total = Math.round((buckets[bucket].total + total) * 100) / 100;
      buckets[bucket].invoices.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        customerName: inv.customer_name,
        total: Math.round(total * 100) / 100,
        dueDate: inv.due_date,
        status: inv.status,
        daysOverdue: Math.max(0, daysOverdue),
      });
    }

    const totalOutstanding = Math.round(invoices.reduce((s, i) => s + Number(i.total ?? 0), 0) * 100) / 100;

    return { buckets, totalOutstanding };
  });

  res.json({ ...data, generatedAt, cached });
});

// ── Report E: Sales Tax Tracker ───────────────────────────────────────────────
router.get("/reports/sales-tax", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await requireAdmin(tenantId, userId, res))) return;

  const q = req.query as Record<string, string>;
  const range = tryParseDateRange(q, res);
  if (!range) return;
  const { startDate, endDate } = range;

  const { data, generatedAt, cached } = await getCachedReport(tenantId, "sales-tax", { ...q }, async () => {
    const rows = await db.execute(sql`
      SELECT
        to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month,
        COALESCE(SUM(subtotal), 0)::float AS taxable_revenue,
        COALESCE(SUM(tax), 0)::float AS tax_collected
      FROM invoices
      WHERE tenant_id = ${tenantId}
        AND status = 'paid'
        AND paid_at >= ${startDate.toISOString()}::timestamptz
        AND paid_at <= ${endDate.toISOString()}::timestamptz
      GROUP BY date_trunc('month', paid_at)
      ORDER BY date_trunc('month', paid_at) ASC
    `);

    type Row = { month: string; taxable_revenue: number; tax_collected: number };
    const monthly = (rows.rows as Row[]).map(r => {
      const taxableRevenue = Math.round(Number(r.taxable_revenue) * 100) / 100;
      const taxCollected = Math.round(Number(r.tax_collected) * 100) / 100;
      return {
        month: r.month,
        taxableRevenue,
        taxCollected,
        effectiveTaxRatePct: taxableRevenue > 0 ? Math.round((taxCollected / taxableRevenue) * 1000) / 10 : 0,
      };
    });

    return {
      rows: monthly,
      totals: {
        taxableRevenue: Math.round(monthly.reduce((s, m) => s + m.taxableRevenue, 0) * 100) / 100,
        taxCollected: Math.round(monthly.reduce((s, m) => s + m.taxCollected, 0) * 100) / 100,
      },
    };
  });

  res.json({ ...data, generatedAt, cached, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
});

// ── Report F: Inventory Sales ─────────────────────────────────────────────────
router.get("/reports/inventory-sales", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await requireAdmin(tenantId, userId, res))) return;

  const q = req.query as Record<string, string>;
  const range = tryParseDateRange(q, res);
  if (!range) return;
  const { startDate, endDate } = range;

  const { data, generatedAt, cached } = await getCachedReport(tenantId, "inventory-sales", { ...q }, async () => {
    // Aggregate job_parts across completed jobs in the date range.
    // job_parts shape: [{inventoryItemId, name, quantity, unitPrice (sell), total}]
    // We look up cost price (unitPrice in DB) from inventory_items to compute margin.
    const jobRows = await db.execute(sql`
      SELECT
        j.job_parts,
        j.assignee_id,
        u.name AS assignee_name,
        cr.name AS crew_name,
        j.completed_at
      FROM jobs j
      LEFT JOIN users u ON u.id = j.assignee_id AND u.tenant_id = j.tenant_id
      LEFT JOIN crews cr ON cr.id = j.crew_id AND cr.tenant_id = j.tenant_id
      WHERE j.tenant_id = ${tenantId}
        AND j.status = 'completed'
        AND j.completed_at >= ${startDate.toISOString()}::timestamptz
        AND j.completed_at <= ${endDate.toISOString()}::timestamptz
        AND j.job_parts IS NOT NULL
        AND jsonb_array_length(j.job_parts) > 0
    `);

    type JobRow = {
      job_parts: Array<{ inventoryItemId?: number; name?: string; quantity?: number; unitPrice?: number; total?: number }>;
      assignee_id: number | null;
      assignee_name: string | null;
      crew_name: string | null;
      completed_at: string;
    };

    const jobs = jobRows.rows as JobRow[];

    // Pull all inventory items for this tenant to get cost prices and commissionPct.
    const inventoryItems = await db
      .select({
        id: inventoryItemsTable.id,
        unitPrice: inventoryItemsTable.unitPrice,   // cost/buy price
        commissionPct: inventoryItemsTable.commissionPct,
        quantity: inventoryItemsTable.quantity,
        sku: inventoryItemsTable.sku,
        category: inventoryItemsTable.category,
      })
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.tenantId, tenantId));

    const itemMeta = new Map(inventoryItems.map(i => [i.id, i]));

    // Aggregate by (inventoryItemId, salesperson) so each salesperson's sales of
    // the same item are counted separately — commission is per-person, not per-item.
    type Agg = {
      itemName: string;
      sku: string;
      category: string | null;
      unitsSold: number;
      totalRevenue: number;
      totalCost: number;
      commissionPct: number;
      salespersonName: string | null;
      inventoryItemId: number;
    };
    // Key: `${inventoryItemId}::${salesperson ?? '__none__'}`
    const agg = new Map<string, Agg>();

    for (const job of jobs) {
      const salesperson = job.assignee_name ?? job.crew_name ?? null;
      const salespersonKey = salesperson ?? '__none__';
      for (const part of (job.job_parts ?? [])) {
        if (!part.inventoryItemId) continue;
        const itemId = part.inventoryItemId;
        const aggKey = `${itemId}::${salespersonKey}`;
        const qty = Number(part.quantity ?? 0);
        const sellTotal = Number(part.total ?? 0);
        const meta = itemMeta.get(itemId);
        const costPerUnit = meta?.unitPrice ?? 0;  // DB unitPrice = buy price
        const costTotal = costPerUnit * qty;
        const commPct = meta?.commissionPct ?? 0;

        const existing = agg.get(aggKey);
        if (existing) {
          existing.unitsSold += qty;
          existing.totalRevenue += sellTotal;
          existing.totalCost += costTotal;
        } else {
          agg.set(aggKey, {
            inventoryItemId: itemId,
            itemName: part.name ?? `Item #${itemId}`,
            sku: meta?.sku ?? '',
            category: meta?.category ?? null,
            unitsSold: qty,
            totalRevenue: sellTotal,
            totalCost: costTotal,
            commissionPct: commPct,
            salespersonName: salesperson,
          });
        }
      }
    }

    const rows = Array.from(agg.values()).map(r => {
      const grossMargin = Math.round((r.totalRevenue - r.totalCost) * 100) / 100;
      const commissionEarned = Math.round(grossMargin * (r.commissionPct / 100) * 100) / 100;
      const currentStock = itemMeta.get(r.inventoryItemId)?.quantity ?? 0;
      const sellPricePerUnit = r.unitsSold > 0 ? Math.round((r.totalRevenue / r.unitsSold) * 100) / 100 : 0;
      return {
        inventoryItemId: r.inventoryItemId,
        itemName: r.itemName,
        sku: r.sku,
        category: r.category,
        unitsSold: Math.round(r.unitsSold * 100) / 100,
        sellPricePerUnit,
        totalRevenue: Math.round(r.totalRevenue * 100) / 100,
        totalCost: Math.round(r.totalCost * 100) / 100,
        grossMargin,
        commissionPct: r.commissionPct,
        commissionEarned,
        currentStock,
        salespersonName: r.salespersonName,
      };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totals = {
      unitsSold: Math.round(rows.reduce((s, r) => s + r.unitsSold, 0) * 100) / 100,
      totalRevenue: Math.round(rows.reduce((s, r) => s + r.totalRevenue, 0) * 100) / 100,
      totalCost: Math.round(rows.reduce((s, r) => s + r.totalCost, 0) * 100) / 100,
      grossMargin: Math.round(rows.reduce((s, r) => s + r.grossMargin, 0) * 100) / 100,
      commissionEarned: Math.round(rows.reduce((s, r) => s + r.commissionEarned, 0) * 100) / 100,
    };

    return { rows, totals };
  });

  res.json({ ...data, generatedAt, cached, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
});

// ── Reorder List Report ────────────────────────────────────────────────────────

router.get("/reports/inventory-reorder-list", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await requireAdmin(tenantId, userId, res))) return;

  // Fetch all low-stock items and join their suppliers
  const lowItems = await db
    .select({
      id: inventoryItemsTable.id,
      name: inventoryItemsTable.name,
      sku: inventoryItemsTable.sku,
      quantity: inventoryItemsTable.quantity,
      reorderPoint: inventoryItemsTable.reorderPoint,
      unit: inventoryItemsTable.unit,
      unitPrice: inventoryItemsTable.unitPrice,
      category: inventoryItemsTable.category,
      supplierId: inventoryItemsTable.supplierId,
      supplierName: inventorySuppliersTable.name,
      supplierContact: inventorySuppliersTable.contact,
      supplierAccountNumber: inventorySuppliersTable.accountNumber,
    })
    .from(inventoryItemsTable)
    .leftJoin(inventorySuppliersTable, and(
      eq(inventorySuppliersTable.id, inventoryItemsTable.supplierId!),
      eq(inventorySuppliersTable.tenantId, tenantId),
    ))
    .where(and(
      eq(inventoryItemsTable.tenantId, tenantId),
      eq(inventoryItemsTable.isLowStock, true),
    ))
    .orderBy(inventoryItemsTable.name);

  // Group by supplier (null supplier = "No Supplier Assigned")
  type GroupKey = string; // supplierId or 'none'
  const groupMap = new Map<GroupKey, {
    supplierId: number | null;
    supplierName: string;
    contact: string | null;
    accountNumber: string | null;
    items: typeof lowItems;
  }>();

  for (const item of lowItems) {
    const key: GroupKey = item.supplierId ? String(item.supplierId) : 'none';
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        supplierId: item.supplierId ?? null,
        supplierName: item.supplierName ?? 'No Supplier Assigned',
        contact: item.supplierContact ?? null,
        accountNumber: item.supplierAccountNumber ?? null,
        items: [],
      });
    }
    groupMap.get(key)!.items.push(item);
  }

  // Sort groups: named suppliers first (alphabetically), "no supplier" last
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.supplierId === null && b.supplierId !== null) return 1;
    if (a.supplierId !== null && b.supplierId === null) return -1;
    return a.supplierName.localeCompare(b.supplierName);
  }).map(g => ({
    supplierId: g.supplierId,
    supplierName: g.supplierName,
    contact: g.contact,
    accountNumber: g.accountNumber,
    items: g.items.map(i => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      quantity: i.quantity,
      reorderPoint: i.reorderPoint,
      unit: i.unit,
      costPrice: i.unitPrice,
      category: i.category ?? null,
    })),
  }));

  res.json({
    groups,
    totalItems: lowItems.length,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
