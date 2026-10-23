import { Router, type IRouter } from "express";
import { db, crewsTable, crewMembersTable, usersTable, activityLogTable, tenantsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

async function getCrewEligibleUser(tenantId: number, userId: number) {
  const [row] = await db
    .select({
      user: usersTable,
      ownersSchedulable: tenantsTable.ownersSchedulable,
    })
    .from(usersTable)
    .innerJoin(tenantsTable, eq(tenantsTable.id, usersTable.tenantId))
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true)));
  if (!row) return null;
  const allowed = row.user.role === "technician"
    || row.user.role === "crew_manager"
    || (row.user.role === "company_owner" && row.ownersSchedulable);
  return allowed ? row.user : null;
}

function formatCrew(
  c: typeof crewsTable.$inferSelect,
  extras?: { managerName?: string | null; memberCount?: number; members?: { id: number; name: string; role: string }[] }
) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    name: c.name,
    description: c.description ?? null,
    dailyCapacityMinutes:c.dailyCapacityMinutes,
    travelBufferMinutes:c.travelBufferMinutes,
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
  if((req.body.dailyCapacityMinutes!==undefined&&(!Number.isInteger(req.body.dailyCapacityMinutes)||req.body.dailyCapacityMinutes<1||req.body.dailyCapacityMinutes>1440))||
    (req.body.travelBufferMinutes!==undefined&&(!Number.isInteger(req.body.travelBufferMinutes)||req.body.travelBufferMinutes<0||req.body.travelBufferMinutes>240))){
    res.status(400).json({error:"Enter a daily capacity of 1–1440 minutes and a travel buffer of 0–240 minutes."});return;
  }
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const parsedManagerId = managerId ? parseInt(managerId, 10) : null;
  if (parsedManagerId && !(await getCrewEligibleUser(tenantId, parsedManagerId))) {
    res.status(400).json({ error: "Selected manager is not eligible for crew assignment" }); return;
  }

  const [crew] = await db.insert(crewsTable).values({
    tenantId,
    name,
    description: description ?? null,
    managerId: parsedManagerId,
    dailyCapacityMinutes:req.body.dailyCapacityMinutes??480,
    travelBufferMinutes:req.body.travelBufferMinutes??15,
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "crew_created", message: `Crew "${name}" created`, entityId: crew.id });

  res.status(201).json(formatCrew(crew));
});

// Update crew
router.patch("/crews/:id", async (req, res): Promise<void> => {
  if((req.body.dailyCapacityMinutes!==undefined&&(!Number.isInteger(req.body.dailyCapacityMinutes)||req.body.dailyCapacityMinutes<1||req.body.dailyCapacityMinutes>1440))||
    (req.body.travelBufferMinutes!==undefined&&(!Number.isInteger(req.body.travelBufferMinutes)||req.body.travelBufferMinutes<0||req.body.travelBufferMinutes>240))){
    res.status(400).json({error:"Enter a daily capacity of 1–1440 minutes and a travel buffer of 0–240 minutes."});return;
  }
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, description, managerId } = req.body;
  if (name !== undefined && !String(name).trim()) { res.status(400).json({ error: "name cannot be blank" }); return; }
  const parsedManagerId = managerId ? parseInt(managerId, 10) : null;
  if (managerId !== undefined && parsedManagerId && !(await getCrewEligibleUser(tenantId, parsedManagerId))) {
    res.status(400).json({ error: "Selected manager is not eligible for crew assignment" }); return;
  }

  const updates: Partial<typeof crewsTable.$inferInsert> = {};
  if(req.body.dailyCapacityMinutes!==undefined)updates.dailyCapacityMinutes=req.body.dailyCapacityMinutes;
  if(req.body.travelBufferMinutes!==undefined)updates.travelBufferMinutes=req.body.travelBufferMinutes;
  if (name !== undefined) updates.name = String(name).trim();
  if (description !== undefined) updates.description = description || null;
  if (managerId !== undefined) updates.managerId = parsedManagerId;

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
  const parsedMemberUserId = parseInt(memberUserId, 10);
  const [crewExists] = await db.select({ id: crewsTable.id }).from(crewsTable).where(and(eq(crewsTable.id, crewId), eq(crewsTable.tenantId, tenantId)));
  if (!crewExists) { res.status(404).json({ error: "Crew not found" }); return; }
  if (!(await getCrewEligibleUser(tenantId, parsedMemberUserId))) {
    res.status(400).json({ error: "Selected user is not eligible for crew assignment" }); return;
  }

  // Check if already a member
  const [existing] = await db.select().from(crewMembersTable).where(
    and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.userId, parsedMemberUserId), eq(crewMembersTable.tenantId, tenantId))
  );
  if (existing) { res.status(409).json({ error: "User is already a member of this crew" }); return; }

  await db.insert(crewMembersTable).values({ crewId, userId: parsedMemberUserId, tenantId });

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
