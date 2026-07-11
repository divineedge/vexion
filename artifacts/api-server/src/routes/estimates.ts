import { Router, type IRouter } from "express";
import { db, estimatesTable, visitsTable, jobsTable, customersTable, propertiesTable, usersTable, tenantsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { sendReviewRequest } from "../lib/reviewService";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router: IRouter = Router();

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Compute totals from line items.
 * Only required items (isOptional=false) and accepted optional items
 * (isOptional=true AND acceptedByCustomer=true) are counted.
 * Unaccepted optional add-ons are excluded so totals reflect billable value.
 */
function calcTotals(lineItems: EstimateLineItem[]) {
  let subtotal = 0;
  for (const item of lineItems) {
    // Skip optional items that the customer has not accepted
    if (item.isOptional && !item.acceptedByCustomer) continue;
    const base = item.qty * item.unitPrice;
    const afterMarkup = base * (1 + item.markup / 100);
    const afterDiscount = afterMarkup * (1 - item.discount / 100);
    subtotal += afterDiscount;
  }
  const tax = 0; // tax handled separately if needed
  return { subtotal, tax, total: subtotal + tax };
}

/** Allowed status transitions for the PATCH endpoint (admin use) */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft:    ["sent", "expired"],
  sent:     ["draft", "expired"],
  approved: [],   // terminal — use /convert to progress further
  declined: [],   // terminal
  expired:  [],   // terminal
};

interface EstimateLineItem {
  id: string;
  serviceId?: number | null;
  description: string;
  qty: number;
  unitPrice: number;
  markup: number;
  discount: number;
  isOptional: boolean;
  optionalPitchLine?: string | null;
  acceptedByCustomer: boolean;
}

