import { Router, type IRouter } from "express";
import {
  db,
  jobMessageReadsTable,
  jobMessagesTable,
  staffMessageReadsTable,
  staffMessagesTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, ne, notExists, sql, lt } from "drizzle-orm";
import { requireVerifiedStaff, verifiedStaffIdentity } from "../lib/verifiedStaff";
import { ADMIN_ROLES, getCallerRole } from "../lib/roles";
import { visibleJobMessageIds } from "../lib/jobMessageAccess";
import { sendStaffPush } from "../lib/pushNotifications";

const router: IRouter = Router();
const LEGACY_MANAGEMENT_ROLES = new Set(["owner", "admin", "manager", "admin_office"]);

router.use("/staff-messages", requireVerifiedStaff);

async function canManageAllThreads(tenantId: number, userId: number): Promise<boolean> {
  const role = await getCallerRole(tenantId, userId);
  return ADMIN_ROLES.has(role) || LEGACY_MANAGEMENT_ROLES.has(role);
}

async function resolveThread(
  tenantId: number,
  callerId: number,
  requestedId: number,
): Promise<{ id: number; name: string; role: string } | null> {
  if (requestedId !== callerId && !(await canManageAllThreads(tenantId, callerId))) return null;
  const [threadUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.id, requestedId), eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true)))
    .limit(1);
  return threadUser ?? null;
}

router.get("/staff-messages/unread-summary", async (_req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const manageAll = await canManageAllThreads(tenantId, userId);
  const generalConditions = [
    eq(staffMessagesTable.tenantId, tenantId),
    ne(staffMessagesTable.senderId, userId),
    notExists(db.select({ id: staffMessageReadsTable.messageId }).from(staffMessageReadsTable).where(and(
      eq(staffMessageReadsTable.messageId, staffMessagesTable.id),
      eq(staffMessageReadsTable.userId, userId),
    ))),
  ];
  if (!manageAll) generalConditions.push(eq(staffMessagesTable.threadUserId, userId));

  const visibleJobIds = await visibleJobMessageIds(tenantId, userId);
  const [[generalRow], jobRows] = await Promise.all([
    db.select({ count: sql<number>`cast(count(*) as int)` }).from(staffMessagesTable).where(and(...generalConditions)),
    visibleJobIds.length === 0 ? Promise.resolve<Array<{ count: number }>>([]) : db.select({ count: sql<number>`cast(count(*) as int)` }).from(jobMessagesTable).where(and(
      eq(jobMessagesTable.tenantId, tenantId),
      inArray(jobMessagesTable.jobId, visibleJobIds),
      ne(jobMessagesTable.senderId, userId),
      notExists(db.select({ id: jobMessageReadsTable.messageId }).from(jobMessageReadsTable).where(and(
        eq(jobMessageReadsTable.messageId, jobMessagesTable.id),
        eq(jobMessageReadsTable.userId, userId),
      ))),
    )),
  ]);
  const general = generalRow?.count ?? 0;
  const job = jobRows.reduce((total, row) => total + row.count, 0);
  res.json({ general, job, total: general + job });
});

router.get("/staff-messages", async (_req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const manageAll = await canManageAllThreads(tenantId, userId);
  const result = await db.execute<{
    threadUserId: number; threadUserName: string; threadUserRole: string;
    lastMessage: string | null; lastMessageAt: Date | null; unreadCount: number;
  }>(sql`
    select u.id as "threadUserId", u.name as "threadUserName", u.role as "threadUserRole",
      lm.body as "lastMessage", lm.created_at as "lastMessageAt",
      coalesce(uc.unread_count, 0)::int as "unreadCount"
    from users u
    left join lateral (
      select sm.id, sm.body, sm.created_at
      from staff_messages sm
      where sm.tenant_id = ${tenantId} and sm.thread_user_id = u.id
      order by sm.created_at desc, sm.id desc limit 1
    ) lm on true
    left join lateral (
      select count(*)::int unread_count
      from staff_messages sm
      where sm.tenant_id = ${tenantId} and sm.thread_user_id = u.id and sm.sender_id <> ${userId}
        and not exists (select 1 from staff_message_reads smr where smr.message_id = sm.id and smr.user_id = ${userId})
    ) uc on true
    where u.tenant_id = ${tenantId} and u.is_active = true
      and ${manageAll ? sql`(lm.id is not null or u.id = ${userId})` : sql`u.id = ${userId}`}
    order by lm.created_at desc nulls last, u.name asc
  `);
  res.json(result.rows.map((row) => ({
    ...row,
    lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
    unreadCount: Number(row.unreadCount),
  })));
});

