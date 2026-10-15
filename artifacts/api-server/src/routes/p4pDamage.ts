import { Router, type ErrorRequestHandler } from "express";
import { db, usersTable, jobsTable, tenantsTable, p4pDamageReportsTable } from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CreateP4pDamageReportBody as P4pDamageInput, DecideP4pDamageReportBody as P4pDamageDecision, ListP4pDamageReportsResponse,
  CreateP4pDamageReportResponse,
} from "@workspace/api-zod";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { calendarDate, hrAccess } from "../lib/hrAccess";

export const p4pDamageRouter = Router();
const managers = new Set(["company_owner", "office_manager"]);
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const money = z.number().finite().min(0).max(1000000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-7, "Amounts must have at most two decimals");
const input = P4pDamageInput.extend({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  jobId: z.number().int().positive().nullable().optional(),
  allocations: z.array(z.object({ userId: z.number().int().positive(), amount: money })).min(1).max(100),
});
const decision = P4pDamageDecision.extend({ reason: z.string().trim().min(1).max(2000) });
const idInput = z.coerce.number().int().positive();
type Report = typeof p4pDamageReportsTable.$inferSelect;
const publicReport = (r: Report) => CreateP4pDamageReportResponse.parse({
  ...r, createdAt: r.createdAt.toISOString(),
  approvedAt: r.approvedAt?.toISOString() ?? null, voidedAt: r.voidedAt?.toISOString() ?? null,
});

p4pDamageRouter.use("/p4p/damage-reports", async (req, res, next) => {
  const [actor] = await db.select().from(usersTable).where(and(
    eq(usersTable.tenantId, getTenantId(req)), eq(usersTable.id, getUserId(req)),
  ));
  if (!actor || actor.isActive === false) { res.status(403).json({ error: "Active staff access required." }); return; }
  if (req.method !== "GET" && !managers.has(actor.role)) {
    res.status(403).json({ error: "Only an owner or office manager can manage P4P damage reports." }); return;
  }
  res.locals.damageActor = actor;
  next();
});

p4pDamageRouter.get("/p4p/damage-reports", async (req, res) => {
  const tenantId = getTenantId(req);
  const actor = res.locals.damageActor as typeof usersTable.$inferSelect;
  const canReadAll = managers.has(actor.role) || (await hrAccess(tenantId, actor.id)).hasHrAccess;
  const rows = await db.select().from(p4pDamageReportsTable)
    .where(eq(p4pDamageReportsTable.tenantId, tenantId)).orderBy(desc(p4pDamageReportsTable.createdAt), desc(p4pDamageReportsTable.id));
  const visible = canReadAll ? rows : rows.filter(r => r.allocations.some(a => a.userId === actor.id))
    .map(r => ({ ...r, allocations: r.allocations.filter(a => a.userId === actor.id) }));
  res.json(ListP4pDamageReportsResponse.parse(visible.map(publicReport)));
});

// All writers share payroll's tenant lock. Approval, voiding and finalization
// cannot race each other into an unreviewed or duplicated deduction.
async function validatedInput(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tenantId: number, raw: unknown) {
  const value = input.parse(raw);
  calendarDate(value.occurredOn, false);
  calendarDate(value.payrollDate, false);
  const ids = value.allocations.map(a => a.userId);
  if (new Set(ids).size !== ids.length) fail("Assign each employee only once.");
  if (value.allocations.reduce((sum, a) => sum + Math.round(a.amount * 100), 0) > 100000000) fail("Total allocation exceeds the allowed amount.");
  const employees = await tx.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.tenantId, tenantId));
  const names = new Map(employees.map(u => [u.id, u.name]));
  if (ids.some(id => !names.has(id))) fail("Every assigned employee must belong to this company.");
  if (value.jobId != null) {
    const [job] = await tx.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.id, value.jobId)));
    if (!job) fail("Job does not belong to this company.");
  }
  return { ...value, jobId: value.jobId ?? null, allocations: value.allocations.map(a => ({ ...a, employeeName: names.get(a.userId)! })) };
}

