import { Router, type IRouter } from "express";
import { db, crewsTable, crewMembersTable, usersTable, activityLogTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatCrew(
  c: typeof crewsTable.$inferSelect,
  extras?: { managerName?: string | null; memberCount?: number; members?: { id: number; name: string; role: string }[] }
) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    name: c.name,
    description: c.description ?? null,
    managerId: c.managerId ?? null,
    managerName: extras?.managerName ?? null,
    memberCount: extras?.memberCount ?? 0,
    members: extras?.members ?? [],
    createdAt: c.createdAt.toISOString(),
  };
}

// List all crews for tenant
router.get("/crews", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const crews = await db.select().from(crewsTable).where(eq(crewsTable.tenantId, tenantId)).orderBy(crewsTable.name);

  // Get member counts
  const counts = await db
    .select({ crewId: crewMembersTable.crewId, count: sql<number>`count(*)::int` })
    .from(crewMembersTable)
    .where(eq(crewMembersTable.tenantId, tenantId))
    .groupBy(crewMembersTable.crewId);
  const countMap = Object.fromEntries(counts.map(c => [c.crewId, c.count]));

  // Get manager names
  const managerIds = crews.map(c => c.managerId).filter(Boolean) as number[];
  const managers: { id: number; name: string }[] = managerIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(
        sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${managerIds.join(",")}]`)})`
      )
    : [];
  const managerMap = Object.fromEntries(managers.map(m => [m.id, m.name]));

  res.json(crews.map(c => formatCrew(c, {
    managerName: c.managerId ? managerMap[c.managerId] ?? null : null,
    memberCount: countMap[c.id] ?? 0,
  })));
});

// Get single crew with members
router.get("/crews/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [crew] = await db.select().from(crewsTable).where(and(eq(crewsTable.id, id), eq(crewsTable.tenantId, tenantId)));
  if (!crew) { res.status(404).json({ error: "Crew not found" }); return; }

  const members = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, email: usersTable.email })
    .from(crewMembersTable)
    .leftJoin(usersTable, eq(crewMembersTable.userId, usersTable.id))
    .where(and(eq(crewMembersTable.crewId, id), eq(crewMembersTable.tenantId, tenantId)));

  let managerName: string | null = null;
  if (crew.managerId) {
    const [mgr] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, crew.managerId));
    managerName = mgr?.name ?? null;
  }

  res.json(formatCrew(crew, {
    managerName,
    memberCount: members.length,
    members: members.map(m => ({ id: m.id!, name: m.name!, role: m.role!, email: m.email! })),
  }));
});

// Create crew
router.post("/crews", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { name, description, managerId } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [crew] = await db.insert(crewsTable).values({
    tenantId,
    name,
    description: description ?? null,
    managerId: managerId ? parseInt(managerId, 10) : null,
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "crew_created", message: `Crew "${name}" created`, entityId: crew.id });

  res.status(201).json(formatCrew(crew));
});

// Update crew
router.patch("/crews/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, description, managerId } = req.body;

  const updates: Partial<typeof crewsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description || null;
  if (managerId !== undefined) updates.managerId = managerId ? parseInt(managerId, 10) : null;

  const [updated] = await db.update(crewsTable).set(updates).where(and(eq(crewsTable.id, id), eq(crewsTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Crew not found" }); return; }

  res.json(formatCrew(updated));
});

// Delete crew
router.delete("/crews/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  // Remove members first
  await db.delete(crewMembersTable).where(and(eq(crewMembersTable.crewId, id), eq(crewMembersTable.tenantId, tenantId)));
  await db.delete(crewsTable).where(and(eq(crewsTable.id, id), eq(crewsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// Add member to crew
router.post("/crews/:id/members", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const crewId = parseInt(req.params.id, 10);
  const { userId: memberUserId } = req.body;
  if (!memberUserId) { res.status(400).json({ error: "userId is required" }); return; }

  // Check if already a member
  const [existing] = await db.select().from(crewMembersTable).where(
    and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, parseInt(memberUserId, 10)), eq(crewMembersTable.tenantId, tenantId))
  );
  if (existing) { res.status(409).json({ error: "User is already a member of this crew" }); return; }

  await db.insert(crewMembersTable).values({ crewId, userId: parseInt(memberUserId, 10), tenantId });

  // Return updated crew
  const [crew] = await db.select().from(crewsTable).where(and(eq(crewsTable.id, crewId), eq(crewsTable.tenantId, tenantId)));
  const members = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(crewMembersTable)
    .leftJoin(usersTable, eq(crewMembersTable.userId, usersTable.id))
    .where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.tenantId, tenantId)));

  res.status(201).json(formatCrew(crew, { memberCount: members.length, members: members.map(m => ({ id: m.id!, name: m.name!, role: m.role! })) }));
});

// Remove member from crew
router.delete("/crews/:id/members/:userId", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const crewId = parseInt(req.params.id, 10);
  const memberUserId = parseInt(req.params.userId, 10);

  await db.delete(crewMembersTable).where(
    and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, memberUserId), eq(crewMembersTable.tenantId, tenantId))
  );
  res.sendStatus(204);
});

export default router;
