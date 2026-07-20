import { Router, type IRouter } from "express";
import {
  db, planTemplatesTable, customerPlansTable, jobsTable, customersTable,
  propertiesTable, usersTable, invoicesTable, activityLogTable, tenantsTable,
} from "@workspace/db";
import { eq, and, sql, gt, ne, inArray, isNotNull, isNull } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import {
  generatePlanPreview, billingCycleDays, type PlanServiceRule,
  type ClusterCandidate, type PlanVisitCandidate,
} from "../lib/planSchedulingEngine";
import { enqueueInvoiceEmail } from "../lib/billingScheduler";

const router: IRouter = Router();

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtTemplate(t: typeof planTemplatesTable.$inferSelect) {
  return {
    ...t,
    services: (t.services as unknown[]) ?? [],
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function fmtPlan(
  p: typeof customerPlansTable.$inferSelect,
  extras?: { customerName?: string | null; propertyAddress?: string | null },
) {
  return {
    ...p,
    serviceState: (p.serviceState as unknown[]) ?? [],
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    lastBilledAt: p.lastBilledAt?.toISOString() ?? null,
    renewalReminderSentAt: p.renewalReminderSentAt?.toISOString() ?? null,
    customerName: extras?.customerName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
  };
}

function fmtVisit(v: PlanVisitCandidate) {
  return {
    serviceId: v.serviceId,
    serviceName: v.serviceName,
    date: v.date.toISOString(),
    idealDate: v.idealDate.toISOString(),
    assigneeId: v.assigneeId,
    assigneeName: v.assigneeName,
    clustered: v.clustered,
  };
}

/** Looks up already-scheduled jobs for a service, with property geo + assignee name, for clustering. */
function makeClusterLookup(tenantId: number) {
  return async (serviceId: number): Promise<ClusterCandidate[]> => {
    const rows = await db
      .select({
        id: jobsTable.id,
        scheduledAt: jobsTable.scheduledAt,
        assigneeId: jobsTable.assigneeId,
        assigneeName: usersTable.name,
        lat: propertiesTable.lat,
        lng: propertiesTable.lng,
      })
      .from(jobsTable)
      .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .where(
        and(
          eq(jobsTable.tenantId, tenantId),
          eq(jobsTable.serviceId, serviceId),
          eq(jobsTable.status, "scheduled"),
          gt(jobsTable.scheduledAt, new Date()),
        ),
      );
    return rows.map(r => ({
      jobId: r.id,
      scheduledAt: r.scheduledAt,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      lat: r.lat,
      lng: r.lng,
    }));
  };
}

async function requireAdmin(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office/department manager roles" });
    return false;
  }
  return true;
}

// ── Plan Templates CRUD ───────────────────────────────────────────────────────

router.get("/plan-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(planTemplatesTable).where(eq(planTemplatesTable.tenantId, tenantId)).orderBy(planTemplatesTable.name);
  res.json(rows.map(fmtTemplate));
});

router.post("/plan-templates", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const { name, description, services, visitCount, billingCycle, customCycleDays, price, autoRenewDefault, isActive } = req.body;
  if (!name || !Array.isArray(services) || services.length === 0) {
    res.status(400).json({ error: "name and at least one service are required" });
    return;
  }
  const [t] = await db.insert(planTemplatesTable).values({
    tenantId,
    name,
    description: description ?? null,
    services,
    visitCount: visitCount ?? services.length,
    billingCycle: billingCycle ?? "monthly",
    customCycleDays: customCycleDays ?? null,
    price: price ?? 0,
    autoRenewDefault: autoRenewDefault ?? true,
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json(fmtTemplate(t));
});

router.get("/plan-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [t] = await db.select().from(planTemplatesTable).where(and(eq(planTemplatesTable.id, id), eq(planTemplatesTable.tenantId, tenantId)));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmtTemplate(t));
});

