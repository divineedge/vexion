/**
 * Job equipment-hours log — staff-only.
 * Records which equipment was used on a job and for how many hours.
 * Also serves the equipment "Use" history: GET /equipment/:equipmentId/uses
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, jobEquipmentUsesTable, jobsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { resolveStaffSession } from "./auth";

const router: IRouter = Router();

async function requireVerifiedStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.headers["x-portal-token"]) {
    res.status(403).json({ error: "Not available to portal users" });
    return;
  }
  const session = await resolveStaffSession(req);
  if (!session) { res.status(401).json({ error: "Valid staff session required" }); return; }
  const [u] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.id, session.userId), eq(usersTable.tenantId, session.tenantId), eq(usersTable.isActive, true))).limit(1);
  if (!u) { res.status(401).json({ error: "Staff account inactive" }); return; }
  res.locals["staffTenantId"] = session.tenantId;
  res.locals["staffUserId"] = session.userId;
  next();
}

router.use("/jobs/:jobId/equipment-uses", requireVerifiedStaff);
router.use("/equipment/:equipmentId/uses", requireVerifiedStaff);

// ── GET /jobs/:jobId/equipment-uses ──────────────────────────────────────
router.get("/jobs/:jobId/equipment-uses", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const jobId = parseInt(req.params.jobId, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }

  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId))).limit(1);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const rows = await db.select().from(jobEquipmentUsesTable)
    .where(and(eq(jobEquipmentUsesTable.jobId, jobId), eq(jobEquipmentUsesTable.tenantId, tenantId)))
    .orderBy(desc(jobEquipmentUsesTable.createdAt));

  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ── POST /jobs/:jobId/equipment-uses ─────────────────────────────────────
router.post("/jobs/:jobId/equipment-uses", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const jobId = parseInt(req.params.jobId, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }

  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId))).limit(1);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const { equipmentName, equipmentId, hoursUsed, notes } = req.body as Record<string, unknown>;
  const name = String(equipmentName ?? "").trim();
  if (!name) { res.status(400).json({ error: "equipmentName is required" }); return; }
  const hours = parseFloat(String(hoursUsed ?? ""));
  if (isNaN(hours) || hours <= 0) { res.status(400).json({ error: "hoursUsed must be a positive number" }); return; }

  const [row] = await db.insert(jobEquipmentUsesTable).values({
    tenantId,
    jobId,
    equipmentName: name,
    equipmentId: equipmentId != null ? parseInt(String(equipmentId), 10) : null,
    hoursUsed: hours,
    notes: notes ? String(notes).trim() : null,
  }).returning();

  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
});

// ── DELETE /jobs/:jobId/equipment-uses/:id ───────────────────────────────
router.delete("/jobs/:jobId/equipment-uses/:id", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select().from(jobEquipmentUsesTable)
    .where(and(eq(jobEquipmentUsesTable.id, id), eq(jobEquipmentUsesTable.tenantId, tenantId))).limit(1);
  if (!row) { res.status(404).json({ error: "Record not found" }); return; }

  await db.delete(jobEquipmentUsesTable).where(eq(jobEquipmentUsesTable.id, id));
  res.status(204).send();
});

// ── GET /equipment/:equipmentId/uses ─────────────────────────────────────
// Shows usage history for a piece of equipment across all jobs
router.get("/equipment/:equipmentId/uses", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const equipmentId = parseInt(req.params.equipmentId, 10);
  if (isNaN(equipmentId)) { res.status(400).json({ error: "Invalid equipmentId" }); return; }

  const rows = await db
    .select({
      use: jobEquipmentUsesTable,
      jobTitle: jobsTable.title,
      jobScheduledAt: jobsTable.scheduledAt,
    })
    .from(jobEquipmentUsesTable)
    .leftJoin(jobsTable, eq(jobEquipmentUsesTable.jobId, jobsTable.id))
    .where(and(
      eq(jobEquipmentUsesTable.tenantId, tenantId),
      eq(jobEquipmentUsesTable.equipmentId, equipmentId),
    ))
    .orderBy(desc(jobEquipmentUsesTable.createdAt));

  res.json(rows.map(r => ({
    ...r.use,
    createdAt: r.use.createdAt.toISOString(),
    jobTitle: r.jobTitle ?? null,
    jobScheduledAt: r.jobScheduledAt?.toISOString() ?? null,
  })));
});

export default router;