router.get("/staff-messages/:threadUserId", async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const threadUserId = Number(req.params.threadUserId);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  const beforeId = Number(req.query.beforeId);
  if (!Number.isInteger(threadUserId)) { res.status(400).json({ error: "Invalid threadUserId" }); return; }
  if (!(await resolveThread(tenantId, userId, threadUserId))) {
    res.status(404).json({ error: "Staff thread not found" }); return;
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        message: staffMessagesTable,
        senderName: usersTable.name,
        senderRole: usersTable.role,
        readCount: sql<number>`cast((select count(*) from staff_message_reads smr where smr.message_id = ${staffMessagesTable.id} and smr.user_id <> ${staffMessagesTable.senderId}) as int)`,
      })
      .from(staffMessagesTable)
      .leftJoin(usersTable, and(eq(staffMessagesTable.senderId, usersTable.id), eq(usersTable.tenantId, tenantId)))
      .where(and(
        eq(staffMessagesTable.tenantId, tenantId),
        eq(staffMessagesTable.threadUserId, threadUserId),
        ...(Number.isInteger(beforeId) && beforeId > 0 ? [lt(staffMessagesTable.id, beforeId)] : []),
      ))
      .orderBy(desc(staffMessagesTable.id))
      .limit(limit);
    const returnedNonOwnIds = rows.filter(row => row.message.senderId !== userId).map(row => row.message.id);
    if (returnedNonOwnIds.length) {
      await tx.insert(staffMessageReadsTable)
        .values(returnedNonOwnIds.map(messageId => ({ messageId, userId })))
        .onConflictDoNothing();
    }
    return rows.reverse().map((row) => ({
      ...row.message,
      senderName: row.senderName ?? "Unknown",
      senderRole: row.senderRole ?? "staff",
      createdAt: row.message.createdAt.toISOString(),
      isReadByCaller: true,
      readCount: row.readCount,
      readByOthers: row.readCount > 0,
    }));
  });
  res.json(result);
});

router.post("/staff-messages/:threadUserId", async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const threadUserId = Number(req.params.threadUserId);
  if (!Number.isInteger(threadUserId)) { res.status(400).json({ error: "Invalid threadUserId" }); return; }
  if (!(await resolveThread(tenantId, userId, threadUserId))) {
    res.status(404).json({ error: "Staff thread not found" }); return;
  }
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const clientMessageId = typeof req.body?.clientMessageId === "string" ? req.body.clientMessageId : "";
  if (!body) { res.status(400).json({ error: "body is required" }); return; }
  if (body.length > 4000) { res.status(400).json({ error: "Message must be 4000 characters or fewer" }); return; }
  if (clientMessageId.length < 8 || clientMessageId.length > 100) { res.status(400).json({ error: "clientMessageId is required" }); return; }

  const [sender] = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId))).limit(1);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(staffMessagesTable).where(and(
      eq(staffMessagesTable.tenantId, tenantId), eq(staffMessagesTable.senderId, userId), eq(staffMessagesTable.clientMessageId, clientMessageId),
    )).limit(1);
    if (existing) return { message: existing, inserted: false };
    const [inserted] = await tx.insert(staffMessagesTable).values({ tenantId, threadUserId, senderId: userId, body, clientMessageId }).onConflictDoNothing().returning();
    const created = inserted ?? (await tx.select().from(staffMessagesTable).where(and(
      eq(staffMessagesTable.tenantId, tenantId), eq(staffMessagesTable.senderId, userId), eq(staffMessagesTable.clientMessageId, clientMessageId),
    )).limit(1))[0];
    if (!created) throw new Error("Unable to create message");
    await tx.insert(staffMessageReadsTable).values({ messageId: created.id, userId }).onConflictDoNothing();
    return { message: created, inserted: Boolean(inserted) };
  });
  const { message } = result;
  if (message.threadUserId !== threadUserId) { res.status(409).json({ error: "clientMessageId is already used in another staff thread" }); return; }
  if (result.inserted) {
    const senderIsManagement = await canManageAllThreads(tenantId, userId);
    // Staff-owned threads are private to their owner; an owner writing a thread
    // notifies management users, while management writing notifies the owner.
    const recipientIds = senderIsManagement
      ? [threadUserId]
      : (await Promise.all((await db.select({ id: usersTable.id }).from(usersTable).where(and(
        eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true),
      ))).map(async u => (await canManageAllThreads(tenantId, u.id)) ? u.id : null))).filter((id): id is number => id !== null);
    void sendStaffPush({
      tenantId, recipientUserIds: recipientIds.filter(id => id !== userId),
      eventKey: `staff-message:${message.id}`, title: sender?.name ?? "New message",
      body: message.body, data: { type: "staff_message", route: "messages", threadUserId },
    });
  }
  const [{ count: readCount }] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(staffMessageReadsTable)
    .where(and(eq(staffMessageReadsTable.messageId, message.id), ne(staffMessageReadsTable.userId, message.senderId)));
  res.status(201).json({
    ...message,
    senderName: sender?.name ?? "Unknown",
    senderRole: sender?.role ?? "staff",
    createdAt: message.createdAt.toISOString(),
    isReadByCaller: true,
    readCount: readCount ?? 0,
    readByOthers: (readCount ?? 0) > 0,
  });
});

export default router;