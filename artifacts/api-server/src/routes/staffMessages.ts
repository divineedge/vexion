import { Router, type IRouter } from "express";
import {
  db,
  crewMembersTable,
  crewsTable,
  divisionsTable,
  jobMessageReadsTable,
  jobMessagesTable,
  staffMessageConversationsTable,
  staffMessageReadsTable,
  staffMessagesTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, ne, notExists, sql, lt } from "drizzle-orm";
import { requireVerifiedStaff, verifiedStaffIdentity } from "../lib/verifiedStaff";
import { ADMIN_ROLES, getCallerRole } from "../lib/roles";
import { visibleJobMessageIds } from "../lib/jobMessageAccess";
import { sendStaffPush } from "../lib/pushNotifications";

const router: IRouter = Router();
const LEGACY_MANAGEMENT_ROLES = new Set(["owner", "admin", "manager", "admin_office"]);
const AUDIENCE_TYPES = ["company", "crew", "technicians", "division", "admins", "staff"] as const;
type AudienceType = typeof AUDIENCE_TYPES[number];
type AudienceRequest = { audienceType: AudienceType; audienceId: number | null };
type AudienceResolution = AudienceRequest & { audienceKey: string; title: string; memberIds: number[] };

function jsonIds(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isInteger);
  if (typeof value === "string") {
    try { return jsonIds(JSON.parse(value)); } catch { return []; }
  }
  return [];
}

async function audienceMembers(tenantId: number, audienceType: AudienceType, audienceId: number | null): Promise<number[]> {
  if (audienceType === "company") {
    const rows = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true)));
    return rows.map(row => row.id);
  }
  if (audienceType === "technicians") {
    const rows = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true), eq(usersTable.role, "technician")));
    return rows.map(row => row.id);
  }
  if (audienceType === "admins") {
    const rows = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true), inArray(usersTable.role, [...ADMIN_ROLES, ...LEGACY_MANAGEMENT_ROLES])));
    return rows.map(row => row.id);
  }
  if (!Number.isInteger(audienceId)) return [];
  const id = audienceId as number;
  if (audienceType === "staff") {
    const [row] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true))).limit(1);
    return row ? [row.id] : [];
  }
  if (audienceType === "crew") {
    const [crew] = await db.select({ id: crewsTable.id, managerId: crewsTable.managerId }).from(crewsTable)
      .where(and(eq(crewsTable.id, id), eq(crewsTable.tenantId, tenantId))).limit(1);
    if (!crew) return [];
    const members = await db.select({ userId: crewMembersTable.userId }).from(crewMembersTable)
      .where(and(eq(crewMembersTable.crewId, id), eq(crewMembersTable.tenantId, tenantId)));
    const ids = members.map(row => row.userId);
    if (crew.managerId) ids.push(crew.managerId);
    const active = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true), inArray(usersTable.id, [...new Set(ids)])));
    return active.map(row => row.id);
  }
  const [division] = await db.select().from(divisionsTable)
    .where(and(eq(divisionsTable.id, id), eq(divisionsTable.tenantId, tenantId), eq(divisionsTable.isArchived, 0))).limit(1);
  if (!division) return [];
  const explicitIds = jsonIds(division.technicianIds);
  const crewIds = jsonIds(division.crewIds);
  if (crewIds.length) {
    const members = await db.select({ userId: crewMembersTable.userId }).from(crewMembersTable)
      .where(and(eq(crewMembersTable.tenantId, tenantId), inArray(crewMembersTable.crewId, crewIds)));
    explicitIds.push(...members.map(row => row.userId));
    const managers = await db.select({ managerId: crewsTable.managerId }).from(crewsTable)
      .where(and(eq(crewsTable.tenantId, tenantId), inArray(crewsTable.id, crewIds)));
    explicitIds.push(...managers.map(row => row.managerId).filter((id): id is number => Number.isInteger(id)));
  }
  if (!explicitIds.length) return [];
  const active = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true), inArray(usersTable.id, [...new Set(explicitIds)])));
  return active.map(row => row.id);
}