function formatEstimate(
  e: typeof estimatesTable.$inferSelect,
  extras?: { customerName?: string | null; assigneeName?: string | null; propertyAddress?: string | null }
) {
  return {
    ...e,
    lineItems: (e.lineItems as unknown[]) ?? [],
    scheduledAt: e.scheduledAt?.toISOString() ?? null,
    expiresAt: e.expiresAt?.toISOString() ?? null,
    sentAt: e.sentAt?.toISOString() ?? null,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    declinedAt: e.declinedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    customerName: extras?.customerName ?? null,
    assigneeName: extras?.assigneeName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
  };
}

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get("/estimates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, assigneeId, customerId, startDate, endDate } = req.query as Record<string, string>;

  let where = eq(estimatesTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(estimatesTable.status, status)) as typeof where;
  if (assigneeId) where = and(where, eq(estimatesTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  if (customerId) where = and(where, eq(estimatesTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (startDate) where = and(where, sql`${estimatesTable.scheduledAt} >= ${startDate}::timestamptz`) as typeof where;
  if (endDate) where = and(where, sql`${estimatesTable.scheduledAt} <= ${endDate}::timestamptz`) as typeof where;

  const rows = await db
    .select({
      estimate: estimatesTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
    })
    .from(estimatesTable)
    .leftJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(estimatesTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(estimatesTable.propertyId, propertiesTable.id))
    .where(where)
    .orderBy(desc(estimatesTable.createdAt));

  res.json(rows.map(r => formatEstimate(r.estimate, {
    customerName: r.customerName,
    assigneeName: r.assigneeName,
    propertyAddress: r.propertyAddress,
  })));
});

// ── PIPELINE STATS ────────────────────────────────────────────────────────────
router.get("/estimates/pipeline", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const rows = await db
    .select({ status: estimatesTable.status, total: estimatesTable.total, lineItems: estimatesTable.lineItems })
    .from(estimatesTable)
    .where(eq(estimatesTable.tenantId, tenantId));

  let pipelineValue = 0;
  let upsellRevenue = 0;

  for (const r of rows) {
    if (r.status === "sent") pipelineValue += r.total ?? 0;
    if (r.status === "approved") {
      const items = (r.lineItems as EstimateLineItem[]) ?? [];
      for (const item of items) {
        if (item.isOptional && item.acceptedByCustomer) {
          const base = item.qty * item.unitPrice;
          const afterMarkup = base * (1 + item.markup / 100);
          const afterDiscount = afterMarkup * (1 - item.discount / 100);
          upsellRevenue += afterDiscount;
        }
      }
    }
  }

  res.json({ pipelineValue, upsellRevenue });
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post("/estimates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, propertyId, blueprintId, assigneeId, visitMode, scheduledAt, expiresAt, notes, lineItems, templateId } = req.body;

  let items: EstimateLineItem[] = lineItems ?? [];

  // If a templateId was provided, load template line items
  if (templateId) {
    const { estimateTemplatesTable } = await import("@workspace/db");
    const [tmpl] = await db.select().from(estimateTemplatesTable).where(and(eq(estimateTemplatesTable.id, templateId), eq(estimateTemplatesTable.tenantId, tenantId)));
    if (tmpl) items = (tmpl.lineItems as EstimateLineItem[]) ?? [];
  }

  const { subtotal, tax, total } = calcTotals(items);

  // Default expiry 30 days
  const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [estimate] = await db.insert(estimatesTable).values({
    tenantId,
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    blueprintId: blueprintId ? parseInt(blueprintId, 10) : null,
    assigneeId: assigneeId ? parseInt(assigneeId, 10) : null,
    visitMode: visitMode ?? "scheduled",
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    expiresAt: expiresAt ? new Date(expiresAt) : defaultExpiry,
    notes: notes ?? null,
    lineItems: items,
    subtotal,
    tax,
    total,
    status: "draft",
  }).returning();

  res.status(201).json(formatEstimate(estimate));
});

// ── GET ONE ───────────────────────────────────────────────────────────────────
router.get("/estimates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [row] = await db
    .select({
      estimate: estimatesTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
    })
    .from(estimatesTable)
    .leftJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(estimatesTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(estimatesTable.propertyId, propertiesTable.id))
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatEstimate(row.estimate, { customerName: row.customerName, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress }));
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.patch("/estimates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { customerId, propertyId, assigneeId, visitMode, scheduledAt, expiresAt, notes, lineItems, status } = req.body;

  const updateData: Partial<typeof estimatesTable.$inferInsert> = {};
  if (customerId !== undefined) updateData.customerId = customerId ? parseInt(customerId, 10) : null;
  if (propertyId !== undefined) updateData.propertyId = propertyId ? parseInt(propertyId, 10) : null;
  if (assigneeId !== undefined) updateData.assigneeId = assigneeId ? parseInt(assigneeId, 10) : null;
  if (visitMode) updateData.visitMode = visitMode;
  if (scheduledAt !== undefined) updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (notes !== undefined) updateData.notes = notes;
  if (status) {
    // Fetch current status to validate transition
    const [current] = await db.select({ status: estimatesTable.status })
      .from(estimatesTable)
      .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }
    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status)) {
      res.status(409).json({ error: `Cannot transition estimate from '${current.status}' to '${status}'` });
      return;
    }
    updateData.status = status;
  }
  if (lineItems !== undefined) {
    const items: EstimateLineItem[] = lineItems;
    const { subtotal, tax, total } = calcTotals(items);
    updateData.lineItems = items;
    updateData.subtotal = subtotal;
    updateData.tax = tax;
    updateData.total = total;
  }

  const [updated] = await db.update(estimatesTable)
    .set(updateData)
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatEstimate(updated));
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete("/estimates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db.delete(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ── SEND ──────────────────────────────────────────────────────────────────────
router.post("/estimates/:id/send", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [current] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  if (!["draft"].includes(current.status)) {
    res.status(409).json({ error: `Cannot send estimate in status: ${current.status}` });
    return;
  }

  const token = generateToken();
  const [updated] = await db.update(estimatesTable)
    .set({ status: "sent", sentAt: new Date(), approvalToken: token })
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)))
    .returning();

  res.json({ ...formatEstimate(updated), approvalToken: token });
});

