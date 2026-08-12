/**
 * Staff-side portal messaging endpoints.
 * Customers send messages via /portal/messages (portal.ts).
 * Staff read and reply via these routes.
 */
import { Router, type IRouter } from "express";
import { db, portalMessagesTable, customersTable, taskNotificationsTable, usersTable } from "@workspace/db";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

async function requireAdmin(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office/department manager roles" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /portal-inbox  — list customer threads with most-recent message + unread count
// ---------------------------------------------------------------------------
router.get("/portal-inbox", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);

  // One row per customer: most recent message body/ts + count of unread inbound messages
  const rows = await db
    .select({
      customerId: portalMessagesTable.customerId,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      latestBody: sql<string>`(array_agg(${portalMessagesTable.body} order by ${portalMessagesTable.createdAt} desc))[1]`,
      latestAt: sql<string>`(array_agg(${portalMessagesTable.createdAt} order by ${portalMessagesTable.createdAt} desc))[1]`,
      latestDirection: sql<string>`(array_agg(${portalMessagesTable.direction} order by ${portalMessagesTable.createdAt} desc))[1]`,
      unreadCount: sql<number>`count(case when ${portalMessagesTable.direction} = 'inbound' and ${portalMessagesTable.readAt} is null then 1 end)::int`,
    })
    .from(portalMessagesTable)
    .innerJoin(customersTable, eq(portalMessagesTable.customerId, customersTable.id))
    .where(eq(portalMessagesTable.tenantId, tenantId))
    .groupBy(portalMessagesTable.customerId, customersTable.name, customersTable.email)
    .orderBy(sql`max(${portalMessagesTable.createdAt}) desc`);

  res.json(rows.map(r => ({
    customerId: r.customerId,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    latestBody: r.latestBody,
    latestAt: r.latestAt,
    latestDirection: r.latestDirection,
    unreadCount: r.unreadCount,
  })));
});

// ---------------------------------------------------------------------------
// GET /portal-inbox/unread-count  — total unread inbound messages for the badge
// (Must be registered BEFORE /:customerId to avoid being captured as customerId="unread-count")
// ---------------------------------------------------------------------------
router.get("/portal-inbox/unread-count", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(portalMessagesTable)
    .where(
      and(
        eq(portalMessagesTable.tenantId, tenantId),
        eq(portalMessagesTable.direction, "inbound"),
        isNull(portalMessagesTable.readAt),
      ),
    );
  res.json({ count: row?.count ?? 0 });
});

// ---------------------------------------------------------------------------
// GET /portal-inbox/:customerId  — get full thread, marks inbound messages as read
// ---------------------------------------------------------------------------
router.get("/portal-inbox/:customerId", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const customerId = parseInt(req.params.customerId, 10);
  if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customerId" }); return; }

  // Verify customer belongs to this tenant
  const [customer] = await db.select({ id: customersTable.id, name: customersTable.name, email: customersTable.email })
    .from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const messages = await db
    .select()
    .from(portalMessagesTable)
    .where(and(eq(portalMessagesTable.customerId, customerId), eq(portalMessagesTable.tenantId, tenantId)))
    .orderBy(portalMessagesTable.createdAt);

  // Mark all unread inbound messages as read now that staff is viewing the thread
  const now = new Date();
  await db
    .update(portalMessagesTable)
    .set({ readAt: now })
    .where(
      and(
        eq(portalMessagesTable.customerId, customerId),
        eq(portalMessagesTable.tenantId, tenantId),
        eq(portalMessagesTable.direction, "inbound"),
        isNull(portalMessagesTable.readAt),
      ),
    );

  res.json({
    customer: { id: customer.id, name: customer.name, email: customer.email },
    messages: messages.map(m => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      readAt: m.readAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /portal-inbox/:customerId/reply  — staff sends a reply to a customer
// ---------------------------------------------------------------------------
router.post("/portal-inbox/:customerId/reply", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tenantId = getTenantId(req);
  const customerId = parseInt(req.params.customerId, 10);
  if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customerId" }); return; }

  const { body } = req.body as { body?: string };
  if (!body?.trim()) { res.status(400).json({ error: "body is required" }); return; }

  // Verify customer belongs to this tenant
  const [customer] = await db.select({ id: customersTable.id })
    .from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const [msg] = await db
    .insert(portalMessagesTable)
    .values({ tenantId, customerId, direction: "outbound", body: body.trim() })
    .returning();

  res.status(201).json({
    id: msg.id,
    direction: msg.direction,
    body: msg.body,
    readAt: null,
    createdAt: msg.createdAt.toISOString(),
  });
});


export default router;