router.patch("/plan-templates/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, description, services, visitCount, billingCycle, customCycleDays, price, autoRenewDefault, isActive } = req.body;
  const update: Partial<typeof planTemplatesTable.$inferInsert> = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (services !== undefined) update.services = services;
  if (visitCount !== undefined) update.visitCount = visitCount;
  if (billingCycle !== undefined) update.billingCycle = billingCycle;
  if (customCycleDays !== undefined) update.customCycleDays = customCycleDays;
  if (price !== undefined) update.price = price;
  if (autoRenewDefault !== undefined) update.autoRenewDefault = autoRenewDefault;
  if (isActive !== undefined) update.isActive = isActive;
  const [updated] = await db.update(planTemplatesTable).set(update).where(and(eq(planTemplatesTable.id, id), eq(planTemplatesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmtTemplate(updated));
});

router.delete("/plan-templates/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [inUse] = await db
    .select({ id: customerPlansTable.id })
    .from(customerPlansTable)
    .where(and(eq(customerPlansTable.templateId, id), eq(customerPlansTable.tenantId, tenantId)))
    .limit(1);
  if (inUse) {
    res.status(409).json({ error: "Cannot delete a plan template that has been sold to customers. Mark it inactive instead." });
    return;
  }
  const [deleted] = await db
    .delete(planTemplatesTable)
    .where(and(eq(planTemplatesTable.id, id), eq(planTemplatesTable.tenantId, tenantId)))
    .returning({ id: planTemplatesTable.id });
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

// ── Preview a plan's schedule before selling it ───────────────────────────────

router.post("/customer-plans/preview", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { templateId, propertyId, startDate } = req.body;
  if (!templateId || !propertyId || !startDate) {
    res.status(400).json({ error: "templateId, propertyId and startDate are required" });
    return;
  }

  const [template] = await db.select().from(planTemplatesTable).where(and(eq(planTemplatesTable.id, templateId), eq(planTemplatesTable.tenantId, tenantId)));
  if (!template) { res.status(404).json({ error: "Plan template not found" }); return; }

  const [property] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  const services = ((template.services as unknown[]) ?? []) as PlanServiceRule[];
  const visits = await generatePlanPreview({
    services,
    startDate: new Date(startDate),
    billingCycle: template.billingCycle,
    customCycleDays: template.customCycleDays,
    visitCount: template.visitCount,
    propertyLat: property.lat,
    propertyLng: property.lng,
    lookupClusterCandidates: makeClusterLookup(tenantId),
  });

  res.json({
    template: fmtTemplate(template),
    visits: visits.map(fmtVisit),
  });
});

// ── Sell / activate a plan ────────────────────────────────────────────────────

router.post("/customer-plans", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const { templateId, customerId, propertyId, startDate, autoRenew, visits } = req.body;

  if (!templateId || !customerId || !propertyId || !startDate) {
    res.status(400).json({ error: "templateId, customerId, propertyId and startDate are required" });
    return;
  }

  const [template] = await db.select().from(planTemplatesTable).where(and(eq(planTemplatesTable.id, templateId), eq(planTemplatesTable.tenantId, tenantId)));
  if (!template) { res.status(404).json({ error: "Plan template not found" }); return; }

  const [customer] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const [property] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId), eq(propertiesTable.customerId, customerId)));
  if (!property) { res.status(404).json({ error: "Property not found for this customer" }); return; }

  const start = new Date(startDate);
  const periodDays = billingCycleDays(template.billingCycle, template.customCycleDays);
  const endDate = new Date(start.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const services = ((template.services as unknown[]) ?? []) as PlanServiceRule[];

  // Use the office-confirmed visit list if provided (they may have shifted dates/techs in the
  // preview), otherwise fall back to computing a fresh preview server-side.
  let finalVisits: PlanVisitCandidate[];
  if (Array.isArray(visits) && visits.length > 0) {
    const requestedAssigneeIds = [...new Set(
      visits.map((v: { assigneeId?: number | null }) => v.assigneeId).filter((v: number | null | undefined): v is number => v != null),
    )];
    const validAssigneeIds = requestedAssigneeIds.length > 0
      ? new Set((await db.select({ id: usersTable.id }).from(usersTable).where(and(inArray(usersTable.id, requestedAssigneeIds), eq(usersTable.tenantId, tenantId)))).map(r => r.id))
      : new Set<number>();

    finalVisits = visits.map((v: { serviceId: number; serviceName: string; date: string; assigneeId?: number | null; assigneeName?: string | null }) => ({
      serviceId: v.serviceId,
      serviceName: v.serviceName,
      date: new Date(v.date),
      idealDate: new Date(v.date),
      assigneeId: v.assigneeId != null && validAssigneeIds.has(v.assigneeId) ? v.assigneeId : null,
      assigneeName: v.assigneeId != null && validAssigneeIds.has(v.assigneeId) ? (v.assigneeName ?? null) : null,
      clustered: false,
    }));
  } else {
    finalVisits = await generatePlanPreview({
      services,
      startDate: start,
      billingCycle: template.billingCycle,
      customCycleDays: template.customCycleDays,
      visitCount: template.visitCount,
      propertyLat: property.lat,
      propertyLng: property.lng,
      lookupClusterCandidates: makeClusterLookup(tenantId),
    });
  }

  // Seed each service's scheduling cursor with the latest visit date generated for it,
  // so the background worker continues the cadence from where this first period left off.
  const lastByService = new Map<number, Date>();
  for (const v of finalVisits) {
    const cur = lastByService.get(v.serviceId);
    if (!cur || v.date > cur) lastByService.set(v.serviceId, v.date);
  }
  const serviceState = services.map(s => ({
    serviceId: s.serviceId,
    serviceName: s.serviceName,
    frequencyDays: s.frequencyDays,
    lastScheduledAt: (lastByService.get(s.serviceId) ?? start).toISOString(),
  }));

  const userId = getUserId(req);
  let planId!: number;
  await db.transaction(async tx => {
    const [plan] = await tx.insert(customerPlansTable).values({
      tenantId,
      customerId,
      propertyId,
      templateId,
      templateName: template.name,
      startDate: start,
      endDate,
      billingCycle: template.billingCycle,
      customCycleDays: template.customCycleDays,
      billingPrice: template.price,
      autoRenew: autoRenew ?? template.autoRenewDefault,
      status: "active",
      nextBillingDate: endDate.toISOString().slice(0, 10),
      serviceState,
    }).returning();
    planId = plan.id;

    for (const v of finalVisits) {
      await tx.insert(jobsTable).values({
        tenantId,
        title: `${v.serviceName} — Plan Visit`,
        status: "scheduled",
        priority: "normal",
        customerId,
        propertyId,
        assigneeId: v.assigneeId,
        serviceId: v.serviceId,
        planId: plan.id,
        scheduledAt: v.date,
      });
    }

    await tx.insert(activityLogTable).values({
      tenantId, userId, type: "plan_sold",
      message: `Plan "${template.name}" sold — ${finalVisits.length} visit(s) scheduled`,
      entityId: plan.id,
    });
  });

  // Annual plans bill once at plan start; monthly/quarterly/custom bill on the recurring worker.
  if (template.billingCycle === "annual") {
    await billPlanPeriod(tenantId, planId, userId);
  }

  const [row] = await db
    .select({ plan: customerPlansTable, customerName: customersTable.name, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(customersTable, eq(customerPlansTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(eq(customerPlansTable.id, planId));

  res.status(201).json(fmtPlan(row.plan, { customerName: row.customerName, propertyAddress: row.propertyAddress }));
});

// ── List / get / update plans ─────────────────────────────────────────────────

router.get("/customer-plans", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, status } = req.query as Record<string, string>;

  let where = eq(customerPlansTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (customerId) where = and(where, eq(customerPlansTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (status) where = and(where, eq(customerPlansTable.status, status)) as typeof where;

  const rows = await db
    .select({ plan: customerPlansTable, customerName: customersTable.name, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(customersTable, eq(customerPlansTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(where)
    .orderBy(sql`${customerPlansTable.createdAt} DESC`);

  res.json(rows.map(r => fmtPlan(r.plan, { customerName: r.customerName, propertyAddress: r.propertyAddress })));
});

router.get("/customer-plans/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [row] = await db
    .select({ plan: customerPlansTable, customerName: customersTable.name, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(customersTable, eq(customerPlansTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(and(eq(customerPlansTable.id, id), eq(customerPlansTable.tenantId, tenantId)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const visits = await db
    .select({ job: jobsTable, assigneeName: usersTable.name })
    .from(jobsTable)
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.planId, id)))
    .orderBy(jobsTable.scheduledAt);

  const billingHistory = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.planId, id)))
    .orderBy(sql`${invoicesTable.createdAt} DESC`);

  res.json({
    ...fmtPlan(row.plan, { customerName: row.customerName, propertyAddress: row.propertyAddress }),
    visits: visits.map(v => ({
      id: v.job.id,
      title: v.job.title,
      status: v.job.status,
      scheduledAt: v.job.scheduledAt.toISOString(),
      serviceId: v.job.serviceId,
      assigneeId: v.job.assigneeId,
      assigneeName: v.assigneeName,
      cancelReason: v.job.cancelReason,
    })),
    billingHistory: billingHistory.map(i => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      status: i.status,
      total: i.total,
      dueDate: i.dueDate?.toISOString() ?? null,
      paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
  });
});

router.patch("/customer-plans/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const { status, autoRenew, notes, serviceState } = req.body;

  const [current] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, id), eq(customerPlansTable.tenantId, tenantId)));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  const update: Partial<typeof customerPlansTable.$inferInsert> = {};
  if (status !== undefined) update.status = status;
  if (autoRenew !== undefined) update.autoRenew = autoRenew;
  if (notes !== undefined) update.notes = notes;
  if (serviceState !== undefined) update.serviceState = serviceState; // upgrade/downgrade services for future visits

  const [updated] = await db.update(customerPlansTable).set(update).where(eq(customerPlansTable.id, id)).returning();

  // Cancelling a plan cancels all future scheduled visits; pausing leaves existing
  // visits on the calendar but stops the job-generation worker from adding new ones.
  if (status === "cancelled") {
    // Cancel all scheduled plan visits (direct planId links)
    await db.update(jobsTable)
      .set({ status: "cancelled", cancelReason: "Plan cancelled" })
      .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.planId, id), eq(jobsTable.status, "scheduled")));

    // Cancel recurring series roots linked to this plan, and all their scheduled child instances
    const seriesRoots = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(
        eq(jobsTable.tenantId, tenantId),
        eq(jobsTable.planId, id),
        isNotNull(jobsTable.recurrenceRule),
        isNull(jobsTable.recurrenceParentId),
      ));

    if (seriesRoots.length > 0) {
      const rootIds = seriesRoots.map(r => r.id);
      // Cancel all scheduled child occurrences whose parent is one of these roots
      await db.update(jobsTable)
        .set({ status: "cancelled", cancelReason: "Plan cancelled" })
        .where(and(
          eq(jobsTable.tenantId, tenantId),
          inArray(jobsTable.recurrenceParentId, rootIds),
          eq(jobsTable.status, "scheduled"),
        ));
    }
  }

  await db.insert(activityLogTable).values({
    tenantId, userId, type: "plan_updated",
    message: `Plan "${current.templateName}" updated${status ? ` — status: ${status}` : ""}`,
    entityId: id,
  });

  res.json(fmtPlan(updated));
});

