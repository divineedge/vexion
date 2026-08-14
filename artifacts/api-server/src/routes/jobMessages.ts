/**
 * Job staff message thread — STAFF-ONLY.
 *
 * These endpoints are gated by requireVerifiedStaff which hard-rejects any
 * request carrying an x-portal-token, so customer-portal sessions can never
 * reach them regardless of URL knowledge.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, jobMessagesTable, jobMessageReadsTable, jobsTable, usersTable } from "@workspace/db";
import { eq, and, ne, notExists, desc, sql, inArray } from "drizzle-orm";
import { resolveStaffSession } from "./auth";

const router: IRouter = Router();

// ── Staff-session guard ────────────────────────────────────────────────────
async function requireVerifiedStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Hard-reject portal sessions — they have no legitimate reason to reach staff-only endpoints
  if (req.headers["x-portal-token"]) {
    res.status(403).json({ error: "This endpoint is not available to portal users" });
    return;
  }

  const session = await resolveStaffSession(req);
  if (!session) {
    res.status(401).json({ error: "Valid staff session required" });
    return;
  }

  const [staffUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, session.userId),
        eq(usersTable.tenantId, session.tenantId),
        eq(usersTable.isActive, true),
      ),
    )
    .limit(1);

  if (!staffUser) {
    res.status(401).json({ error: "Staff account is inactive or not found" });
    return;
  }

  res.locals["staffTenantId"] = session.tenantId;
  res.locals["staffUserId"] = session.userId;
  next();
}

router.use("/jobs/:jobId/messages", requireVerifiedStaff);
router.use("/jobs/messages/unread-summary", requireVerifiedStaff);

// ── Helper: assert job belongs to tenant ──────────────────────────────────
async function assertJobAccess(tenantId: number, jobId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)))
    .limit(1);
  return !!row;
}

// ── GET /jobs/messages/unread-summary ─────────────────────────────────────
// Returns [{jobId, count}] for every job that has messages the caller hasn't read.
// Must be registered BEFORE the /:jobId route so Express doesn't interpret
// "messages" as a jobId path param.
router.get("/jobs/messages/unread-summary", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const userId = res.locals["staffUserId"] as number;

  // Count unread messages per job: messages not sent by the caller that have no read record for the caller
  const rows = await db
    .select({
      jobId: jobMessagesTable.jobId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(jobMessagesTable)
    .where(
      and(
        eq(jobMessagesTable.tenantId, tenantId),
        ne(jobMessagesTable.senderId, userId),
        notExists(
          db
            .select({ mid: jobMessageReadsTable.messageId })
            .from(jobMessageReadsTable)
            .where(
              and(
                eq(jobMessageReadsTable.messageId, jobMessagesTable.id),
                eq(jobMessageReadsTable.userId, userId),
              ),
            ),
        ),
      ),
    )
    .groupBy(jobMessagesTable.jobId);

  res.json(rows);
});

// ── GET /jobs/:jobId/messages/unread-count ────────────────────────────────
router.get("/jobs/:jobId/messages/unread-count", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const userId = res.locals["staffUserId"] as number;
  const jobId = parseInt(req.params.jobId, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }

  if (!(await assertJobAccess(tenantId, jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(jobMessagesTable)
    .where(
      and(
        eq(jobMessagesTable.tenantId, tenantId),
        eq(jobMessagesTable.jobId, jobId),
        ne(jobMessagesTable.senderId, userId),
        notExists(
          db
            .select({ mid: jobMessageReadsTable.messageId })
            .from(jobMessageReadsTable)
            .where(
              and(
                eq(jobMessageReadsTable.messageId, jobMessagesTable.id),
                eq(jobMessageReadsTable.userId, userId),
              ),
            ),
        ),
      ),
    );

  res.json({ count: count ?? 0 });
});

// ── GET /jobs/:jobId/messages ─────────────────────────────────────────────
// Returns messages newest-last. Marks all non-own messages as read.
router.get("/jobs/:jobId/messages", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const userId = res.locals["staffUserId"] as number;
  const jobId = parseInt(req.params.jobId, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }

  if (!(await assertJobAccess(tenantId, jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const rows = await db
    .select({
      message: jobMessagesTable,
      senderName: usersTable.name,
      senderRole: usersTable.role,
    })
    .from(jobMessagesTable)
    .leftJoin(usersTable, eq(jobMessagesTable.senderId, usersTable.id))
    .where(
      and(
        eq(jobMessagesTable.tenantId, tenantId),
        eq(jobMessagesTable.jobId, jobId),
      ),
    )
    .orderBy(jobMessagesTable.createdAt);

  const result = rows.map(r => ({
    ...r.message,
    senderName: r.senderName ?? "Unknown",
    senderRole: r.senderRole ?? "staff",
    createdAt: r.message.createdAt.toISOString(),
  }));

  // Mark all messages from OTHER senders as read for this user (upsert)
  const unreadIds = rows
    .filter(r => r.message.senderId !== userId)
    .map(r => r.message.id);

  if (unreadIds.length > 0) {
    await db
      .insert(jobMessageReadsTable)
      .values(unreadIds.map(messageId => ({ messageId, userId })))
      .onConflictDoNothing();
  }

  res.json(result);
});

// ── POST /jobs/:jobId/messages ────────────────────────────────────────────
router.post("/jobs/:jobId/messages", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const userId = res.locals["staffUserId"] as number;
  const jobId = parseInt(req.params.jobId, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }

  if (!(await assertJobAccess(tenantId, jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const { body } = req.body as { body?: string };
  const trimmedBody = (body ?? "").trim();
  if (!trimmedBody) { res.status(400).json({ error: "body is required" }); return; }
  if (trimmedBody.length > 4000) { res.status(400).json({ error: "Message must be 4000 characters or fewer" }); return; }

  const [msg] = await db
    .insert(jobMessagesTable)
    .values({ tenantId, jobId, senderId: userId, body: trimmedBody })
    .returning();

  // Mark the sender's own message as read immediately so it doesn't count as unread for them
  await db
    .insert(jobMessageReadsTable)
    .values({ messageId: msg.id, userId })
    .onConflictDoNothing();

  const [sender] = await db
    .select({ name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  res.status(201).json({
    ...msg,
    senderName: sender?.name ?? "Unknown",
    senderRole: sender?.role ?? "staff",
    createdAt: msg.createdAt.toISOString(),
  });
});

export default router;
