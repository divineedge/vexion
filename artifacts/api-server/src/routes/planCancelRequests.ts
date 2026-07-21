import { Router, type IRouter } from "express";
import { db, planCancelRequestsTable, customersTable, customerPlansTable, jobsTable, tenantsTable, activityLogTable } from "@workspace/db";
import { eq, and, desc, inArray, isNotNull, isNull } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { sendEmail } from "../lib/emailProvider";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function formatRequest(
  r: typeof planCancelRequestsTable.$inferSelect,
  extras?: { customerName?: string | null; planName?: string | null },
) {
  return {
    ...r,
    customerName: extras?.customerName ?? null,
    planName: extras?.planName ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

// GET /plan-cancel-requests — staff queue
router.get("/plan-cancel-requests", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status } = req.query as Record<string, string>;

  const rows = await db
    .select({
      req: planCancelRequestsTable,
      customerName: customersTable.name,
      planName: customerPlansTable.templateName,
    })
    .from(planCancelRequestsTable)
    .leftJoin(customersTable, eq(planCancelRequestsTable.customerId, customersTable.id))
    .leftJoin(customerPlansTable, eq(planCancelRequestsTable.planId, customerPlansTable.id))
    .where(
      status
        ? and(eq(planCancelRequestsTable.tenantId, tenantId), eq(planCancelRequestsTable.status, status))
        : eq(planCancelRequestsTable.tenantId, tenantId),
    )
    .orderBy(desc(planCancelRequestsTable.createdAt));

  res.json(rows.map(r => formatRequest(r.req, { customerName: r.customerName, planName: r.planName })));
});

// POST /plan-cancel-requests/:id/approve — cancel the plan
router.post("/plan-cancel-requests/:id/approve", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office roles" });
    return;
  }

  const id = parseInt(req.params.id, 10);
  const [cancelReq] = await db
    .select()
    .from(planCancelRequestsTable)
    .where(and(eq(planCancelRequestsTable.id, id), eq(planCancelRequestsTable.tenantId, tenantId)));

  if (!cancelReq) { res.status(404).json({ error: "Not found" }); return; }
  if (cancelReq.status !== "pending") { res.status(409).json({ error: `Request already ${cancelReq.status}` }); return; }

  // Load the plan before cancelling (needed for notification email)
  const [plan] = await db
    .select()
    .from(customerPlansTable)
    .where(and(eq(customerPlansTable.id, cancelReq.planId), eq(customerPlansTable.tenantId, tenantId)));

  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  // Cancel the plan
  await db
    .update(customerPlansTable)
    .set({ status: "cancelled" })
    .where(eq(customerPlansTable.id, cancelReq.planId));

  // Cancel all future scheduled visits directly linked to this plan
  const scheduledVisits = await db
    .select({ title: jobsTable.title, scheduledAt: jobsTable.scheduledAt })
    .from(jobsTable)
    .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.planId, cancelReq.planId), eq(jobsTable.status, "scheduled")))
    .orderBy(jobsTable.scheduledAt);

  await db.update(jobsTable)
    .set({ status: "cancelled", cancelReason: "Plan cancelled" })
    .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.planId, cancelReq.planId), eq(jobsTable.status, "scheduled")));

  // Cancel recurring series roots linked to this plan and their scheduled child instances
  const seriesRoots = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      eq(jobsTable.planId, cancelReq.planId),
      isNotNull(jobsTable.recurrenceRule),
      isNull(jobsTable.recurrenceParentId),
    ));

  if (seriesRoots.length > 0) {
    const rootIds = seriesRoots.map(r => r.id);
    await db.update(jobsTable)
      .set({ status: "cancelled", cancelReason: "Plan cancelled" })
      .where(and(
        eq(jobsTable.tenantId, tenantId),
        inArray(jobsTable.recurrenceParentId, rootIds),
        eq(jobsTable.status, "scheduled"),
      ));
  }

  // Notify the customer by email (best-effort)
  try {
    const [customer] = await db
      .select({ email: customersTable.email, name: customersTable.name })
      .from(customersTable)
      .where(and(eq(customersTable.id, cancelReq.customerId), eq(customersTable.tenantId, tenantId)));

    const [tenant] = await db
      .select({
        emailProvider: tenantsTable.emailProvider,
        emailProviderConfig: tenantsTable.emailProviderConfig,
        businessEmail: tenantsTable.businessEmail,
        name: tenantsTable.name,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));

    if (customer?.email) {
      const providerConfig = {
        provider: (tenant?.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | null) ?? null,
        config: (tenant?.emailProviderConfig as Record<string, string>) ?? {},
        fromAddress: tenant?.businessEmail ?? (tenant?.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
      };

      const visitLines = scheduledVisits.length > 0
        ? scheduledVisits.map(v => `  • ${v.title} — ${v.scheduledAt.toISOString().slice(0, 10)}`).join("\n")
        : "  (no upcoming visits were scheduled)";

      const subject = `Your "${plan.templateName}" plan has been cancelled`;
      const body = [
        `Hi ${customer.name},`,
        "",
        `We're writing to confirm that your "${plan.templateName}" service plan has been cancelled as requested.`,
        "",
        scheduledVisits.length > 0
          ? `The following upcoming visit${scheduledVisits.length > 1 ? "s have" : " has"} also been cancelled:`
          : "There were no upcoming visits to cancel.",
        ...(scheduledVisits.length > 0 ? [visitLines] : []),
        "",
        "If you have any questions, please don't hesitate to contact us.",
        "",
        "Thank you,",
        tenant?.name ?? "Your Service Provider",
      ].join("\n");

      await sendEmail(providerConfig, customer.email, subject, body)
        .catch(err => logger.warn({ err, planId: cancelReq.planId }, "Plan cancellation notification email failed"));
    }
  } catch (err) {
    logger.warn({ err, planId: cancelReq.planId }, "Plan cancellation: failed to send customer notification email");
  }

  const [updated] = await db
    .update(planCancelRequestsTable)
    .set({ status: "approved", resolvedBy: userId, resolvedAt: new Date() })
    .where(eq(planCancelRequestsTable.id, id))
    .returning();

  await db.insert(activityLogTable).values({
    tenantId,
    userId,
    type: "plan_cancel_approved",
    message: `Plan cancellation approved for customer #${cancelReq.customerId} — plan "${plan.templateName}" cancelled`,
    entityId: cancelReq.planId,
  });

  res.json(formatRequest(updated));
});

// POST /plan-cancel-requests/:id/dismiss — dismiss without cancelling
router.post("/plan-cancel-requests/:id/dismiss", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office roles" });
    return;
  }

  const id = parseInt(req.params.id, 10);
  const [cancelReq] = await db
    .select()
    .from(planCancelRequestsTable)
    .where(and(eq(planCancelRequestsTable.id, id), eq(planCancelRequestsTable.tenantId, tenantId)));

  if (!cancelReq) { res.status(404).json({ error: "Not found" }); return; }
  if (cancelReq.status !== "pending") { res.status(409).json({ error: `Request already ${cancelReq.status}` }); return; }

  const [updated] = await db
    .update(planCancelRequestsTable)
    .set({ status: "dismissed", resolvedBy: userId, resolvedAt: new Date() })
    .where(eq(planCancelRequestsTable.id, id))
    .returning();

  res.json(formatRequest(updated));
});

export default router;