// ── Reschedule a single visit ─────────────────────────────────────────────────

router.post("/customer-plans/:id/visits/:jobId/reschedule", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const jobId = parseInt(req.params.jobId, 10);
  const { newScheduledAt, assigneeId } = req.body;

  if (!newScheduledAt) {
    res.status(400).json({ error: "newScheduledAt is required" });
    return;
  }
  const newDate = new Date(newScheduledAt);
  if (isNaN(newDate.getTime())) {
    res.status(400).json({ error: "newScheduledAt is not a valid date" });
    return;
  }

  // Verify the job belongs to this plan and is still schedulable
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.planId, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Visit not found on this plan" }); return; }
  if (job.status !== "scheduled") {
    res.status(400).json({ error: "Only scheduled visits can be rescheduled" });
    return;
  }

  // Validate assignee if provided
  let resolvedAssigneeId: number | null = job.assigneeId;
  let assigneeName: string | null = null;
  if (assigneeId !== undefined) {
    if (assigneeId === null) {
      resolvedAssigneeId = null;
    } else {
      const [user] = await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(and(eq(usersTable.id, assigneeId), eq(usersTable.tenantId, tenantId)));
      if (!user) { res.status(400).json({ error: "Assignee not found" }); return; }
      resolvedAssigneeId = user.id;
      assigneeName = user.name;
    }
  } else if (job.assigneeId) {
    // Keep existing assignee name
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, job.assigneeId));
    assigneeName = user?.name ?? null;
  }

  const updatePayload: Partial<typeof jobsTable.$inferInsert> = {
    scheduledAt: newDate,
    assigneeId: resolvedAssigneeId,
  };

  const [updated] = await db
    .update(jobsTable)
    .set(updatePayload)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.planId, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  // Advance the plan's serviceState cursor for this service if the new date is later,
  // so the background worker continues scheduling from the correct point.
  if (job.serviceId) {
    const [plan] = await db.select().from(customerPlansTable).where(eq(customerPlansTable.id, id));
    if (plan) {
      const state = ((plan.serviceState as unknown[]) ?? []) as Array<{
        serviceId: number; serviceName: string; frequencyDays: number; lastScheduledAt: string;
      }>;
      const entry = state.find(s => s.serviceId === job.serviceId);
      if (entry) {
        const currentCursor = new Date(entry.lastScheduledAt);
        if (newDate > currentCursor) {
          entry.lastScheduledAt = newDate.toISOString();
          await db.update(customerPlansTable).set({ serviceState: state }).where(eq(customerPlansTable.id, id));
        }
      }
    }
  }

  await db.insert(activityLogTable).values({
    tenantId, userId, type: "plan_updated",
    message: `Visit rescheduled to ${newDate.toISOString().slice(0, 10)}`,
    entityId: id,
  });

  res.json({
    id: updated.id,
    scheduledAt: updated.scheduledAt.toISOString(),
    status: updated.status,
    assigneeId: updated.assigneeId,
    assigneeName,
  });
});

