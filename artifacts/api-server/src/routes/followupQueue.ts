import { Router, type IRouter } from "express";
import {
  db, followupQueueItemsTable, customersTable, communicationsLogTable,
  estimatesTable, invoicesTable, tenantsTable, usersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

function priorityForTrigger(triggerType: string): "high" | "medium" | "low" {
  if (triggerType === "missed_call" || triggerType === "voicemail") return "high";
  if (triggerType === "unanswered_email") return "medium";
  return "low";
}

function formatItem(
  item: typeof followupQueueItemsTable.$inferSelect,
  customerName: string | null,
  assignedToUserName: string | null = null,
) {
  const ageDays = Math.floor((Date.now() - item.createdAt.getTime()) / (24 * 60 * 60 * 1000));
  return {
    id: item.id,
    tenantId: item.tenantId,
    customerId: item.customerId,
    customerName,
    triggerType: item.triggerType,
    triggerContextId: item.triggerContextId,
    reason: item.reason,
    status: item.status,
    priority: priorityForTrigger(item.triggerType),
    ageDays,
    createdAt: item.createdAt.toISOString(),
    lastRepeatedAt: item.lastRepeatedAt.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    resolvedByUserId: item.resolvedByUserId ?? null,
    communicationNote: item.communicationNote ?? null,
    assignedToUserId: item.assignedToUserId ?? null,
    assignedToUserName: assignedToUserName ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /followup-queue — list, filterable by triggerType, status, assignedToUserId
// ---------------------------------------------------------------------------
router.get("/followup-queue", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { triggerType, status, assignedToUserId } = req.query as {
    triggerType?: string;
    status?: string;
    assignedToUserId?: string;
  };

  const conditions = [eq(followupQueueItemsTable.tenantId, tenantId)];
  if (triggerType) conditions.push(eq(followupQueueItemsTable.triggerType, triggerType));
  conditions.push(eq(followupQueueItemsTable.status, status ?? "open"));

  // Resolve 'me' to the calling user's id; numeric strings filter to a specific user
  if (assignedToUserId === "me") {
    conditions.push(eq(followupQueueItemsTable.assignedToUserId, userId));
  } else if (assignedToUserId && !isNaN(parseInt(assignedToUserId, 10))) {
    conditions.push(eq(followupQueueItemsTable.assignedToUserId, parseInt(assignedToUserId, 10)));
  }

  // Join user with tenant guard so we never surface another tenant's staff name
  const rows = await db
    .select({
      item: followupQueueItemsTable,
      customerName: customersTable.name,
      assignedToUserName: usersTable.name,
    })
    .from(followupQueueItemsTable)
    .leftJoin(customersTable, eq(followupQueueItemsTable.customerId, customersTable.id))
    .leftJoin(
      usersTable,
      and(
        eq(followupQueueItemsTable.assignedToUserId, usersTable.id),
        eq(usersTable.tenantId, tenantId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(followupQueueItemsTable.createdAt));

  res.json(rows.map(r => formatItem(r.item, r.customerName ?? null, r.assignedToUserName ?? null)));
});

// ---------------------------------------------------------------------------
// GET /followup-queue/:id/context — contact history + related estimates/invoices for the drawer
// ---------------------------------------------------------------------------
router.get("/followup-queue/:id/context", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [itemRow] = await db
    .select({ item: followupQueueItemsTable, assignedToUserName: usersTable.name })
    .from(followupQueueItemsTable)
    .leftJoin(
      usersTable,
      and(
        eq(followupQueueItemsTable.assignedToUserId, usersTable.id),
        eq(usersTable.tenantId, tenantId),
      ),
    )
    .where(and(eq(followupQueueItemsTable.id, id), eq(followupQueueItemsTable.tenantId, tenantId)))
    .limit(1);
  if (!itemRow) { res.status(404).json({ error: "Follow-up item not found" }); return; }

  const { item, assignedToUserName } = itemRow;

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, item.customerId), eq(customersTable.tenantId, tenantId)))
    .limit(1);

  const [history, estimates, invoices] = await Promise.all([
    db.select().from(communicationsLogTable)
      .where(and(eq(communicationsLogTable.tenantId, tenantId), eq(communicationsLogTable.customerId, item.customerId)))
      .orderBy(desc(communicationsLogTable.createdAt))
      .limit(25),
    db.select().from(estimatesTable)
      .where(and(eq(estimatesTable.tenantId, tenantId), eq(estimatesTable.customerId, item.customerId)))
      .orderBy(desc(estimatesTable.createdAt)),
    db.select().from(invoicesTable)
      .where(and(eq(invoicesTable.tenantId, tenantId), eq(invoicesTable.customerId, item.customerId)))
      .orderBy(desc(invoicesTable.createdAt)),
  ]);

  const openEstimates = estimates.filter(e => e.status === "sent" || e.status === "draft");
  const closedEstimates = estimates.filter(e => e.status === "approved" || e.status === "declined" || e.status === "expired");

  res.json({
    item: formatItem(item, customer?.name ?? null, assignedToUserName ?? null),
    customer: customer ? {
      id: customer.id, name: customer.name, phone: customer.phone, email: customer.email,
      smsOptOut: customer.smsOptOut, emailOptOut: customer.emailOptOut,
    } : null,
    contactHistory: history.map(h => ({
      id: h.id, direction: h.direction, channel: h.channel, body: h.body,
      status: h.status, createdAt: h.createdAt.toISOString(),
    })),
    openEstimates: openEstimates.map(e => ({ id: e.id, status: e.status, total: e.total, sentAt: e.sentAt?.toISOString() ?? null })),
    closedEstimates: closedEstimates.map(e => ({ id: e.id, status: e.status, total: e.total })),
    invoices: invoices.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, total: i.total, dueDate: i.dueDate?.toISOString() ?? null })),
  });
});