async function resolveAudience(tenantId: number, callerId: number, input: Partial<AudienceRequest>, requireSend = true): Promise<AudienceResolution | null> {
  const audienceType = input.audienceType;
  const audienceId = input.audienceId == null ? null : Number(input.audienceId);
  if (!AUDIENCE_TYPES.includes(audienceType as AudienceType)) return null;
  const type = audienceType as AudienceType;
  if (type === "company" && requireSend && !(await canManageAllThreads(tenantId, callerId))) return null;
  const memberIds = await audienceMembers(tenantId, type, audienceId);
  if (!memberIds.length && type !== "company") return null;
  let title = type === "company" ? "Company-wide" : type === "technicians" ? "All technicians" : type === "admins" ? "All admins" : "";
  if (type === "staff" || type === "crew" || type === "division") {
    const table = type === "staff" ? usersTable : type === "crew" ? crewsTable : divisionsTable;
    const [row] = await db.select({ name: type === "staff" ? usersTable.name : type === "crew" ? crewsTable.name : divisionsTable.name })
      .from(table as typeof usersTable).where(and(
        eq((type === "staff" ? usersTable.id : type === "crew" ? crewsTable.id : divisionsTable.id), audienceId!),
        eq((type === "staff" ? usersTable.tenantId : type === "crew" ? crewsTable.tenantId : divisionsTable.tenantId), tenantId),
      )).limit(1);
    title = row?.name ?? "";
    if (type === "division") {
      const [division] = await db.select({ category: divisionsTable.category }).from(divisionsTable)
        .where(and(eq(divisionsTable.id, audienceId!), eq(divisionsTable.tenantId, tenantId))).limit(1);
      if (division?.category) title = `${title} · ${division.category}`;
    }
  }
  if (!title) return null;
  const sharedAudience = memberIds.includes(callerId) || await canManageAllThreads(tenantId, callerId);
  const senderScope = sharedAudience ? "" : `:sender:${callerId}`;
  return { audienceType: type, audienceId, audienceKey: `${type}:${audienceId ?? "all"}${senderScope}`, title, memberIds };
}

async function getOrCreateConversation(tenantId: number, callerId: number, audience: AudienceResolution) {
  const [existing] = await db.select().from(staffMessageConversationsTable).where(and(
    eq(staffMessageConversationsTable.tenantId, tenantId),
    eq(staffMessageConversationsTable.audienceKey, audience.audienceKey),
  )).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(staffMessageConversationsTable).values({
    tenantId, audienceType: audience.audienceType, audienceId: audience.audienceId,
    audienceKey: audience.audienceKey, title: audience.title, createdBy: callerId,
  }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(staffMessageConversationsTable).where(and(
    eq(staffMessageConversationsTable.tenantId, tenantId),
    eq(staffMessageConversationsTable.audienceKey, audience.audienceKey),
  )).limit(1))[0];
}

async function canViewGroupConversation(
  tenantId: number,
  userId: number,
  conversation: typeof staffMessageConversationsTable.$inferSelect,
  manageAll: boolean,
): Promise<boolean> {
  if (manageAll || isScopedConversationCreator(conversation, userId)) return true;
  const members = await audienceMembers(tenantId, conversation.audienceType as AudienceType, conversation.audienceId);
  return members.includes(userId);
}

function isScopedConversationCreator(
  conversation: typeof staffMessageConversationsTable.$inferSelect,
  userId: number,
): boolean {
  return conversation.createdBy === userId && conversation.audienceKey.endsWith(`:sender:${userId}`);
}

async function visibleGroupConversationIds(tenantId: number, userId: number): Promise<number[]> {
  const conversations = await db.select().from(staffMessageConversationsTable)
    .where(eq(staffMessageConversationsTable.tenantId, tenantId));
  const visible: number[] = [];
  for (const conversation of conversations) {
    const members = await audienceMembers(tenantId, conversation.audienceType as AudienceType, conversation.audienceId);
    if (members.includes(userId) || isScopedConversationCreator(conversation, userId)) visible.push(conversation.id);
  }
  return visible;
}

