import { Router, type IRouter } from "express";
import { db, stopServiceFlagsTable, customersTable, invoicesTable, jobsTable, activityLogTable } from "@workspace/db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

function formatFlag(f: typeof stopServiceFlagsTable.$inferSelect, extras?: { customerName?: string | null; invoiceNumber?: string | null }) {
  return {
    ...f,
    customerName: extras?.customerName ?? null,
    invoiceNumber: extras?.invoiceNumber ?? null,
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
  };
}

router.get("/stop-service-flags", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status } = req.query as Record<string, string>;

  let where = eq(stopServiceFlagsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(stopServiceFlagsTable.status, status)) as typeof where;

  const rows = await db
    .select({ flag: stopServiceFlagsTable, customerName: customersTable.name, invoiceNumber: invoicesTable.invoiceNumber })
    .from(stopServiceFlagsTable)
    .leftJoin(customersTable, eq(stopServiceFlagsTable.customerId, customersTable.id))
    .leftJoin(invoicesTable, eq(stopServiceFlagsTable.invoiceId, invoicesTable.id))
    .where(where)
    .orderBy(desc(stopServiceFlagsTable.createdAt));

  res.json(rows.map(r => formatFlag(r.flag, { customerName: r.customerName, invoiceNumber: r.invoiceNumber })));
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

  res.json(formatFlag(updated));
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

  res.json(formatFlag(updated));
});

export default router;