// ---------------------------------------------------------------------------
// PATCH /followup-queue/:id/assign — assign or unassign to a user
// ---------------------------------------------------------------------------
router.patch("/followup-queue/:id/assign", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { assignedToUserId } = req.body as { assignedToUserId?: number | null };

  // Validate the target user belongs to this tenant before writing
  if (assignedToUserId != null) {
    const [targetUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, assignedToUserId), eq(usersTable.tenantId, tenantId)))
      .limit(1);
    if (!targetUser) {
      res.status(400).json({ error: "User not found in this tenant" });
      return;
    }
  }

  const [updated] = await db
    .update(followupQueueItemsTable)
    .set({ assignedToUserId: assignedToUserId ?? null })
    .where(and(eq(followupQueueItemsTable.id, id), eq(followupQueueItemsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Follow-up item not found" }); return; }

  // Fetch assignee name scoped to tenant
  let assignedToUserName: string | null = null;
  if (updated.assignedToUserId) {
    const [u] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.id, updated.assignedToUserId), eq(usersTable.tenantId, tenantId)));
    assignedToUserName = u?.name ?? null;
  }

  const [customer] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json(formatItem(updated, customer?.name ?? null, assignedToUserName));
});

// ---------------------------------------------------------------------------
// POST /followup-queue/:id/resolve — requires a communication note
// ---------------------------------------------------------------------------
router.post("/followup-queue/:id/resolve", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const { note } = req.body as { note?: string };

  if (!note || !note.trim()) {
    res.status(400).json({ error: "A communication note is required to resolve a follow-up item" });
    return;
  }

  const [updated] = await db
    .update(followupQueueItemsTable)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      resolvedByUserId: userId,
      communicationNote: note.trim(),
    })
    .where(and(eq(followupQueueItemsTable.id, id), eq(followupQueueItemsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Follow-up item not found" }); return; }

  // Fetch assignee name scoped to tenant
  let assignedToUserName: string | null = null;
  if (updated.assignedToUserId) {
    const [u] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.id, updated.assignedToUserId), eq(usersTable.tenantId, tenantId)));
    assignedToUserName = u?.name ?? null;
  }

  const [customer] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json(formatItem(updated, customer?.name ?? null, assignedToUserName));
});

// ---------------------------------------------------------------------------
// PATCH /settings/followup-triggers — update tenant automation trigger config
// ---------------------------------------------------------------------------
router.patch("/settings/followup-triggers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const config = req.body as Record<string, unknown>;

  const [existing] = await db.select({ followupTriggerConfig: tenantsTable.followupTriggerConfig }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const prev = (existing?.followupTriggerConfig as Record<string, unknown>) ?? {};
  const merged = { ...prev, ...config };

  const [updated] = await db
    .update(tenantsTable)
    .set({ followupTriggerConfig: merged })
    .where(eq(tenantsTable.id, tenantId))
    .returning({ followupTriggerConfig: tenantsTable.followupTriggerConfig });

  if (!updated) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(updated.followupTriggerConfig);
});

export default router;
