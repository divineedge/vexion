import { Router } from "express";
import { db, customersTable, servicesTable, tenantsTable, estimatesTable, jobsTable } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { normalizePaymentPolicy, ensureScheduledJobPayment, SchedulingPaymentError } from "../lib/paymentPolicy";
const router = Router();
// Runs before all job/plan/routing routes, including drag/drop and approved rescheduling.
router.use(async (req, res, next) => {
  const match = req.path.match(/^\/jobs\/(\d+)(?:\/.*)?$/) ?? req.path.match(/^\/customer-plans\/\d+\/visits\/(\d+)\/reschedule$/);
  const dateChanged = req.body?.scheduledAt || req.body?.newScheduledAt || req.body?.approvedDate;
  if (!match || !dateChanged || !["PATCH","POST"].includes(req.method) || !Number.isFinite(new Date(dateChanged).getTime())) { next(); return; }
  if (!await isAdminRole(getTenantId(req), getUserId(req))) { res.status(403).json({ error: "Office access required to move scheduled work" }); return; }
  try {
    await db.transaction(async tx => {
      const [job] = await tx.select().from(jobsTable).where(and(eq(jobsTable.id, Number(match[1])), eq(jobsTable.tenantId, getTenantId(req)))).for("update");
      if (job && !["completed","cancelled"].includes(job.status)) await ensureScheduledJobPayment(tx, { ...job, scheduledAt:new Date(dateChanged) });
    });
    next();
  } catch (error) {
    if (error instanceof SchedulingPaymentError) res.status(422).json({ error: error.message });
    else next(error);
  }
});
router.use(["/billing/payment-policy", "/customers/:id/deposits"], async (req, res, next) => {
  if (!await isAdminRole(getTenantId(req), getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  next();
});
router.get("/billing/payment-policy/:scope/:id", async (req, res) => {
  const tenantId = getTenantId(req), id = Number(req.params.id);
  const result = req.params.scope === "company"
    ? await db.execute(sql`SELECT payment_policy FROM tenants WHERE id=${tenantId}`)
    : req.params.scope === "customer" ? await db.execute(sql`SELECT payment_policy FROM customers WHERE id=${id} AND tenant_id=${tenantId}`)
    : req.params.scope === "service" ? await db.execute(sql`SELECT payment_policy FROM services WHERE id=${id} AND tenant_id=${tenantId}`) : null;
  if (!result?.rows.length) { res.status(404).json({ error: "Record not found" }); return; }
  res.json({ policy: normalizePaymentPolicy(result.rows[0].payment_policy) });
});
router.patch("/billing/payment-policy/:scope/:id", async (req, res) => {
  const tenantId = getTenantId(req), id = Number(req.params.id), body = req.body;
  if (!body || !["none","fixed","percent","full",null].includes(body.depositType) ||
      ![true,false,null].includes(body.requirePrepay) || ![true,false,null].includes(body.requireCard) ||
      body.depositValue != null && (typeof body.depositValue !== "number" || !Number.isFinite(body.depositValue) || body.depositValue < 0 || body.depositValue > 1000000) ||
      ["fixed","percent"].includes(body.depositType) && !(body.depositValue > 0) ||
      body.depositType === "percent" && body.depositValue > 100) { res.status(400).json({ error: "Invalid payment policy" }); return; }
  const policy = normalizePaymentPolicy(body);
  const result = req.params.scope === "company"
    ? await db.execute(sql`UPDATE tenants SET payment_policy=${JSON.stringify(policy)}::jsonb WHERE id=${tenantId} RETURNING id`)
    : req.params.scope === "customer"
    ? await db.execute(sql`UPDATE customers SET payment_policy=${JSON.stringify(policy)}::jsonb WHERE id=${id} AND tenant_id=${tenantId} RETURNING id`)
    : req.params.scope === "service"
    ? await db.execute(sql`UPDATE services SET payment_policy=${JSON.stringify(policy)}::jsonb WHERE id=${id} AND tenant_id=${tenantId} RETURNING id`) : null;
  if (!result?.rows.length) { res.status(404).json({ error: "Record not found" }); return; }
  res.json({ policy });
});
router.get("/customers/:id/deposits", async (req, res) => {
  const tenantId = getTenantId(req), customerId = Number(req.params.id);
  const rows = await db.select({ estimate: estimatesTable, invoiceId: jobsTable.invoiceId }).from(estimatesTable)
    .leftJoin(jobsTable, and(eq(jobsTable.id, estimatesTable.convertedToJobId), eq(jobsTable.tenantId, tenantId)))
    .where(and(eq(estimatesTable.tenantId, tenantId), eq(estimatesTable.customerId, customerId), sql`${estimatesTable.depositPaidAt} IS NOT NULL`)).orderBy(desc(estimatesTable.depositPaidAt));
  res.json({ deposits: rows.map(({ estimate, invoiceId }) => ({ id: estimate.id, estimateNumber: estimate.id, total: estimate.total,
    paymentRequirement: estimate.paymentRequirement, depositValue: estimate.depositValue, depositPaidAt: estimate.depositPaidAt,
    depositChargedAmount: estimate.depositChargedAmount, convertedToJobId: estimate.convertedToJobId, invoiceId })) });
});
export default router;