// ── CONVERT TO JOB ────────────────────────────────────────────────────────────
router.post("/estimates/:id/convert", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

  const [estimate] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  if (!estimate) { res.status(404).json({ error: "Not found" }); return; }

  if (estimate.status !== "approved") {
    res.status(409).json({ error: "Only approved estimates can be converted to jobs" });
    return;
  }
  if (estimate.convertedToJobId) {
    res.status(409).json({ error: "Estimate already converted to job", jobId: estimate.convertedToJobId });
    return;
  }

  // Only include required + accepted optional items
  const allItems = (estimate.lineItems as EstimateLineItem[]) ?? [];
  const jobItems = allItems.filter(item => !item.isOptional || item.acceptedByCustomer);
  const { subtotal, tax, total } = calcTotals(jobItems);

  const [job] = await db.insert(jobsTable).values({
    tenantId,
    title: `Job from Estimate #${estimate.id}`,
    description: estimate.notes ?? null,
    status: "scheduled",
    priority: "normal",
    customerId: estimate.customerId,
    propertyId: estimate.propertyId,
    assigneeId: estimate.assigneeId,
    blueprintId: estimate.blueprintId,
    scheduledAt: estimate.scheduledAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    lineItems: jobItems,
    totalAmount: total,
  }).returning();

  await db.update(estimatesTable)
    .set({ convertedToJobId: job.id })
    .where(eq(estimatesTable.id, id));

  res.status(201).json({ jobId: job.id, total });
});

// ── PUBLIC: GET ESTIMATE BY TOKEN ─────────────────────────────────────────────
router.get("/public/estimates/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [row] = await db
    .select({
      estimate: estimatesTable,
      customerName: customersTable.name,
      propertyAddress: propertiesTable.address,
    })
    .from(estimatesTable)
    .leftJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(estimatesTable.propertyId, propertiesTable.id))
    .where(eq(estimatesTable.approvalToken, token));

  if (!row) { res.status(404).json({ error: "Estimate not found" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, row.estimate.tenantId));

  const now = new Date();
  const expired = row.estimate.expiresAt && row.estimate.expiresAt < now;

  const items = (row.estimate.lineItems as EstimateLineItem[]) ?? [];
  const required = items.filter(i => !i.isOptional);
  const optional = items.filter(i => i.isOptional);

  res.json({
    ...formatEstimate(row.estimate, { customerName: row.customerName, propertyAddress: row.propertyAddress }),
    approvalToken: undefined, // don't expose token in response
    required,
    optional,
    expired: !!expired,
    businessProfile: {
      companyName: tenant?.name ?? null,
      logoUrl: tenant?.logoUrl ?? null,
      tagline: tenant?.businessTagline ?? null,
      phone: tenant?.businessPhone ?? null,
      email: tenant?.businessEmail ?? null,
      website: tenant?.businessWebsite ?? null,
      address: tenant?.businessAddress ?? null,
    },
  });
});

// ── PUBLIC: RESPOND (APPROVE / DECLINE) ───────────────────────────────────────
router.post("/public/estimates/:token/respond", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { action, acceptedOptionalItemIds, declineReason } = req.body;

  if (!["approve", "decline"].includes(action)) {
    res.status(400).json({ error: "action must be 'approve' or 'decline'" });
    return;
  }

  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.approvalToken, token));
  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (!["sent"].includes(estimate.status)) {
    res.status(409).json({ error: `Estimate already ${estimate.status}` });
    return;
  }
  if (estimate.expiresAt && estimate.expiresAt < new Date()) {
    res.status(410).json({ error: "Estimate has expired" });
    return;
  }

  const items = (estimate.lineItems as EstimateLineItem[]) ?? [];
  const acceptedIds: string[] = acceptedOptionalItemIds ?? [];

  // Mark accepted optional items
  const updatedItems = items.map(item => ({
    ...item,
    acceptedByCustomer: item.isOptional ? acceptedIds.includes(item.id) : true,
  }));

  // Recompute totals from the post-approval line items (required + accepted optional only)
  const { subtotal, tax, total } = calcTotals(updatedItems);

  const isApproved = action === "approve";
  const now = new Date();

  const [updated] = await db.update(estimatesTable)
    .set({
      status: isApproved ? "approved" : "declined",
      lineItems: updatedItems,
      subtotal,
      tax,
      total,
      approvedAt: isApproved ? now : null,
      declinedAt: isApproved ? null : now,
      declineReason: isApproved ? null : (declineReason ?? null),
    })
    .where(eq(estimatesTable.approvalToken, token))
    .returning();

  if (isApproved && updated.customerId) {
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, updated.tenantId));
    if (tenant?.reviewRequestOnEstimateApproved) {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, updated.customerId));
      if (customer) {
        sendReviewRequest({ tenant, customer, estimateId: updated.id })
          .catch(err => logger.error({ err, estimateId: updated.id }, "Failed to send review request on estimate approved"));
      }
    }
  }

  res.json(formatEstimate(updated));
});

export default router;
