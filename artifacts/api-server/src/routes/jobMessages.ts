/**
 * Job staff message thread — STAFF-ONLY.
 *
 * These endpoints are gated by requireVerifiedStaff which hard-rejects any
 * request carrying an x-portal-token, so customer-portal sessions can never
 * reach them regardless of URL knowledge.
 */
import { Router, type IRouter } from "express";
import { db, crewMembersTable, crewsTable, jobMessagesTable, jobMessageReadsTable, jobsTable, usersTable } from "@workspace/db";
import { eq, and, ne, notExists, sql, inArray, desc, lt } from "drizzle-orm";
import { requireVerifiedStaff, verifiedStaffIdentity } from "../lib/verifiedStaff";
import { canAccessJobMessages, visibleJobMessageIds } from "../lib/jobMessageAccess";
import { sendStaffPush } from "../lib/pushNotifications";

const router: IRouter = Router();

router.use("/jobs/:jobId/messages", requireVerifiedStaff);
router.use("/jobs/messages/unread-summary", requireVerifiedStaff);

// ── Helper: assert job belongs to tenant ──────────────────────────────────
async function assertJobAccess(tenantId: number, userId: number, jobId: number): Promise<boolean> {
  return canAccessJobMessages(tenantId, userId, jobId);
}

// ── GET /jobs/messages/unread-summary ─────────────────────────────────────
// Returns [{jobId, count}] for every job that has messages the caller hasn't read.
// Must be registered BEFORE the /:jobId route so Express doesn't interpret
// "messages" as a jobId path param.
router.get("/jobs/messages/unread-summary", async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const visibleJobIds = await visibleJobMessageIds(tenantId, userId);
  if (visibleJobIds.length === 0) { res.json([]); return; }

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
        inArray(jobMessagesTable.jobId, visibleJobIds),
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

  if (!(await assertJobAccess(tenantId, userId, jobId))) {
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
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  const beforeId = Number(req.query.beforeId);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }

  if (!(await assertJobAccess(tenantId, userId, jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        message: jobMessagesTable,
        senderName: usersTable.name,
        senderRole: usersTable.role,
        readCount: sql<number>`cast((select count(*) from job_message_reads jmr where jmr.message_id = ${jobMessagesTable.id} and jmr.user_id <> ${jobMessagesTable.senderId}) as int)`,
      })
      .from(jobMessagesTable)
      .leftJoin(usersTable, and(eq(jobMessagesTable.senderId, usersTable.id), eq(usersTable.tenantId, tenantId)))
      .where(and(
        eq(jobMessagesTable.tenantId, tenantId),
        eq(jobMessagesTable.jobId, jobId),
        ...(Number.isInteger(beforeId) && beforeId > 0 ? [lt(jobMessagesTable.id, beforeId)] : []),
      ))
      .orderBy(desc(jobMessagesTable.id))
      .limit(limit);
    const returnedNonOwnIds = rows.filter(row => row.message.senderId !== userId).map(row => row.message.id);
    if (returnedNonOwnIds.length) {
      await tx.insert(jobMessageReadsTable)
        .values(returnedNonOwnIds.map(messageId => ({ messageId, userId })))
        .onConflictDoNothing();
    }
    return rows.reverse().map(r => ({
      ...r.message,
      senderName: r.senderName ?? "Unknown",
      senderRole: r.senderRole ?? "staff",
      createdAt: r.message.createdAt.toISOString(),
      isReadByCaller: true,
      readCount: r.readCount,
      readByOthers: r.readCount > 0,
    }));
  });
  res.json(result);
});

// ── POST /jobs/:jobId/messages ────────────────────────────────────────────
router.post("/jobs/:jobId/messages", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const userId = res.locals["staffUserId"] as number;
  const jobId = parseInt(req.params.jobId, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }

  if (!(await assertJobAccess(tenantId, userId, jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const { body, clientMessageId } = req.body as { body?: string; clientMessageId?: string };
  const trimmedBody = (body ?? "").trim();
  if (!trimmedBody) { res.status(400).json({ error: "body is required" }); return; }
  if (trimmedBody.length > 4000) { res.status(400).json({ error: "Message must be 4000 characters or fewer" }); return; }
  if (typeof clientMessageId !== "string" || clientMessageId.length < 8 || clientMessageId.length > 100) {
    res.status(400).json({ error: "clientMessageId is required" }); return;
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(jobMessagesTable).where(and(
      eq(jobMessagesTable.tenantId, tenantId),
      eq(jobMessagesTable.senderId, userId),
      eq(jobMessagesTable.clientMessageId, clientMessageId),
    )).limit(1);
    if (existing) return { message: existing, inserted: false };
    const [inserted] = await tx.insert(jobMessagesTable)
      .values({ tenantId, jobId, senderId: userId, body: trimmedBody, clientMessageId })
      .onConflictDoNothing()
      .returning();
    const created = inserted ?? (await tx.select().from(jobMessagesTable).where(and(
      eq(jobMessagesTable.tenantId, tenantId), eq(jobMessagesTable.senderId, userId), eq(jobMessagesTable.clientMessageId, clientMessageId),
    )).limit(1))[0];
    if (!created) throw new Error("Unable to create message");
    await tx.insert(jobMessageReadsTable).values({ messageId: created.id, userId }).onConflictDoNothing();
    return { message: created, inserted: Boolean(inserted) };
  });
  const { message: msg } = result;
  if (msg.jobId !== jobId) { res.status(409).json({ error: "clientMessageId is already used in another job thread" }); return; }
  const [{ count: readCount }] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(jobMessageReadsTable)
    .where(and(eq(jobMessageReadsTable.messageId, msg.id), ne(jobMessageReadsTable.userId, msg.senderId)));

  const [sender] = await db
    .select({ name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (result.inserted) {
    const [job] = await db.select({ assigneeId: jobsTable.assigneeId, crewId: jobsTable.crewId, title: jobsTable.title })
      .from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId))).limit(1);
    const recipientIds = new Set<number>();
    if (job?.assigneeId) recipientIds.add(job.assigneeId);
    if (job?.crewId) {
      const [crew] = await db.select({ managerId: crewsTable.managerId }).from(crewsTable)
        .where(and(eq(crewsTable.id, job.crewId), eq(crewsTable.tenantId, tenantId))).limit(1);
      if (crew?.managerId) recipientIds.add(crew.managerId);
      const members = await db.select({ userId: crewMembersTable.userId }).from(crewMembersTable)
        .where(and(eq(crewMembersTable.tenantId, tenantId), eq(crewMembersTable.crewId, job.crewId)));
      members.forEach(member => recipientIds.add(member.userId));
    }
    const active = recipientIds.size ? await db.select({ id: usersTable.id }).from(usersTable).where(and(
      eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true), inArray(usersTable.id, [...recipientIds]),
    )) : [];
    void sendStaffPush({
      tenantId, recipientUserIds: active.map(user => user.id).filter(id => id !== userId),
      eventKey: `job-message:${msg.id}`, title: sender?.name ?? "New job message", body: msg.body,
      data: { type: "job_message", route: "messages", jobId, title: job?.title },
    });
  }

  res.status(201).json({
    ...msg,
    senderName: sender?.name ?? "Unknown",
    senderRole: sender?.role ?? "staff",
    createdAt: msg.createdAt.toISOString(),
    isReadByCaller: true,
    readCount: readCount ?? 0,
    readByOthers: (readCount ?? 0) > 0,
  });
});

export default router;
