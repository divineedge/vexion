import { Router, type IRouter } from "express";
import { db, stopServiceFlagsTable, customersTable, invoicesTable, jobsTable, activityLogTable, customerPlansTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

function formatFlag(
  f: typeof stopServiceFlagsTable.$inferSelect,
  extras?: {
    customerName?: string | null;
    invoiceNumber?: string | null;
    planId?: number | null;
    planStatus?: string | null;
  },
) {
  return {
    ...f,
    customerName: extras?.customerName ?? null,
    invoiceNumber: extras?.invoiceNumber ?? null,
    planId: extras?.planId ?? null,
    planStatus: extras?.planStatus ?? null,
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
  };
}

router.get("/stop-service-flags", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, customerId: customerIdQ, from, to } = req.query as Record<string, string>;

  let where = eq(stopServiceFlagsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(stopServiceFlagsTable.status, status)) as typeof where;
  if (customerIdQ) where = and(where, eq(stopServiceFlagsTable.customerId, parseInt(customerIdQ, 10))) as typeof where;
  if (from) where = and(where, eq(stopServiceFlagsTable.createdAt, new Date(from))) as typeof where;

  const rows = await db
    .select({
      flag: stopServiceFlagsTable,
      customerName: customersTable.name,
      invoiceNumber: invoicesTable.invoiceNumber,
      planId: invoicesTable.planId,
      planStatus: customerPlansTable.status,
    })
    .from(stopServiceFlagsTable)
    .leftJoin(customersTable, eq(stopServiceFlagsTable.customerId, customersTable.id))
    .leftJoin(invoicesTable, eq(stopServiceFlagsTable.invoiceId, invoicesTable.id))
    .leftJoin(customerPlansTable, eq(invoicesTable.planId, customerPlansTable.id))
    .where(where)
    .orderBy(desc(stopServiceFlagsTable.createdAt));

  res.json(rows.map(r => formatFlag(r.flag, {
    customerName: r.customerName,
    invoiceNumber: r.invoiceNumber,
    planId: r.planId,
    planStatus: r.planStatus,
  })));
});

// Office approves — pauses the customer's active recurring job series(es).
router.post("/stop-service-flags/:id/approve", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/office roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [flag] = await db.select().from(stopServiceFlagsTable).where(and(eq(stopServiceFlagsTable.id, id), eq(stopServiceFlagsTable.tenantId, tenantId)));
  if (!flag) { res.status(404).json({ error: "Not found" }); return; }
  if (flag.status !== "pending") { res.status(409).json({ error: `Flag already ${flag.status}` }); return; }

  // Pause every active recurring series root for this customer.
  await db.update(jobsTable)
    .set({ isRecurrencePaused: true })
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      eq(jobsTable.customerId, flag.customerId),
      isNull(jobsTable.recurrenceParentId),
      eq(jobsTable.isRecurrencePaused, false),
    ));

  const [updated] = await db.update(stopServiceFlagsTable)
    .set({ status: "approved", resolvedBy: userId, resolvedAt: new Date() })
    .where(eq(stopServiceFlagsTable.id, id))
    .returning();

  await db.insert(activityLogTable).values({
    tenantId, userId, type: "stop_service_approved",
    message: `Stop-service approved for customer #${flag.customerId} (${flag.daysOverdue} days overdue) — recurring service paused`,
    entityId: flag.customerId,
  });

  // Fetch plan info for response
  const [inv] = await db.select({ planId: invoicesTable.planId }).from(invoicesTable).where(eq(invoicesTable.id, flag.invoiceId));
  const planId = inv?.planId ?? null;
  let planStatus: string | null = null;
  if (planId) {
    const [plan] = await db.select({ status: customerPlansTable.status }).from(customerPlansTable).where(eq(customerPlansTable.id, planId));
    planStatus = plan?.status ?? null;
  }

  res.json(formatFlag(updated, { planId, planStatus }));
});

// Office dismisses — no change to billing/service.
router.post("/stop-service-flags/:id/dismiss", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/office roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [flag] = await db.select().from(stopServiceFlagsTable).where(and(eq(stopServiceFlagsTable.id, id), eq(stopServiceFlagsTable.tenantId, tenantId)));
  if (!flag) { res.status(404).json({ error: "Not found" }); return; }
  if (flag.status !== "pending") { res.status(409).json({ error: `Flag already ${flag.status}` }); return; }

  const [updated] = await db.update(stopServiceFlagsTable)
    .set({ status: "dismissed", resolvedBy: userId, resolvedAt: new Date() })
    .where(eq(stopServiceFlagsTable.id, id))
    .returning();

  // Fetch plan info for response
  const [inv] = await db.select({ planId: invoicesTable.planId }).from(invoicesTable).where(eq(invoicesTable.id, flag.invoiceId));
  const planId = inv?.planId ?? null;
  let planStatus: string | null = null;
  if (planId) {
    const [plan] = await db.select({ status: customerPlansTable.status }).from(customerPlansTable).where(eq(customerPlansTable.id, planId));
    planStatus = plan?.status ?? null;
  }

  res.json(formatFlag(updated, { planId, planStatus }));
});

// Office resumes plan — sets plan back to active and resolves the flag.
router.post("/stop-service-flags/:id/resume-plan", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/office roles" }); return; }

  const id = parseInt(req.params.id, 10);
  const [flag] = await db.select().from(stopServiceFlagsTable).where(and(eq(stopServiceFlagsTable.id, id), eq(stopServiceFlagsTable.tenantId, tenantId)));
  if (!flag) { res.status(404).json({ error: "Not found" }); return; }

  // Resolve invoice → planId
  const [inv] = await db.select({ planId: invoicesTable.planId }).from(invoicesTable).where(eq(invoicesTable.id, flag.invoiceId));
  const planId = inv?.planId ?? null;
  if (!planId) { res.status(409).json({ error: "Flag's invoice is not linked to a plan" }); return; }

  // Verify plan belongs to this tenant and is paused
  const [plan] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, planId), eq(customerPlansTable.tenantId, tenantId)));
  if (!plan) { res.status(404).json({ error: "Linked plan not found" }); return; }
  if (plan.status !== "paused") { res.status(409).json({ error: `Plan is not paused (status: ${plan.status})` }); return; }

  // Resume the plan
  await db.update(customerPlansTable)
    .set({ status: "active" })
    .where(eq(customerPlansTable.id, planId));

  // Mark flag resolved
  const [updated] = await db.update(stopServiceFlagsTable)
    .set({ status: "approved", resolvedBy: userId, resolvedAt: new Date() })
    .where(eq(stopServiceFlagsTable.id, id))
    .returning();

  await db.insert(activityLogTable).values({
    tenantId, userId, type: "stop_service_plan_resumed",
    message: `Plan #${planId} resumed for customer #${flag.customerId} after stop-service flag review`,
    entityId: flag.customerId,
  });

  res.json(formatFlag(updated, { planId, planStatus: "active" }));
});

export default router;