// ── Cancel a single visit (requires a reason) ─────────────────────────────────

router.post("/customer-plans/:id/visits/:jobId/cancel", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const jobId = parseInt(req.params.jobId, 10);
  const { reason } = req.body;
  if (!reason || !String(reason).trim()) {
    res.status(400).json({ error: "reason is required to cancel a plan visit" });
    return;
  }

  const [updated] = await db.update(jobsTable)
    .set({ status: "cancelled", cancelReason: reason })
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.planId, id), eq(jobsTable.tenantId, tenantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Visit not found on this plan" }); return; }
  res.json({ id: updated.id, status: updated.status, cancelReason: updated.cancelReason });
});

// ── Manual renewal ────────────────────────────────────────────────────────────

export async function billPlanPeriod(tenantId: number, planId: number, userId: number): Promise<{ invoiceId: number }> {
  const [plan] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, planId), eq(customerPlansTable.tenantId, tenantId)));
  if (!plan) throw new Error("Plan not found");

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, plan.customerId));
  const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const taxRate = tenant?.taxRate ?? 0;
  const subtotal = plan.billingPrice;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;

  let invoiceId!: number;
  await db.transaction(async tx => {
    const [invoice] = await tx.insert(invoicesTable).values({
      tenantId,
      invoiceNumber: invoiceNum,
      customerId: plan.customerId,
      planId: plan.id,
      status: customer?.email ? "sent" : "draft",
      subtotal,
      tax,
      total,
      lineItems: [{ description: `${plan.templateName} — ${plan.billingCycle} plan`, quantity: 1, unitPrice: subtotal, total: subtotal }],
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    }).returning();
    invoiceId = invoice.id;
    await tx.update(customerPlansTable).set({ lastBilledAt: new Date() }).where(eq(customerPlansTable.id, plan.id));
  });

  await db.insert(activityLogTable).values({
    tenantId, userId, type: "invoice_sent",
    message: `Plan invoice ${invoiceNum} generated for "${plan.templateName}"`,
    entityId: invoiceId,
  });

  if (customer?.email) await enqueueInvoiceEmail(tenantId, invoiceId);
  return { invoiceId };
}

