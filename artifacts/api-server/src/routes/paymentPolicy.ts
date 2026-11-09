import { Router } from "express";
import { db, customersTable, servicesTable, tenantsTable, estimatesTable, jobsTable } from "@workspace/db";
import { and, eq, sql, desc, inArray } from "drizzle-orm";
import { estimateDepositSettingsDocument, mergeEstimateDepositSettings, normalizeScheduleDeposit, readEstimateDepositSettings, validateDepositRules, validateEstimateDepositSettings, validateScheduleDeposit, type DepositRule, type EstimateDepositSettings } from "../lib/companyDepositRules";
import { customerInvoiceGrouping } from "../lib/invoicePropertyGrouping";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { normalizePaymentPolicy, ensureScheduledJobPayment, SchedulingPaymentError } from "../lib/paymentPolicy";
import { achPolicySchema, getAchPolicy } from "../lib/achPolicy";
const router = Router();
router.get("/billing/ach-policy", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  res.json(await getAchPolicy(tenantId));
});
router.patch("/billing/ach-policy", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const parsed = achPolicySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose an ACH rule and a valid dollar amount with no more than two decimal places." }); return; }
  // Update only this nested key, preserving deposit rules, prepayment and all other company settings.
  await db.execute(sql`UPDATE tenants SET payment_policy=jsonb_set(coalesce(payment_policy,'{}'::jsonb),'{ach}',${JSON.stringify(parsed.data)}::jsonb,true) WHERE id=${tenantId}`);
  res.json(parsed.data);
});
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
router.get("/billing/customer-invoice-grouping/:id", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, Number(req.params.id)), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json({ mode: customerInvoiceGrouping(customer.paymentPolicy) });
});
router.patch("/billing/customer-invoice-grouping/:id", async (req, res) => {
  const tenantId = getTenantId(req), mode = req.body?.mode;
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  if (!["combined", "by_property"].includes(mode)) { res.status(400).json({ error: "Choose combined or by_property" }); return; }
  const result = await db.execute(sql`UPDATE customers SET payment_policy=jsonb_set(coalesce(payment_policy,'{}'::jsonb),'{invoiceGrouping}',${JSON.stringify(mode)}::jsonb,true) WHERE id=${Number(req.params.id)} AND tenant_id=${tenantId} RETURNING id`);
  if (!result.rows.length) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json({ mode });
});
async function loadCompanyPolicy(tenantId: number) {
  const [row] = await db.select({ paymentPolicy: tenantsTable.paymentPolicy }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  return row?.paymentPolicy;
}
async function saveEstimateDepositSettings(tenantId: number, settings: EstimateDepositSettings) {
  await db.execute(sql`UPDATE tenants SET payment_policy=coalesce(payment_policy,'{}'::jsonb) || ${JSON.stringify(estimateDepositSettingsDocument(settings))}::jsonb WHERE id=${tenantId}`);
}
router.get("/billing/estimate-deposit-settings", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  res.json({ settings: readEstimateDepositSettings(await loadCompanyPolicy(tenantId)) });
});
router.patch("/billing/estimate-deposit-settings", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const error = validateEstimateDepositSettings(req.body?.settings ?? req.body);
  if (error) { res.status(400).json({ error }); return; }
  const patch = req.body?.settings ?? req.body;
  if (Array.isArray(patch?.rules)) {
    const ids = [...new Set((patch.rules as DepositRule[]).flatMap(rule => rule.serviceIds))];
    if (ids.length) {
      const owned = await db.select({ id: servicesTable.id }).from(servicesTable).where(and(eq(servicesTable.tenantId, tenantId), inArray(servicesTable.id, ids)));
      if (owned.length !== ids.length) { res.status(400).json({ error: "All services must belong to your company" }); return; }
    }
  }
  const settings = mergeEstimateDepositSettings(await loadCompanyPolicy(tenantId), patch);
  await saveEstimateDepositSettings(tenantId, settings);
  res.json({ settings });
});
router.get("/billing/schedule-deposit", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const settings = readEstimateDepositSettings(await loadCompanyPolicy(tenantId));
  res.json({ rule: normalizeScheduleDeposit({ enabled: settings.enabled && settings.requireBeforeScheduling, mode: settings.defaultType, value: settings.defaultAmount }) });
});
router.patch("/billing/schedule-deposit", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const error = validateScheduleDeposit(req.body?.rule);
  if (error) { res.status(400).json({ error }); return; }
  const rule = normalizeScheduleDeposit(req.body.rule);
  const settings = mergeEstimateDepositSettings(await loadCompanyPolicy(tenantId), {
    enabled: rule.enabled ? true : undefined,
    requireBeforeScheduling: rule.enabled,
    defaultType: rule.mode,
    defaultAmount: rule.value,
  });
  await saveEstimateDepositSettings(tenantId, settings);
  res.json({ rule: { enabled: settings.enabled && settings.requireBeforeScheduling, mode: settings.defaultType, value: settings.defaultAmount } });
});
router.get("/billing/deposit-rules", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const rules = readEstimateDepositSettings(await loadCompanyPolicy(tenantId)).rules;
  const error = validateDepositRules(rules);
  if (error) { res.status(422).json({ error }); return; }
  res.json({ rules });
});
router.patch("/billing/deposit-rules", async (req, res) => {
  const tenantId = getTenantId(req), rules = req.body?.rules;
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  const error = validateDepositRules(rules);
  if (error) { res.status(400).json({ error }); return; }
  const ids = [...new Set((rules as DepositRule[]).flatMap(rule => rule.serviceIds))];
  if (ids.length) {
    const owned = await db.select({ id: servicesTable.id }).from(servicesTable).where(and(eq(servicesTable.tenantId, tenantId), inArray(servicesTable.id, ids)));
    if (owned.length !== ids.length) { res.status(400).json({ error: "All services must belong to your company" }); return; }
  }
  const settings = mergeEstimateDepositSettings(await loadCompanyPolicy(tenantId), { rules });
  await saveEstimateDepositSettings(tenantId, settings);
  res.json({ rules: settings.rules });
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
  if (!await isAdminRole(tenantId, getUserId(req))) { res.status(403).json({ error: "Office access required" }); return; }
  if (!body || !["none","fixed","percent","full",null].includes(body.depositType) ||
      ![true,false,null].includes(body.requirePrepay) || ![true,false,null].includes(body.requireCard) ||
      body.depositValue != null && (typeof body.depositValue !== "number" || !Number.isFinite(body.depositValue) || body.depositValue < 0 || body.depositValue > 1000000) ||
      ["fixed","percent"].includes(body.depositType) && !(body.depositValue > 0) ||
      body.depositType === "percent" && body.depositValue > 100) { res.status(400).json({ error: "Invalid payment policy" }); return; }
  const policy = normalizePaymentPolicy(body);
  const result = req.params.scope === "company"
    ? await db.execute(sql`UPDATE tenants SET payment_policy=coalesce(payment_policy,'{}'::jsonb) || ${JSON.stringify({
        ...estimateDepositSettingsDocument(mergeEstimateDepositSettings(await loadCompanyPolicy(tenantId), {
          enabled: policy.depositType === "fixed" || policy.depositType === "percent" || policy.depositType === "full",
          ...(policy.depositType === "fixed" || policy.depositType === "percent" ? { defaultType: policy.depositType, defaultAmount: policy.depositValue } : {}),
          ...(policy.depositType === "full" ? { defaultType: "percent", defaultAmount: 100 } : {}),
          ...(policy.requirePrepay ? { requireBeforeScheduling: true } : {}),
        })),
        requirePrepay: policy.requirePrepay,
        requireCard: policy.requireCard,
      })}::jsonb WHERE id=${tenantId} RETURNING id`)
    : req.params.scope === "customer"
    ? await db.execute(sql`UPDATE customers SET payment_policy=coalesce(payment_policy,'{}'::jsonb) || ${JSON.stringify(policy)}::jsonb WHERE id=${id} AND tenant_id=${tenantId} RETURNING id`)
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
