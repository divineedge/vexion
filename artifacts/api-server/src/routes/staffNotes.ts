import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, staffNotesTable, usersTable, customersTable, jobsTable } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { resolveStaffSession } from "./auth";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

/**
 * Middleware: authenticate the caller as a verified staff member.
 *
 * - Rejects any request carrying x-portal-token (portal sessions never have
 *   a legitimate reason to reach staff-only endpoints).
 * - Resolves the x-staff-session (or Authorization: Bearer) token against
 *   the staff_sessions table. Tenant and user IDs come exclusively from
 *   the verified session record — caller-supplied x-user-id / x-tenant-id
 *   headers are NOT trusted for identity here.
 * - Verifies the resolved user is still active in the resolved tenant.
 *
 * On success, stores the verified identity in res.locals.staffTenantId and
 * res.locals.staffUserId for downstream handlers.
 */
async function requireVerifiedStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Hard-reject portal sessions
  if (req.headers["x-portal-token"]) {
    res.status(403).json({ error: "This endpoint is not available to portal users" });
    return;
  }

  // Resolve identity from server-side session (not from caller headers)
  const session = await resolveStaffSession(req);
  if (!session) {
    res.status(401).json({ error: "Valid staff session required" });
    return;
  }

  // Confirm the user is still active in that tenant
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

  // Attach verified identity via res.locals (the conventional Express pattern)
  res.locals["staffTenantId"] = session.tenantId;
  res.locals["staffUserId"] = session.userId;
  next();
}

// Apply to all staff-notes routes
router.use("/staff-notes", requireVerifiedStaff);

// GET /staff-notes?entityType=customer&entityId=123
router.get("/staff-notes", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const { entityType, entityId } = req.query as Record<string, string>;

  if (!entityType || !entityId) {
    res.status(400).json({ error: "entityType and entityId are required" });
    return;
  }
  const entityIdNum = parseInt(entityId, 10);
  if (isNaN(entityIdNum)) {
    res.status(400).json({ error: "entityId must be a number" });
    return;
  }

  const rows = await db
    .select({ note: staffNotesTable, authorName: usersTable.name })
    .from(staffNotesTable)
    .leftJoin(usersTable, eq(staffNotesTable.authorId, usersTable.id))
    .where(
      and(
        eq(staffNotesTable.tenantId, tenantId),
        eq(staffNotesTable.entityType, entityType),
        eq(staffNotesTable.entityId, entityIdNum),
        isNull(staffNotesTable.deletedAt),
      ),
    )
    .orderBy(desc(staffNotesTable.createdAt));

  res.json(
    rows.map(r => ({
      ...r.note,
      authorName: r.authorName ?? "Unknown",
      createdAt: r.note.createdAt.toISOString(),
      deletedAt: null,
    })),
  );
});

// POST /staff-notes
router.post("/staff-notes", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const authorId = res.locals["staffUserId"] as number;
  const { entityType, entityId, body } = req.body as {
    entityType?: string;
    entityId?: number | string;
    body?: string;
  };

  if (!entityType || !["customer", "job"].includes(entityType)) {
    res.status(400).json({ error: "entityType must be 'customer' or 'job'" });
    return;
  }
  const entityIdNum = entityId != null ? parseInt(String(entityId), 10) : NaN;
  if (isNaN(entityIdNum)) {
    res.status(400).json({ error: "entityId is required and must be a number" });
    return;
  }
  const trimmedBody = (body ?? "").trim();
  if (!trimmedBody) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  if (trimmedBody.length > 4000) {
    res.status(400).json({ error: "Note body must be 4000 characters or fewer" });
    return;
  }

  // Validate the entity belongs to this tenant
  if (entityType === "customer") {
    const [row] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.id, entityIdNum), eq(customersTable.tenantId, tenantId)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Customer not found in this tenant" }); return; }
  } else {
    const [row] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(eq(jobsTable.id, entityIdNum), eq(jobsTable.tenantId, tenantId)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Job not found in this tenant" }); return; }
  }

  const [note] = await db
    .insert(staffNotesTable)
    .values({ tenantId, authorId, entityType, entityId: entityIdNum, body: trimmedBody })
    .returning();

  const [author] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, authorId))
    .limit(1);

  res.status(201).json({
    ...note,
    authorName: author?.name ?? "Unknown",
    createdAt: note.createdAt.toISOString(),
    deletedAt: null,
  });
});

// DELETE /staff-notes/:id
router.delete("/staff-notes/:id", async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const userId = res.locals["staffUserId"] as number;
  const noteId = parseInt(req.params.id, 10);
  if (isNaN(noteId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [[noteRow], adminFlag] = await Promise.all([
    db
      .select({ id: staffNotesTable.id, authorId: staffNotesTable.authorId })
      .from(staffNotesTable)
      .where(
        and(
          eq(staffNotesTable.id, noteId),
          eq(staffNotesTable.tenantId, tenantId),
          isNull(staffNotesTable.deletedAt),
        ),
      )
      .limit(1),
    isAdminRole(tenantId, userId),
  ]);

  if (!noteRow) { res.status(404).json({ error: "Note not found" }); return; }

  if (noteRow.authorId !== userId && !adminFlag) {
    res.status(403).json({ error: "Only the note author or an admin can delete this note" });
    return;
  }

  await db
    .update(staffNotesTable)
    .set({ deletedAt: new Date() })
    .where(eq(staffNotesTable.id, noteId));

  res.status(204).send();
});

export default router;