p4pDamageRouter.post("/p4p/damage-reports", async (req, res) => {
  const tenantId = getTenantId(req);
  const actor = res.locals.damageActor as typeof usersTable.$inferSelect;
  const saved = await db.transaction(async tx => {
    await tx.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).for("no key update");
    const value = await validatedInput(tx, tenantId, req.body);
    const [report] = await tx.insert(p4pDamageReportsTable).values({
      ...value, tenantId, createdBy: actor.id, createdByName: actor.name,
    }).returning();
    return report;
  });
  res.status(201).json(publicReport(saved));
});

p4pDamageRouter.patch("/p4p/damage-reports/:id", async (req, res) => {
  const tenantId = getTenantId(req);
  const id = idInput.parse(req.params.id);
  const saved = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM tenants WHERE id=${tenantId} FOR NO KEY UPDATE`);
    const [report] = await tx.select().from(p4pDamageReportsTable).where(and(eq(p4pDamageReportsTable.tenantId, tenantId), eq(p4pDamageReportsTable.id, id)));
    if (!report) fail("Damage report not found.", 404);
    if (report.status !== "pending" || report.payrollPeriodId != null) fail("Only pending reports can be edited.", 409);
    const v = await validatedInput(tx, tenantId, req.body);
    // Explicit JSON serialization avoids ORM compatibility issues with newly
    // introduced jsonb columns and preserves employee-name snapshots.
    await tx.execute(sql`UPDATE p4p_damage_reports SET title=${v.title},description=${v.description},
      occurred_on=${v.occurredOn}::date,payroll_date=${v.payrollDate}::date,job_id=${v.jobId},
      allocations=${JSON.stringify(v.allocations)}::jsonb WHERE tenant_id=${tenantId} AND id=${id}`);
    return (await tx.select().from(p4pDamageReportsTable).where(and(eq(p4pDamageReportsTable.tenantId, tenantId), eq(p4pDamageReportsTable.id, id))))[0];
  });
  res.json(publicReport(saved));
});

p4pDamageRouter.post("/p4p/damage-reports/:id/decision", async (req, res) => {
  const tenantId = getTenantId(req);
  const id = idInput.parse(req.params.id);
  const value = decision.parse(req.body);
  const actor = res.locals.damageActor as typeof usersTable.$inferSelect;
  const saved = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM tenants WHERE id=${tenantId} FOR NO KEY UPDATE`);
    const [report] = await tx.select().from(p4pDamageReportsTable).where(and(eq(p4pDamageReportsTable.tenantId, tenantId), eq(p4pDamageReportsTable.id, id)));
    if (!report) fail("Damage report not found.", 404);
    if (report.payrollPeriodId != null) fail("This report belongs to finalized payroll. Use a separately audited payroll correction.", 409);
    if (report.status === "void") fail("This report was already voided.", 409);
    if (value.action === "approve") {
      if (report.status !== "pending") fail("This report was already approved.", 409);
      await validatedInput(tx, tenantId, report);
      if (!report.allocations.length || report.allocations.every(a => a.amount === 0)) fail("Assign a positive amount before approval.");
      const closed = await tx.execute(sql`SELECT id FROM payroll_periods WHERE tenant_id=${tenantId}
        AND snapshot->>'dateFrom' <= ${report.payrollDate} AND snapshot->>'dateTo' >= ${report.payrollDate} LIMIT 1`);
      if (closed.rows.length) fail("This payroll date is finalized. Choose an open payroll date or use a separate payroll correction.", 409);
      return (await tx.update(p4pDamageReportsTable).set({
        status: "approved", approvedBy: actor.id, approvedByName: actor.name,
        approvedAt: new Date(), decisionReason: value.reason,
      }).where(and(eq(p4pDamageReportsTable.tenantId, tenantId), eq(p4pDamageReportsTable.id, id))).returning())[0];
    }
    return (await tx.update(p4pDamageReportsTable).set({
      status: "void", voidedBy: actor.id, voidedByName: actor.name, voidedAt: new Date(), voidReason: value.reason,
    }).where(and(eq(p4pDamageReportsTable.tenantId, tenantId), eq(p4pDamageReportsTable.id, id))).returning())[0];
  });
  res.json(publicReport(saved));
});

const errors: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0].message }); return; }
  if (error.status) { res.status(error.status).json({ error: error.message }); return; }
  if (error.code === "40001" || error.cause?.code === "40001") {
    res.status(409).json({ error: "Payroll changed concurrently. Refresh and review again." }); return;
  }
  next(error);
};
p4pDamageRouter.use(errors);
