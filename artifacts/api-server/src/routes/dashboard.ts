import { Router, type IRouter } from "express";
import { db, customersTable, jobsTable, invoicesTable, usersTable, timeEntriesTable, activityLogTable } from "@workspace/db";
import { eq, sql, gte, and, isNull, or } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const [customerCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customersTable)
    .where(and(eq(customersTable.tenantId, tenantId), isNull(customersTable.archivedAt)));

  const [activeJobCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobsTable)
    .leftJoin(customersTable, and(
      eq(jobsTable.customerId, customersTable.id),
      eq(jobsTable.tenantId, customersTable.tenantId),
    ))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      isNull(jobsTable.archivedAt),
      sql`${jobsTable.status} IN ('scheduled','in_progress')`,
      or(
        isNull(jobsTable.customerId),
        and(sql`${customersTable.id} IS NOT NULL`, isNull(customersTable.archivedAt)),
      ),
    ));

  const pendingInvoices = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<number>`COALESCE(sum(total),0)::float` })
    .from(invoicesTable)
    .innerJoin(customersTable, and(
      eq(invoicesTable.customerId, customersTable.id),
      eq(invoicesTable.tenantId, customersTable.tenantId),
    ))
    .where(and(
      eq(invoicesTable.tenantId, tenantId),
      isNull(invoicesTable.archivedAt),
      isNull(customersTable.archivedAt),
      sql`${invoicesTable.status} IN ('draft','sent')`,
    ));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [completedThisMonth] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobsTable)
    .leftJoin(customersTable, and(
      eq(jobsTable.customerId, customersTable.id),
      eq(jobsTable.tenantId, customersTable.tenantId),
    ))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      isNull(jobsTable.archivedAt),
      eq(jobsTable.status, "completed"),
      gte(jobsTable.completedAt, startOfMonth),
      or(
        isNull(jobsTable.customerId),
        and(sql`${customersTable.id} IS NOT NULL`, isNull(customersTable.archivedAt)),
      ),
    ));

  const [revenueThisMonth] = await db
    .select({ total: sql<number>`COALESCE(sum(total),0)::float` })
    .from(invoicesTable)
    .innerJoin(customersTable, and(
      eq(invoicesTable.customerId, customersTable.id),
      eq(invoicesTable.tenantId, customersTable.tenantId),
    ))
    .where(and(
      eq(invoicesTable.tenantId, tenantId),
      isNull(invoicesTable.archivedAt),
      isNull(customersTable.archivedAt),
      eq(invoicesTable.status, "paid"),
      gte(invoicesTable.paidAt, startOfMonth)
    ));

  const [clockedIn] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(timeEntriesTable)
    .where(and(
      eq(timeEntriesTable.tenantId, tenantId),
      eq(timeEntriesTable.isMasterClock, true),
      sql`clocked_out_at IS NULL`
    ));

  res.json({
    totalCustomers: customerCount?.count ?? 0,
    activeJobs: activeJobCount?.count ?? 0,
    pendingInvoicesCount: pendingInvoices[0]?.count ?? 0,
    pendingInvoicesTotal: pendingInvoices[0]?.total ?? 0,
    completedJobsThisMonth: completedThisMonth?.count ?? 0,
    revenueThisMonth: revenueThisMonth?.total ?? 0,
    techniciansClockedIn: clockedIn?.count ?? 0,
  });
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const activities = await db
    .select({
      id: activityLogTable.id,
      type: activityLogTable.type,
      message: activityLogTable.message,
      entityId: activityLogTable.entityId,
      createdAt: activityLogTable.createdAt,
      userName: usersTable.name,
    })
    .from(activityLogTable)
    .leftJoin(usersTable, eq(activityLogTable.userId, usersTable.id))
    .where(eq(activityLogTable.tenantId, tenantId))
    .orderBy(sql`${activityLogTable.createdAt} DESC`)
    .limit(15);

  res.json(activities.map(a => ({
    id: a.id,
    type: a.type,
    message: a.message,
    entityId: a.entityId ?? null,
    userAvatar: null,
    userName: a.userName ?? null,
    createdAt: a.createdAt.toISOString(),
  })));
});

router.get("/dashboard/jobs-by-status", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const rows = await db
    .select({
      status: jobsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(jobsTable)
    .leftJoin(customersTable, and(
      eq(jobsTable.customerId, customersTable.id),
      eq(jobsTable.tenantId, customersTable.tenantId),
    ))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      isNull(jobsTable.archivedAt),
      or(
        isNull(jobsTable.customerId),
        and(sql`${customersTable.id} IS NOT NULL`, isNull(customersTable.archivedAt)),
      ),
    ))
    .groupBy(jobsTable.status);

  res.json(rows.map(r => ({ status: r.status, count: r.count })));
});

router.get("/dashboard/revenue-trend", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const rows = await db
    .select({
      date: sql<string>`DATE(paid_at)::text`,
      revenue: sql<number>`COALESCE(sum(total),0)::float`,
    })
    .from(invoicesTable)
    .innerJoin(customersTable, and(
      eq(invoicesTable.customerId, customersTable.id),
      eq(invoicesTable.tenantId, customersTable.tenantId),
    ))
    .where(and(
      eq(invoicesTable.tenantId, tenantId),
      isNull(invoicesTable.archivedAt),
      isNull(customersTable.archivedAt),
      eq(invoicesTable.status, "paid"),
      gte(invoicesTable.paidAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
    ))
    .groupBy(sql`DATE(paid_at)`)
    .orderBy(sql`DATE(paid_at)`);

  res.json(rows);
});

export default router;