router.post("/customer-plans/:id/renew", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  const [plan] = await db.select().from(customerPlansTable).where(and(eq(customerPlansTable.id, id), eq(customerPlansTable.tenantId, tenantId)));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }
  if (plan.status === "cancelled") { res.status(400).json({ error: "Cannot renew a cancelled plan" }); return; }

  const periodDays = billingCycleDays(plan.billingCycle, plan.customCycleDays);
  const newEndDate = new Date(plan.endDate.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const newNextBillingDate = newEndDate.toISOString().slice(0, 10);

  const { invoiceId } = await billPlanPeriod(tenantId, id, userId);

  const [updated] = await db.update(customerPlansTable)
    .set({ endDate: newEndDate, nextBillingDate: newNextBillingDate, status: "active", renewalReminderSentAt: null })
    .where(eq(customerPlansTable.id, id))
    .returning();

  res.json({ ...fmtPlan(updated), invoiceId });
});

// ── Dashboard ──────────────────────────────────────────────────────────────────

router.get("/plans/dashboard", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const plans = await db
    .select({ plan: customerPlansTable, customerName: customersTable.name, propertyAddress: propertiesTable.address })
    .from(customerPlansTable)
    .leftJoin(customersTable, eq(customerPlansTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(customerPlansTable.propertyId, propertiesTable.id))
    .where(and(eq(customerPlansTable.tenantId, tenantId), ne(customerPlansTable.status, "cancelled")));

  const activePlans = plans.filter(p => p.plan.status === "active");
  const monthlyEquivalent = (p: typeof customerPlansTable.$inferSelect) => {
    const days = billingCycleDays(p.billingCycle, p.customCycleDays);
    return (p.billingPrice / days) * 30;
  };
  const mrr = activePlans.reduce((sum, p) => sum + monthlyEquivalent(p.plan), 0);
  const autoRenewCount = activePlans.filter(p => p.plan.autoRenew).length;
  const expiringSoon = plans.filter(p => p.plan.status !== "cancelled" && p.plan.endDate <= in30 && p.plan.endDate >= now);

  const planIds = plans.map(p => p.plan.id);
  const overdueInvoices = planIds.length > 0
    ? await db.select().from(invoicesTable).where(and(
      eq(invoicesTable.tenantId, tenantId),
      inArray(invoicesTable.planId, planIds),
      ne(invoicesTable.status, "paid"),
      sql`${invoicesTable.dueDate} IS NOT NULL AND ${invoicesTable.dueDate} < ${now.toISOString()}::timestamptz`,
    ))
    : [];
  const overduePlanIds = new Set(overdueInvoices.map(i => i.planId));

  res.json({
    activeCount: activePlans.length,
    mrr,
    autoRenewCount,
    expiringSoonCount: expiringSoon.length,
    overdueCount: overduePlanIds.size,
    plans: plans.map(p => ({
      ...fmtPlan(p.plan, { customerName: p.customerName, propertyAddress: p.propertyAddress }),
      isOverdue: overduePlanIds.has(p.plan.id),
    })),
  });
});

export default router;
