import { processAcquisitionRewards } from "../lib/acquisitionRewards";
import { Router, type ErrorRequestHandler } from "express";
import { createHash } from "node:crypto";
import { db, payrollPeriodsTable, payrollAdjustmentsTable, usersTable, tenantsTable } from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { calculatePayrollJobs, calculatePayrollSummary, type PayrollDb } from "./p4p";
import { zonedDayBounds } from "./timeTracking";
import {
  PreviewFinalPayrollBody, PreviewFinalPayrollResponse, ApproveFinalPayrollBody, ApproveFinalPayrollResponse,
  ListFinalPayrollResponse, GetFinalPayrollResponse, AddFinalPayrollAdjustmentBody, AddFinalPayrollAdjustmentResponse,
} from "@workspace/api-zod";

export const payrollRouter = Router();
const approvers = new Set(["company_owner", "office_manager"]);
const readers = new Set([...approvers, "department_manager", "crew_manager"]);
const rangeInput = PreviewFinalPayrollBody;
async function resolveRange(tenantId: number, value: z.infer<typeof rangeInput>) {
  const [tenant] = await db.select({ timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const timezone = tenant?.timezone ?? "UTC";
  const from = zonedDayBounds(value.dateFrom, timezone);
  const to = zonedDayBounds(value.dateTo, timezone);
  if (!from || !to || +to.end <= +from.start || +to.end > Date.now() || +to.end - +from.start > 366 * 86400000) {
    throw Object.assign(new Error("Choose a completed period of no more than one year, in company time."), { status: 400 });
  }
  // zonedDayBounds returns an exclusive next-day boundary.
  return { rangeStart: from.start.toISOString(), rangeEnd: new Date(+to.end - 1).toISOString(), timezone, ...value };
}
const adjustmentInput = AddFinalPayrollAdjustmentBody.extend({
  userId: z.number().int().positive(),
  amount: z.number().finite().min(-1000000).max(1000000).refine(v => v !== 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-7, "Use a non-zero amount with at most two decimal places"),
  reason: z.string().trim().min(1).max(2000),
});

payrollRouter.use("/p4p/payroll", async (req, res, next) => {
  const [user] = await db.select().from(usersTable).where(and(
    eq(usersTable.id, getUserId(req)), eq(usersTable.tenantId, getTenantId(req)),
  ));
  if (!user || !readers.has(user.role) || (req.method !== "GET" && !approvers.has(user.role))) {
    res.status(403).json({ error: "Payroll approval and adjustments require an owner or office manager." });
    return;
  }
  res.locals.payrollActor = { id: user.id, name: user.name };
  next();
});

async function snapshot(connection: PayrollDb, tenantId: number, input: Awaited<ReturnType<typeof resolveRange>>) {
  const range = { rangeStart: new Date(input.rangeStart), rangeEnd: new Date(input.rangeEnd) };
  const open = await connection.execute(sql`
    SELECT id FROM time_entries WHERE tenant_id=${tenantId} AND is_master_clock=true
      AND COALESCE(adjusted_clocked_out_at, clocked_out_at) IS NULL
      AND COALESCE(adjusted_clocked_in_at, clocked_in_at) <= ${input.rangeEnd}::timestamptz
    UNION ALL
    SELECT st.id FROM sub_timers st JOIN jobs j ON j.id=st.job_id AND j.tenant_id=st.tenant_id
    WHERE st.tenant_id=${tenantId} AND st.is_active=true
      AND j.completed_at BETWEEN ${input.rangeStart}::timestamptz AND ${input.rangeEnd}::timestamptz
    LIMIT 1
  `);
  if (open.rows.length) throw Object.assign(new Error("Close outstanding clocks and job timers before approving this period."), { status: 409 });
  const summary = await calculatePayrollSummary(connection, tenantId, range);
  const jobs = await calculatePayrollJobs(connection, tenantId, range);
  return { version: 1, dateFrom: input.dateFrom, dateTo: input.dateTo, timezone: input.timezone, summary, jobs };
}
export type PayrollSnapshot = Awaited<ReturnType<typeof snapshot>>;
const digest = (value: PayrollSnapshot) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

payrollRouter.post("/p4p/payroll/preview", async (req, res): Promise<void> => {
  const parsed = rangeInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
  const range = await resolveRange(getTenantId(req), parsed.data);
  await processAcquisitionRewards(getTenantId(req));
  const data = await db.transaction(tx => snapshot(tx, getTenantId(req), range), { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(PreviewFinalPayrollResponse.parse({ snapshot: data, digest: digest(data) }));
});

payrollRouter.post("/p4p/payroll/periods", async (req, res): Promise<void> => {
  const parsed = ApproveFinalPayrollBody.safeParse(req.body);
  if (!parsed.success || typeof req.body.digest !== "string") {
    res.status(400).json({ error: "Review a valid completed payroll period before approving." }); return;
  }
  const tenantId = getTenantId(req);
  const range = await resolveRange(tenantId, parsed.data);
  try {
    await processAcquisitionRewards(tenantId);
    const period = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM tenants WHERE id=${tenantId} FOR NO KEY UPDATE`);
      const overlapping = await tx.execute(sql`
        SELECT id FROM payroll_periods WHERE tenant_id=${tenantId}
        AND range_start <= ${range.rangeEnd}::timestamptz
        AND range_end >= ${range.rangeStart}::timestamptz
      `);
      if (overlapping.rows.length) throw Object.assign(new Error("This range overlaps finalized payroll. Use an audited adjustment instead."), { status: 409 });
      const data = await snapshot(tx, tenantId, range);
      if (digest(data) !== req.body.digest) throw Object.assign(new Error("Payroll changed since review. Preview it again before approving."), { status: 409 });
      const missingGuarantee = data.summary.technicians.filter(t => t.clockHours > 0 && t.basePay == null);
      const reason = parsed.data.p4pOnlyReason?.trim();
      if (missingGuarantee.length && !reason) {
        throw Object.assign(new Error("Historical hourly rates are missing. To approve P4P-only pay for the flagged employees, provide an explicit reason."), { status: 400 });
      }
      const approvedSnapshot = {
        ...data,
        ...(missingGuarantee.length ? {
          p4pOnlyApproval: { reason: reason!, employeeIds: missingGuarantee.map(t => t.userId) },
        } : {}),
      };
      const [saved] = await tx.insert(payrollPeriodsTable).values({
        tenantId, rangeStart: new Date(range.rangeStart), rangeEnd: new Date(range.rangeEnd),
        approvedBy: res.locals.payrollActor.id, approvedByName: res.locals.payrollActor.name, snapshot: approvedSnapshot,
      }).returning();
      return saved;
    }, { isolationLevel: "serializable" });
    res.status(201).json(ApproveFinalPayrollResponse.parse(period));
  } catch (error: any) {
    if (error.code === "40001" || error.cause?.code === "40001") {
      res.status(409).json({ error: "Payroll was changed concurrently. Refresh and review again." }); return;
    }
    throw error;
  }
});

payrollRouter.get("/p4p/payroll/periods", async (req, res): Promise<void> => {
  const periods = await db.select({
    id: payrollPeriodsTable.id, rangeStart: payrollPeriodsTable.rangeStart, rangeEnd: payrollPeriodsTable.rangeEnd,
    dateFrom: sql<string>`${payrollPeriodsTable.snapshot}->>'dateFrom'`,
    dateTo: sql<string>`${payrollPeriodsTable.snapshot}->>'dateTo'`,
    timezone: sql<string>`${payrollPeriodsTable.snapshot}->>'timezone'`,
    approvedAt: payrollPeriodsTable.approvedAt, approvedByName: payrollPeriodsTable.approvedByName,
  }).from(payrollPeriodsTable).where(eq(payrollPeriodsTable.tenantId, getTenantId(req))).orderBy(desc(payrollPeriodsTable.rangeStart));
  res.json(ListFinalPayrollResponse.parse(periods));
});

payrollRouter.get("/p4p/payroll/periods/:id", async (req, res): Promise<void> => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid payroll period" }); return; }
  const tenantId = getTenantId(req);
  const [period] = await db.select().from(payrollPeriodsTable).where(and(eq(payrollPeriodsTable.tenantId, tenantId), eq(payrollPeriodsTable.id, id.data)));
  if (!period) { res.status(404).json({ error: "Payroll period not found" }); return; }
  const adjustments = await db.select().from(payrollAdjustmentsTable).where(and(
    eq(payrollAdjustmentsTable.tenantId, tenantId), eq(payrollAdjustmentsTable.periodId, id.data),
  )).orderBy(payrollAdjustmentsTable.id);
  res.json(GetFinalPayrollResponse.parse({ ...period, adjustments }));
});

payrollRouter.post("/p4p/payroll/periods/:id/adjustments", async (req, res): Promise<void> => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = adjustmentInput.safeParse(req.body);
  if (!id.success || !parsed.success) { res.status(400).json({ error: "Choose an employee, a non-zero signed amount (two decimals), and a reason." }); return; }
  const tenantId = getTenantId(req);
  const [period] = await db.select().from(payrollPeriodsTable).where(and(eq(payrollPeriodsTable.tenantId, tenantId), eq(payrollPeriodsTable.id, id.data)));
  if (!period) { res.status(404).json({ error: "Payroll period not found" }); return; }
  const data = period.snapshot as PayrollSnapshot;
  if (!data.summary.technicians.some(t => t.userId === parsed.data.userId)) {
    res.status(400).json({ error: "Employee must belong to this finalized payroll." }); return;
  }
  const [saved] = await db.insert(payrollAdjustmentsTable).values({
    ...parsed.data, tenantId, periodId: id.data,
    createdBy: res.locals.payrollActor.id, createdByName: res.locals.payrollActor.name,
  }).returning();
  res.status(201).json(AddFinalPayrollAdjustmentResponse.parse(saved));
});

const payrollErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error.status === 400 || error.status === 409) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
};
payrollRouter.use(payrollErrorHandler);