async function groupSummaries(tenantId: number, userId: number, manageAll: boolean) {
  const conversations = await db.select().from(staffMessageConversationsTable)
    .where(eq(staffMessageConversationsTable.tenantId, tenantId));
  const rows: Array<Record<string, unknown>> = [];
  for (const conversation of conversations) {
    const members = await audienceMembers(tenantId, conversation.audienceType as AudienceType, conversation.audienceId);
    if (!(await canViewGroupConversation(tenantId, userId, conversation, manageAll))) continue;
    const receivesUnread = members.includes(userId) || isScopedConversationCreator(conversation, userId);
    const messages = await db.select({ body: staffMessagesTable.body, createdAt: staffMessagesTable.createdAt })
      .from(staffMessagesTable).where(eq(staffMessagesTable.conversationId, conversation.id))
      .orderBy(desc(staffMessagesTable.id)).limit(1);
    const unread = receivesUnread
      ? await db.select({ count: sql<number>`cast(count(*) as int)` }).from(staffMessagesTable)
        .where(and(eq(staffMessagesTable.conversationId, conversation.id), ne(staffMessagesTable.senderId, userId),
          notExists(db.select({ id: staffMessageReadsTable.messageId }).from(staffMessageReadsTable).where(and(
            eq(staffMessageReadsTable.messageId, staffMessagesTable.id), eq(staffMessageReadsTable.userId, userId),
          )))))
      : [{ count: 0 }];
    rows.push({
      conversationId: conversation.id, threadUserId: conversation.createdBy,
      threadUserName: conversation.title, threadUserRole: "group",
      audienceType: conversation.audienceType, audienceId: conversation.audienceId,
      isSharedAudience: !conversation.audienceKey.includes(":sender:"),
      lastMessage: messages[0]?.body ?? null,
      lastMessageAt: messages[0]?.createdAt?.toISOString() ?? null,
      unreadCount: Number(unread[0]?.count ?? 0),
    });
  }
  return rows;
}

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
    isNull(staffMessagesTable.conversationId),
    ne(staffMessagesTable.senderId, userId),
    notExists(db.select({ id: staffMessageReadsTable.messageId }).from(staffMessageReadsTable).where(and(
      eq(staffMessageReadsTable.messageId, staffMessagesTable.id),
      eq(staffMessageReadsTable.userId, userId),
    ))),
  ];
  if (!manageAll) generalConditions.push(eq(staffMessagesTable.threadUserId, userId));

  const groupIds = await visibleGroupConversationIds(tenantId, userId);
  const visibleJobIds = await visibleJobMessageIds(tenantId, userId);
  const [[generalRow], groupRows, jobRows] = await Promise.all([
    db.select({ count: sql<number>`cast(count(*) as int)` }).from(staffMessagesTable).where(and(...generalConditions)),
    groupIds.length === 0 ? Promise.resolve<Array<{ count: number }>>([]) : db.select({ count: sql<number>`cast(count(*) as int)` }).from(staffMessagesTable).where(and(
      eq(staffMessagesTable.tenantId, tenantId),
      inArray(staffMessagesTable.conversationId, groupIds),
      ne(staffMessagesTable.senderId, userId),
      notExists(db.select({ id: staffMessageReadsTable.messageId }).from(staffMessageReadsTable).where(and(
        eq(staffMessageReadsTable.messageId, staffMessagesTable.id), eq(staffMessageReadsTable.userId, userId),
      ))),
    )),
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
  const general = (generalRow?.count ?? 0) + groupRows.reduce((total, row) => total + row.count, 0);
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
      where sm.tenant_id = ${tenantId} and sm.thread_user_id = u.id and sm.conversation_id is null
      order by sm.created_at desc, sm.id desc limit 1
    ) lm on true
    left join lateral (
      select count(*)::int unread_count
      from staff_messages sm
      where sm.tenant_id = ${tenantId} and sm.thread_user_id = u.id and sm.conversation_id is null and sm.sender_id <> ${userId}
        and not exists (select 1 from staff_message_reads smr where smr.message_id = sm.id and smr.user_id = ${userId})
    ) uc on true
    where u.tenant_id = ${tenantId} and u.is_active = true
      and ${manageAll ? sql`(lm.id is not null or u.id = ${userId})` : sql`u.id = ${userId}`}
    order by lm.created_at desc nulls last, u.name asc
  `);
  const legacyRows = result.rows.map((row) => ({
    ...row,
    lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
    unreadCount: Number(row.unreadCount),
    audienceType: "staff",
    audienceId: row.threadUserId,
    conversationId: null,
  }));
  const groups = await groupSummaries(tenantId, userId, manageAll);
  res.json([...legacyRows, ...groups].sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(String(a.lastMessageAt)).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(String(b.lastMessageAt)).getTime() : 0;
    return bTime - aTime || String(a.threadUserName).localeCompare(String(b.threadUserName));
  }));
});

router.get("/staff-messages/audiences", async (_req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const canSendCompanyWide = await canManageAllThreads(tenantId, userId);
  const [users, crews, divisions] = await Promise.all([
    db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role }).from(usersTable)
      .where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true))).orderBy(usersTable.name),
    db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable)
      .where(eq(crewsTable.tenantId, tenantId)).orderBy(crewsTable.name),
    db.select({ id: divisionsTable.id, name: divisionsTable.name, category: divisionsTable.category }).from(divisionsTable)
      .where(and(eq(divisionsTable.tenantId, tenantId), eq(divisionsTable.isArchived, 0))).orderBy(divisionsTable.name),
  ]);
  const option = async (audienceType: AudienceType, audienceId: number | null, label: string, description: string, canSend = true) => ({
    audienceType, audienceId, label, description,
    memberCount: (await audienceMembers(tenantId, audienceType, audienceId)).length,
    canSend,
  });
  const options = [
    await option("company", null, "Company-wide", "Everyone in the company", canSendCompanyWide),
    ...(await Promise.all(crews.map(crew => option("crew", crew.id, crew.name, "Crew members and manager")))),
    await option("technicians", null, "All technicians", "Every active technician"),
    ...(await Promise.all(divisions.map(division => option("division", division.id, division.category ? `${division.name} · ${division.category}` : division.name, "Explicit staff and crew members")))),
    await option("admins", null, "All admins", "Owners and managers"),
    ...(await Promise.all(users.map(user => option("staff", user.id, user.name, user.role.replaceAll("_", " ")) ))),
  ];
  res.json(options);
});

async function groupMessageResponse(message: typeof staffMessagesTable.$inferSelect, userId: number) {
  const [sender] = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable)
    .where(eq(usersTable.id, message.senderId)).limit(1);
  const [{ count: readCount }] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(staffMessageReadsTable)
    .where(and(eq(staffMessageReadsTable.messageId, message.id), ne(staffMessageReadsTable.userId, message.senderId)));
  return {
    ...message,
    senderName: sender?.name ?? "Unknown",
    senderRole: sender?.role ?? "staff",
    createdAt: message.createdAt.toISOString(),
    isReadByCaller: true,
    readCount: readCount ?? 0,
    readByOthers: (readCount ?? 0) > 0,
    conversationId: message.conversationId,
    callerId: userId,
  };
}

async function createGroupMessage(
  tenantId: number,
  userId: number,
  audience: AudienceResolution,
  body: string,
  clientMessageId: string,
  existingConversation?: typeof staffMessageConversationsTable.$inferSelect,
) {
  const conversation = existingConversation ?? await getOrCreateConversation(tenantId, userId, audience);
  if (!conversation) throw new Error("Unable to create staff conversation");
  const message = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(staffMessagesTable).where(and(
      eq(staffMessagesTable.tenantId, tenantId), eq(staffMessagesTable.senderId, userId),
      eq(staffMessagesTable.clientMessageId, clientMessageId),
    )).limit(1);
    if (existing) return existing;
    const [inserted] = await tx.insert(staffMessagesTable).values({
      tenantId, threadUserId: conversation.createdBy, conversationId: conversation.id, senderId: userId, body, clientMessageId,
    }).onConflictDoNothing().returning();
    const created = inserted ?? (await tx.select().from(staffMessagesTable).where(and(
      eq(staffMessagesTable.tenantId, tenantId), eq(staffMessagesTable.senderId, userId),
      eq(staffMessagesTable.clientMessageId, clientMessageId),
    )).limit(1))[0];
    if (!created) throw new Error("Unable to create message");
    await tx.insert(staffMessageReadsTable).values({ messageId: created.id, userId }).onConflictDoNothing();
    return created;
  });
  if (message.conversationId !== conversation.id) return { conflict: true as const, message };
  await db.update(staffMessageConversationsTable).set({ updatedAt: new Date() })
    .where(eq(staffMessageConversationsTable.id, conversation.id));
  return { conflict: false as const, message };
}

router.post("/staff-messages/audience", async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const clientMessageId = typeof req.body?.clientMessageId === "string" ? req.body.clientMessageId : "";
  if (!body) { res.status(400).json({ error: "body is required" }); return; }
  if (body.length > 4000) { res.status(400).json({ error: "Message must be 4000 characters or fewer" }); return; }
  if (clientMessageId.length < 8 || clientMessageId.length > 100) { res.status(400).json({ error: "clientMessageId is required" }); return; }
  const audience = await resolveAudience(tenantId, userId, req.body);
  if (!audience) { res.status(404).json({ error: "Staff audience not found or not allowed" }); return; }
  const created = await createGroupMessage(tenantId, userId, audience, body, clientMessageId);
  if (created.conflict) { res.status(409).json({ error: "clientMessageId is already used in another staff conversation" }); return; }
  res.status(201).json(await groupMessageResponse(created.message, userId));
});

router.get("/staff-messages/conversations/:conversationId", async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const conversationId = Number(req.params.conversationId);
  const [conversation] = await db.select().from(staffMessageConversationsTable).where(and(
    eq(staffMessageConversationsTable.id, conversationId), eq(staffMessageConversationsTable.tenantId, tenantId),
  )).limit(1);
  if (!conversation) { res.status(404).json({ error: "Staff conversation not found" }); return; }
  const manageAll = await canManageAllThreads(tenantId, userId);
  if (!(await canViewGroupConversation(tenantId, userId, conversation, manageAll))) {
    res.status(404).json({ error: "Staff conversation not found" }); return;
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  const beforeId = Number(req.query.beforeId);
  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(staffMessagesTable).where(and(
      eq(staffMessagesTable.tenantId, tenantId), eq(staffMessagesTable.conversationId, conversationId),
      ...(Number.isInteger(beforeId) && beforeId > 0 ? [lt(staffMessagesTable.id, beforeId)] : []),
    )).orderBy(desc(staffMessagesTable.id)).limit(limit);
    const incomingIds = rows.filter(row => row.senderId !== userId).map(row => row.id);
    if (incomingIds.length) await tx.insert(staffMessageReadsTable).values(incomingIds.map(messageId => ({ messageId, userId }))).onConflictDoNothing();
    return rows.reverse();
  });
  res.json(await Promise.all(result.map(message => groupMessageResponse(message, userId))));
});

router.post("/staff-messages/conversations/:conversationId", async (req, res): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const conversationId = Number(req.params.conversationId);
  const [conversation] = await db.select().from(staffMessageConversationsTable).where(and(
    eq(staffMessageConversationsTable.id, conversationId), eq(staffMessageConversationsTable.tenantId, tenantId),
  )).limit(1);
  if (!conversation) { res.status(404).json({ error: "Staff conversation not found" }); return; }
  const manageAll = await canManageAllThreads(tenantId, userId);
  if (!(await canViewGroupConversation(tenantId, userId, conversation, manageAll))) {
    res.status(404).json({ error: "Staff conversation not found" }); return;
  }
  const audience = await resolveAudience(tenantId, userId, { audienceType: conversation.audienceType as AudienceType, audienceId: conversation.audienceId });
  if (!audience) { res.status(404).json({ error: "Staff conversation not found or not allowed" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const clientMessageId = typeof req.body?.clientMessageId === "string" ? req.body.clientMessageId : "";
  if (!body) { res.status(400).json({ error: "body is required" }); return; }
  if (body.length > 4000) { res.status(400).json({ error: "Message must be 4000 characters or fewer" }); return; }
  if (clientMessageId.length < 8 || clientMessageId.length > 100) { res.status(400).json({ error: "clientMessageId is required" }); return; }
  const created = await createGroupMessage(tenantId, userId, audience, body, clientMessageId, conversation);
  if (created.conflict) { res.status(409).json({ error: "clientMessageId is already used in another staff conversation" }); return; }
  res.status(201).json(await groupMessageResponse(created.message, userId));
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
        isNull(staffMessagesTable.conversationId),
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