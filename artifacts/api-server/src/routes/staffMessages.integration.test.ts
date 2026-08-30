import { createHash } from "crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  crewMembersTable,
  crewsTable,
  db,
  divisionsTable,
  jobMessageReadsTable,
  jobMessagesTable,
  jobsTable,
  staffMessageReadsTable,
  staffMessageConversationsTable,
  staffMessagesTable,
  staffSessionsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import jobMessagesRouter from "./jobMessages";
import staffMessagesRouter from "./staffMessages";

const RUN = !!process.env.DATABASE_URL;
const tokens = new Map<number, string>();

function testApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", jobMessagesRouter);
  app.use("/api", staffMessagesRouter);
  return app;
}

describe.skipIf(!RUN)("general and job staff messages — DB-backed authorization", () => {
  const app = testApp();
  let tenantA: number;
  let tenantB: number;
  let techA: number;
  let techA2: number;
  let managerA: number;
  let managerB: number;
  let crewId: number;
  let directJob: number;
  let crewJob: number;
  let hiddenJob: number;
  let paginationJob: number;
  let divisionId: number;

  const auth = (userId: number) => ({ "x-staff-session": tokens.get(userId)! });
  async function createUser(tenantId: number, role: string, label: string) {
    const [user] = await db.insert(usersTable).values({
      tenantId,
      role,
      name: label,
      passwordHash: "test",
      email: `staff-messages-${label}-${Date.now()}-${Math.random()}@example.test`,
    }).returning({ id: usersTable.id });
    const token = `staff-msg-${tenantId}-${user.id}-${Date.now()}`;
    await db.insert(staffSessionsTable).values({
      tenantId,
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    tokens.set(user.id, token);
    return user.id;
  }

  beforeAll(async () => {
    const [a] = await db.insert(tenantsTable).values({ name: `__staff_messages_a_${Date.now()}__` }).returning({ id: tenantsTable.id });
    const [b] = await db.insert(tenantsTable).values({ name: `__staff_messages_b_${Date.now()}__` }).returning({ id: tenantsTable.id });
    tenantA = a.id;
    tenantB = b.id;
    techA = await createUser(tenantA, "technician", "Tech A");
    techA2 = await createUser(tenantA, "technician", "Tech A2");
    managerA = await createUser(tenantA, "office_manager", "Manager A");
    managerB = await createUser(tenantB, "company_owner", "Manager B");
    const [crew] = await db.insert(crewsTable).values({ tenantId: tenantA, name: "Crew A" }).returning({ id: crewsTable.id });
    crewId = crew.id;
    await db.insert(crewMembersTable).values({ tenantId: tenantA, crewId, userId: techA });
    const [division] = await db.insert(divisionsTable).values({
      tenantId: tenantA,
      name: "Irrigation",
      category: "irrigation",
      crewIds: [crewId],
      technicianIds: [techA2],
    }).returning({ id: divisionsTable.id });
    divisionId = division.id;
    const jobs = await db.insert(jobsTable).values([
      { tenantId: tenantA, title: "Direct", scheduledAt: new Date(), assigneeId: techA },
      { tenantId: tenantA, title: "Crew", scheduledAt: new Date(), crewId },
      { tenantId: tenantA, title: "Hidden", scheduledAt: new Date(), assigneeId: techA2 },
      { tenantId: tenantA, title: "Pagination", scheduledAt: new Date(), assigneeId: techA },
    ]).returning({ id: jobsTable.id });
    [directJob, crewJob, hiddenJob, paginationJob] = jobs.map((job) => job.id);
  });

  afterAll(async () => {
    const tenantIds = [tenantA, tenantB].filter(Boolean);
    await db.delete(staffMessageReadsTable).where(inArray(staffMessageReadsTable.userId, [techA, techA2, managerA, managerB].filter(Boolean)));
    await db.delete(staffMessagesTable).where(inArray(staffMessagesTable.tenantId, tenantIds));
    await db.delete(staffMessageConversationsTable).where(inArray(staffMessageConversationsTable.tenantId, tenantIds));
    await db.delete(jobMessageReadsTable).where(inArray(jobMessageReadsTable.userId, [techA, techA2, managerA, managerB].filter(Boolean)));
    await db.delete(jobMessagesTable).where(inArray(jobMessagesTable.tenantId, tenantIds));
    await db.delete(crewMembersTable).where(inArray(crewMembersTable.tenantId, tenantIds));
    await db.delete(jobsTable).where(inArray(jobsTable.tenantId, tenantIds));
    if (divisionId) await db.delete(divisionsTable).where(eq(divisionsTable.id, divisionId));
    if (crewId) await db.delete(crewsTable).where(eq(crewsTable.id, crewId));
    await db.delete(staffSessionsTable).where(inArray(staffSessionsTable.tenantId, tenantIds));
    await db.delete(usersTable).where(inArray(usersTable.tenantId, tenantIds));
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  });

  it("requires verified staff and hard-rejects portal tokens", async () => {
    expect((await request(app).get("/api/staff-messages")).status).toBe(401);
    expect((await request(app).get("/api/staff-messages").set(auth(techA)).set("x-portal-token", "portal")).status).toBe(403);
    expect((await request(app).get(`/api/jobs/${directJob}/messages`).set(auth(techA)).set("x-portal-token", "portal")).status).toBe(403);
    expect((await request(app).get("/api/staff-messages").set({ "x-user-id": String(managerA), "x-tenant-id": String(tenantA) })).status).toBe(401);
  });

  it("limits technicians to their own thread and managers to their tenant", async () => {
    const own = await request(app).get("/api/staff-messages").set(auth(techA));
    expect(own.status).toBe(200);
    expect(own.body.map((thread: { threadUserId: number }) => thread.threadUserId)).toEqual([techA]);
    expect((await request(app).get(`/api/staff-messages/${techA2}`).set(auth(techA))).status).toBe(404);
    expect((await request(app).get(`/api/staff-messages/${managerB}`).set(auth(managerA))).status).toBe(404);
    const managed = await request(app).get("/api/staff-messages").set(auth(managerA));
    expect(managed.body.map((thread: { threadUserId: number }) => thread.threadUserId)).toEqual([managerA]);
    expect(managed.body.some((thread: { threadUserId: number }) => thread.threadUserId === managerB)).toBe(false);
  });

  it("sends with sender metadata and maintains reliable unread/read counts in both directions", async () => {
    const sent = await request(app).post(`/api/staff-messages/${techA}`).set(auth(techA)).send({ body: "Need dispatch help", clientMessageId: "general-tech-a-0001" });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ senderId: techA, senderName: "Tech A", senderRole: "technician", body: "Need dispatch help" });
    expect((await request(app).get("/api/staff-messages").set(auth(managerA))).body.some((thread: { threadUserId: number }) => thread.threadUserId === techA)).toBe(true);
    expect((await request(app).get("/api/staff-messages/unread-summary").set(auth(managerA))).body.general).toBe(1);
    const managerRead = await request(app).get(`/api/staff-messages/${techA}`).set(auth(managerA));
    expect(managerRead.body[0].isReadByCaller).toBe(true);
    expect((await request(app).get("/api/staff-messages/unread-summary").set(auth(managerA))).body.general).toBe(0);

    const reply = await request(app).post(`/api/staff-messages/${techA}`).set(auth(managerA)).send({ body: "Dispatch is on it", clientMessageId: "general-manager-a-0001" });
    expect(reply.status).toBe(201);
    expect((await request(app).get("/api/staff-messages/unread-summary").set(auth(techA))).body.general).toBe(1);
    const mobilePoll = await request(app).get(`/api/staff-messages/${techA}`).set(auth(techA));
    expect(mobilePoll.body.at(-1)).toMatchObject({ senderId: managerA, senderName: "Manager A", body: "Dispatch is on it" });
    expect(mobilePoll.body.find((message: { id: number }) => message.id === sent.body.id)).toMatchObject({ isReadByCaller: true, readByOthers: true, readCount: 1 });
    expect((await request(app).get("/api/staff-messages/unread-summary").set(auth(techA))).body.general).toBe(0);
  });

  it("delivers group audiences only to their resolved tenant members", async () => {
    const companyDenied = await request(app).post("/api/staff-messages/audience").set(auth(techA)).send({
      audienceType: "company", body: "Everyone", clientMessageId: "company-denied-0001",
    });
    expect(companyDenied.status).toBe(404);

    const crewMessage = await request(app).post("/api/staff-messages/audience").set(auth(managerA)).send({
      audienceType: "crew", audienceId: crewId, body: "Crew update", clientMessageId: "crew-message-0001",
    });
    expect(crewMessage.status).toBe(201);
    const crewConversationId = crewMessage.body.conversationId;
    expect((await request(app).get("/api/staff-messages/unread-summary").set(auth(techA))).body.general).toBeGreaterThan(0);
    expect((await request(app).get(`/api/staff-messages/conversations/${crewConversationId}`).set(auth(techA))).status).toBe(200);
    expect((await request(app).get(`/api/staff-messages/conversations/${crewConversationId}`).set(auth(techA2))).status).toBe(404);
    expect((await request(app).post(`/api/staff-messages/conversations/${crewConversationId}`).set(auth(techA2)).send({
      body: "Unauthorized reply", clientMessageId: "crew-outsider-0001",
    })).status).toBe(404);
    const scopedCrewMessage = await request(app).post("/api/staff-messages/audience").set(auth(techA2)).send({
      audienceType: "crew", audienceId: crewId, body: "Question for Crew A", clientMessageId: "crew-outsider-0002",
    });
    expect(scopedCrewMessage.status).toBe(201);
    expect(scopedCrewMessage.body.conversationId).not.toBe(crewConversationId);
    expect((await request(app).get(`/api/staff-messages/conversations/${scopedCrewMessage.body.conversationId}`).set(auth(techA2))).status).toBe(200);
    const scopedReply = await request(app).post(`/api/staff-messages/conversations/${scopedCrewMessage.body.conversationId}`).set(auth(techA)).send({
      body: "Crew A response", clientMessageId: "crew-scoped-reply-0001",
    });
    expect(scopedReply.status).toBe(201);
    expect(scopedReply.body.conversationId).toBe(scopedCrewMessage.body.conversationId);
    const outsiderThreadsBeforeRead = await request(app).get("/api/staff-messages").set(auth(techA2));
    expect(outsiderThreadsBeforeRead.body.find(
      (thread: { conversationId: number; unreadCount: number }) => thread.conversationId === scopedCrewMessage.body.conversationId,
    )?.unreadCount).toBe(1);
    const scopedMessages = await request(app).get(`/api/staff-messages/conversations/${scopedCrewMessage.body.conversationId}`).set(auth(techA2));
    expect(scopedMessages.body.some((message: { body: string }) => message.body === "Crew A response")).toBe(true);
    const outsiderThreadsAfterRead = await request(app).get("/api/staff-messages").set(auth(techA2));
    expect(outsiderThreadsAfterRead.body.find(
      (thread: { conversationId: number; unreadCount: number }) => thread.conversationId === scopedCrewMessage.body.conversationId,
    )?.unreadCount).toBe(0);
    const canonicalCrewMessages = await request(app).get(`/api/staff-messages/conversations/${crewConversationId}`).set(auth(techA));
    expect(canonicalCrewMessages.body.some((message: { body: string }) => message.body === "Question for Crew A")).toBe(false);
    expect(canonicalCrewMessages.body.some((message: { body: string }) => message.body === "Crew A response")).toBe(false);

    const directThread = await request(app).get(`/api/staff-messages/${managerA}`).set(auth(managerA));
    expect(directThread.body.some((message: { id: number }) => message.id === crewMessage.body.id)).toBe(false);

    await db.update(staffMessageConversationsTable).set({ createdBy: techA })
      .where(eq(staffMessageConversationsTable.id, crewConversationId));
    await db.delete(crewMembersTable).where(and(
      eq(crewMembersTable.tenantId, tenantA),
      eq(crewMembersTable.crewId, crewId),
      eq(crewMembersTable.userId, techA),
    ));
    expect((await request(app).get(`/api/staff-messages/conversations/${crewConversationId}`).set(auth(techA))).status).toBe(404);
    expect((await request(app).post(`/api/staff-messages/conversations/${crewConversationId}`).set(auth(techA)).send({
      body: "Former member reply", clientMessageId: "crew-former-member-0001",
    })).status).toBe(404);
    await db.insert(crewMembersTable).values({ tenantId: tenantA, crewId, userId: techA });

    const divisionMessage = await request(app).post("/api/staff-messages/audience").set(auth(managerA)).send({
      audienceType: "division", audienceId: divisionId, body: "Division update", clientMessageId: "division-message-0001",
    });
    expect(divisionMessage.status).toBe(201);
    expect((await request(app).get(`/api/staff-messages/conversations/${divisionMessage.body.conversationId}`).set(auth(techA))).status).toBe(200);
    expect((await request(app).get(`/api/staff-messages/conversations/${divisionMessage.body.conversationId}`).set(auth(techA2))).status).toBe(200);

    const companyMessage = await request(app).post("/api/staff-messages/audience").set(auth(managerA)).send({
      audienceType: "company", body: "Company update", clientMessageId: "company-message-0001",
    });
    expect(companyMessage.status).toBe(201);
    expect((await request(app).get(`/api/staff-messages/conversations/${companyMessage.body.conversationId}`).set(auth(techA2))).status).toBe(200);
    expect((await request(app).get(`/api/staff-messages/conversations/${companyMessage.body.conversationId}`).set(auth(managerB))).status).toBe(404);
  });

  it("idempotently retries general sends and rejects reuse in another thread", async () => {
    const payload = { body: "Stable general", clientMessageId: "general-manager-stable-1" };
    const first = await request(app).post(`/api/staff-messages/${techA}`).set(auth(managerA)).send(payload);
    const retry = await request(app).post(`/api/staff-messages/${techA}`).set(auth(managerA)).send(payload);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect((await request(app).post(`/api/staff-messages/${techA2}`).set(auth(managerA)).send(payload)).status).toBe(409);
  });

  it("enforces direct assignment and crew membership for job threads without restricting managers", async () => {
    for (const jobId of [directJob, crewJob]) {
      expect((await request(app).post(`/api/jobs/${jobId}/messages`).set(auth(techA)).send({ body: `Visible ${jobId}`, clientMessageId: `job-tech-${jobId}-0001` })).status).toBe(201);
      expect((await request(app).get(`/api/jobs/${jobId}/messages`).set(auth(techA))).status).toBe(200);
    }
    expect((await request(app).get(`/api/jobs/${hiddenJob}/messages`).set(auth(techA))).status).toBe(404);
    expect((await request(app).post(`/api/jobs/${hiddenJob}/messages`).set(auth(managerA)).send({ body: "Manager reply", clientMessageId: "job-manager-hidden-0001" })).status).toBe(201);
    expect((await request(app).get(`/api/jobs/${hiddenJob}/messages`).set(auth(managerA))).status).toBe(200);
    expect((await request(app).get(`/api/jobs/${directJob}/messages`).set(auth(managerB))).status).toBe(404);
  });

  it("idempotently retries job sends, rejects cross-job collisions, and scopes unread summaries", async () => {
    const payload = { body: "Stable job", clientMessageId: "job-manager-stable-0001" };
    const first = await request(app).post(`/api/jobs/${directJob}/messages`).set(auth(managerA)).send(payload);
    const retry = await request(app).post(`/api/jobs/${directJob}/messages`).set(auth(managerA)).send(payload);
    expect(retry.body.id).toBe(first.body.id);
    expect((await request(app).post(`/api/jobs/${crewJob}/messages`).set(auth(managerA)).send(payload)).status).toBe(409);
    const techUnread = await request(app).get("/api/jobs/messages/unread-summary").set(auth(techA));
    expect(techUnread.body.some((row: { jobId: number }) => row.jobId === hiddenJob)).toBe(false);
    expect(techUnread.body.some((row: { jobId: number }) => row.jobId === directJob)).toBe(true);
    await request(app).get(`/api/jobs/${directJob}/messages`).set(auth(techA));
    expect((await request(app).get(`/api/jobs/${directJob}/messages/unread-count`).set(auth(techA))).body.count).toBe(0);
    const senderView = await request(app).get(`/api/jobs/${directJob}/messages`).set(auth(managerA));
    expect(senderView.body.find((message: { id: number }) => message.id === first.body.id)).toMatchObject({ readByOthers: true, readCount: 1 });
  });

  it("marks only the selected latest general-message page read", async () => {
    const timestampBase = Date.now() - 86_400_000;
    const inserted = await db.insert(staffMessagesTable).values(Array.from({ length: 101 }, (_, index) => ({
      tenantId: tenantA,
      threadUserId: techA2,
      senderId: managerA,
      body: `General page ${index + 1}`,
      // Deliberately conflict timestamp order with monotonically increasing IDs.
      createdAt: new Date(timestampBase + (index % 2 === 0 ? 101 - index : index) * 1000),
    }))).returning({ id: staffMessagesTable.id });

    const firstPage = await request(app).get(`/api/staff-messages/${techA2}?limit=100`).set(auth(techA2));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body).toHaveLength(100);
    expect(firstPage.body.map((message: { id: number }) => message.id)).toEqual(inserted.slice(1).map(message => message.id));
    const readAfterFirst = await db.select({ count: sql<number>`cast(count(*) as int)` })
      .from(staffMessageReadsTable)
      .where(and(
        eq(staffMessageReadsTable.userId, techA2),
        inArray(staffMessageReadsTable.messageId, inserted.map(message => message.id)),
      ));
    expect(readAfterFirst[0].count).toBe(100);
    expect((await request(app).get("/api/staff-messages/unread-summary").set(auth(techA2))).body.general).toBe(1);

    const oldestReturnedId = Math.min(...firstPage.body.map((message: { id: number }) => message.id));
    const secondPage = await request(app).get(`/api/staff-messages/${techA2}?limit=100&beforeId=${oldestReturnedId}`).set(auth(techA2));
    expect(secondPage.body).toHaveLength(1);
    expect(secondPage.body[0].id).toBe(inserted[0].id);
    expect(new Set([...firstPage.body, ...secondPage.body].map((message: { id: number }) => message.id)).size).toBe(101);
    expect((await request(app).get("/api/staff-messages/unread-summary").set(auth(techA2))).body.general).toBe(0);
  });

  it("marks only the selected latest job-message page read", async () => {
    const timestampBase = Date.now() - 172_800_000;
    const inserted = await db.insert(jobMessagesTable).values(Array.from({ length: 101 }, (_, index) => ({
      tenantId: tenantA,
      jobId: paginationJob,
      senderId: managerA,
      body: `Job page ${index + 1}`,
      createdAt: new Date(timestampBase + (index % 2 === 0 ? 101 - index : index) * 1000),
    }))).returning({ id: jobMessagesTable.id });

    const firstPage = await request(app).get(`/api/jobs/${paginationJob}/messages?limit=100`).set(auth(techA));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body).toHaveLength(100);
    expect(firstPage.body.map((message: { id: number }) => message.id)).toEqual(inserted.slice(1).map(message => message.id));
    const readAfterFirst = await db.select({ count: sql<number>`cast(count(*) as int)` })
      .from(jobMessageReadsTable)
      .where(and(
        eq(jobMessageReadsTable.userId, techA),
        inArray(jobMessageReadsTable.messageId, inserted.map(message => message.id)),
      ));
    expect(readAfterFirst[0].count).toBe(100);
    expect((await request(app).get(`/api/jobs/${paginationJob}/messages/unread-count`).set(auth(techA))).body.count).toBe(1);

    const oldestReturnedId = Math.min(...firstPage.body.map((message: { id: number }) => message.id));
    const secondPage = await request(app).get(`/api/jobs/${paginationJob}/messages?limit=100&beforeId=${oldestReturnedId}`).set(auth(techA));
    expect(secondPage.body).toHaveLength(1);
    expect(secondPage.body[0].id).toBe(inserted[0].id);
    expect(new Set([...firstPage.body, ...secondPage.body].map((message: { id: number }) => message.id)).size).toBe(101);
    expect((await request(app).get(`/api/jobs/${paginationJob}/messages/unread-count`).set(auth(techA))).body.count).toBe(0);
  });
});