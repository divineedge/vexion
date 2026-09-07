import { Router, type IRouter } from "express";
import {
  db, internalTasksTable, taskNotificationsTable, usersTable,
  customersTable, jobsTable, propertiesTable, equipmentTable,
} from "@workspace/db";
import { eq, and, desc, or, inArray, isNull } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ADMIN_ROLES, getCallerRole, getSingleAdmin } from "../lib/roles";
import { validateTaskAssignment, roleBucketMatches } from "../lib/taskRouting";
import { sendStaffPush } from "../lib/pushNotifications";
import { canAccessEquipment } from "../lib/equipmentAccess";

const router: IRouter = Router();

type Task = typeof internalTasksTable.$inferSelect;

function formatTask(t: Task, extras?: { createdByName?: string | null; assignedToName?: string | null; contextLabel?: string | null }) {
  return {
    ...t,
    dueDate: t.dueDate ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    createdByName: extras?.createdByName ?? null,
    assignedToName: extras?.assignedToName ?? null,
    contextLabel: extras?.contextLabel ?? null,
  };
}

async function resolveContextLabel(tenantId: number, contextType: string | null, contextId: number | null): Promise<string | null> {
  if (!contextType || !contextId) return null;
  if (contextType === "customer") {
    const [row] = await db.select({ name: customersTable.name }).from(customersTable).where(and(eq(customersTable.id, contextId), eq(customersTable.tenantId, tenantId)));
    return row?.name ?? null;
  }
  if (contextType === "job") {
    const [row] = await db.select({ title: jobsTable.title }).from(jobsTable).where(and(eq(jobsTable.id, contextId), eq(jobsTable.tenantId, tenantId)));
    return row?.title ?? null;
  }
  if (contextType === "property") {
    const [row] = await db.select({ address: propertiesTable.address }).from(propertiesTable).where(and(eq(propertiesTable.id, contextId), eq(propertiesTable.tenantId, tenantId)));
    return row?.address ?? null;
  }
  if (contextType === "equipment") {
    const [row] = await db.select({ name: equipmentTable.name }).from(equipmentTable).where(and(eq(equipmentTable.id, contextId), eq(equipmentTable.tenantId, tenantId)));
    return row?.name ?? null;
  }
  return null;
}

async function enrichTasks(tenantId: number, tasks: Task[]) {
  const userIds = Array.from(new Set(tasks.flatMap(t => [t.createdById, t.assignedToUserId].filter((x): x is number => x != null))));
  const users = userIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId)))
    : [];
  const userMap = new Map(users.filter(u => userIds.includes(u.id)).map(u => [u.id, u.name]));

  const contextLabels = new Map<string, string | null>();
  for (const t of tasks) {
    if (t.contextType && t.contextId) {
      const key = `${t.contextType}:${t.contextId}`;
      if (!contextLabels.has(key)) {
        contextLabels.set(key, await resolveContextLabel(tenantId, t.contextType, t.contextId));
      }
    }
  }

  return tasks.map(t => formatTask(t, {
    createdByName: userMap.get(t.createdById) ?? null,
    assignedToName: t.assignedToUserId != null ? (userMap.get(t.assignedToUserId) ?? null) : null,
    contextLabel: t.contextType && t.contextId ? (contextLabels.get(`${t.contextType}:${t.contextId}`) ?? null) : null,
  }));
}

async function notify(tenantId: number, recipientUserId: number, taskId: number, type: string, message: string) {
  await db.insert(taskNotificationsTable).values({ tenantId, recipientUserId, taskId, type, message, isRead: false });
}

/** Notifies the specific assignee, or every user matching a role bucket, when a task is (re)assigned. */
async function notifyAssignment(tenantId: number, task: Task, actorName: string) {
  const message = `${actorName} assigned you a task: "${task.title}"`;
  const recipients: number[] = [];
  if (task.assignedToUserId) {
    await notify(tenantId, task.assignedToUserId, task.id, "assigned", message);
    recipients.push(task.assignedToUserId);
  } else if (task.assignedToRole) {
    const candidates = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true)));
    const matches = candidates.filter(c => roleBucketMatches(task.assignedToRole as string, c.role));
    await Promise.all(matches.map(m => notify(tenantId, m.id, task.id, "assigned", message)));
    recipients.push(...matches.map(match => match.id));
  }
  if (recipients.length) void sendStaffPush({
    tenantId, recipientUserIds: recipients, eventKey: `task-assignment:${task.id}:${task.updatedAt.getTime()}`,
    title: "Task assigned", body: message, data: { type: "task_assignment", taskId: task.id },
  });
}

// ─── Tasks CRUD ─────────────────────────────────────────────────────────────

/**
 * Shared task-visibility policy: an admin (or someone with the "mine" scope) sees everything they
 * created, are assigned, or are eligible to claim via a role bucket. Non-admins are always
 * restricted this way. Every task read path (list, detail, equipment queue) must apply this same
 * filter — do not add a new read endpoint that bypasses it.
 */
function canViewTask(task: Task, userId: number, role: string, isAdmin: boolean, scope?: string): boolean {
  if (isAdmin && scope !== "mine") return true;
  return (
    task.createdById === userId ||
    task.assignedToUserId === userId ||
    (task.assignedToRole != null && task.assignedToUserId == null && roleBucketMatches(task.assignedToRole, role))
  );
}

router.get("/tasks", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  const { status, priority, assigneeId, contextType, scope } = req.query as Record<string, string>;

  const { includeArchived } = req.query as Record<string, string>;

  let where = eq(internalTasksTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (!includeArchived || includeArchived !== "true") {
    where = and(where, isNull(internalTasksTable.archivedAt)) as typeof where;
  }
  if (status) where = and(where, eq(internalTasksTable.status, status)) as typeof where;
  if (priority) where = and(where, eq(internalTasksTable.priority, priority)) as typeof where;
  if (contextType) where = and(where, eq(internalTasksTable.contextType, contextType)) as typeof where;
  if (assigneeId) where = and(where, eq(internalTasksTable.assignedToUserId, parseInt(assigneeId, 10))) as typeof where;

  const isAdmin = ADMIN_ROLES.has(role);

  let rows = await db.select().from(internalTasksTable).where(where).orderBy(desc(internalTasksTable.createdAt));
  rows = rows.filter(t => canViewTask(t, userId, role, isAdmin, scope));
  if (!isAdmin) {
    const access = await Promise.all(rows.map(async task => (
      task.contextType !== "equipment" || task.contextId == null || await canAccessEquipment(tenantId, userId, task.contextId)
    )));
    rows = rows.filter((_task, index) => access[index]);
  }

  res.json(await enrichTasks(tenantId, rows));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  const id = parseInt(req.params.id, 10);

  const [task] = await db.select().from(internalTasksTable).where(and(eq(internalTasksTable.id, id), eq(internalTasksTable.tenantId, tenantId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const isAdmin = ADMIN_ROLES.has(role);
  if (!isAdmin && task.contextType === "equipment" && (task.contextId == null || !(await canAccessEquipment(tenantId, userId, task.contextId)))) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (!canViewTask(task, userId, role, isAdmin)) { res.status(403).json({ error: "You do not have access to this task" }); return; }

  const [enriched] = await enrichTasks(tenantId, [task]);
  res.json(enriched);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  const { title, description, taskType, assignedToUserId, assignedToRole, priority, dueDate, contextType, contextId } = req.body;

  if (!title) { res.status(400).json({ error: "title is required" }); return; }

  // Determine whether the caller is providing an explicit assignment.
  // When neither is provided we attempt system-level auto-assignment to the sole admin — this
  // bypasses the user-facing routing rules (validateTaskAssignment) because the target is chosen
  // by the server, not the caller, and is always a valid admin. The validate call below still
  // runs for all user-provided assignments to enforce normal routing rules.
  const callerProvidedAssignee = !!(assignedToUserId || assignedToRole);

  let resolvedAssignedToUserId: number | null = assignedToUserId ?? null;
  let resolvedAssignedToRole: string | null = assignedToRole ?? null;

  if (!callerProvidedAssignee) {
    const singleAdmin = await getSingleAdmin(tenantId);
    if (singleAdmin) {
      resolvedAssignedToUserId = singleAdmin.id;
      // Skip validateTaskAssignment — the target is server-chosen and always valid.
    } else {
      // Multiple admins: require the caller to pick one.
      res.status(400).json({ error: "Task must be assigned to a person or a role (Any Manager / Any Admin/Office / Any Technician)" });
      return;
    }
  } else {
    const check = await validateTaskAssignment(tenantId, userId, role, { assignedToUserId: resolvedAssignedToUserId, assignedToRole: resolvedAssignedToRole });
    if (!check.ok) { res.status(403).json({ error: check.error }); return; }
  }

  if (contextType === "equipment" && (
    !Number.isInteger(contextId) || !(await canAccessEquipment(tenantId, userId, contextId))
  )) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }

  const [row] = await db.insert(internalTasksTable).values({
    tenantId,
    title,
    description: description ?? null,
    taskType: taskType ?? null,
    createdById: userId,
    assignedToUserId: resolvedAssignedToUserId,
    assignedToRole: resolvedAssignedToRole,
    priority: priority ?? "normal",
    status: "open",
    dueDate: dueDate ?? null,
    contextType: contextType ?? null,
    contextId: contextId ?? null,
  }).returning();

  const [creator] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  await notifyAssignment(tenantId, row, creator?.name ?? "Someone");

  const [enriched] = await enrichTasks(tenantId, [row]);
  res.status(201).json(enriched);
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  const id = parseInt(req.params.id, 10);

  const [task] = await db.select().from(internalTasksTable).where(and(eq(internalTasksTable.id, id), eq(internalTasksTable.tenantId, tenantId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const isAdmin = ADMIN_ROLES.has(role);
  const { title, description, priority, dueDate, contextType, contextId, assignedToUserId, assignedToRole, status, rejectionReason } = req.body;
  const resultingContextType = contextType !== undefined ? contextType : task.contextType;
  const resultingContextId = contextId !== undefined ? contextId : task.contextId;
  if (resultingContextType === "equipment" && (
    !Number.isInteger(resultingContextId) || !(await canAccessEquipment(tenantId, userId, resultingContextId))
  )) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  const isCreator = task.createdById === userId;
  const isAssignee = task.assignedToUserId === userId;
  const canClaim = task.assignedToRole != null && task.assignedToUserId == null && roleBucketMatches(task.assignedToRole, role);

  const updates: Partial<typeof internalTasksTable.$inferInsert> = {};

  // Reassignment: creator or admin can reassign; must pass the same routing rules as create.
  const isReassigning = assignedToUserId !== undefined || assignedToRole !== undefined;
  if (isReassigning) {
    if (!isAdmin && !isCreator) { res.status(403).json({ error: "Only the creator or Admin/Office can reassign this task" }); return; }
    const nextTarget = {
      assignedToUserId: assignedToUserId !== undefined ? assignedToUserId : task.assignedToUserId,
      assignedToRole: assignedToRole !== undefined ? assignedToRole : task.assignedToRole,
    };
    const check = await validateTaskAssignment(tenantId, isAdmin ? userId : task.createdById, isAdmin ? role : await getCallerRole(tenantId, task.createdById), nextTarget);
    if (!check.ok) { res.status(403).json({ error: check.error }); return; }
    updates.assignedToUserId = nextTarget.assignedToUserId ?? null;
    updates.assignedToRole = nextTarget.assignedToUserId ? null : (nextTarget.assignedToRole ?? null);
  } else if (canClaim && req.body.claim === true) {
    // A user matching the role bucket claims an unassigned task for themselves.
    updates.assignedToUserId = userId;
    updates.assignedToRole = null;
  }

  if (!isAdmin && !isCreator && !isAssignee && !canClaim && Object.keys(updates).length === 0) {
    res.status(403).json({ error: "You do not have permission to modify this task" });
    return;
  }

  if (title != null && (isAdmin || isCreator)) updates.title = title;
  if (description !== undefined && (isAdmin || isCreator)) updates.description = description;
  if (priority != null && (isAdmin || isCreator)) updates.priority = priority;
  if (dueDate !== undefined && (isAdmin || isCreator)) updates.dueDate = dueDate;
  if (contextType !== undefined && (isAdmin || isCreator)) updates.contextType = contextType;
  if (contextId !== undefined && (isAdmin || isCreator)) updates.contextId = contextId;

  let statusChanged = false;
  if (status != null && status !== task.status) {
    const canActOnStatus = isAdmin || isAssignee || (updates.assignedToUserId === userId) || (isCreator && status === "open" && task.status === "rejected");
    if (!canActOnStatus) { res.status(403).json({ error: "Only the assignee (or the creator resubmitting a rejected task) can change status" }); return; }
    if (status === "rejected" && !rejectionReason) { res.status(400).json({ error: "rejectionReason is required when rejecting a task" }); return; }
    updates.status = status;
    statusChanged = true;
    if (status === "done") updates.completedAt = new Date();
    if (status === "rejected") { updates.rejectionReason = rejectionReason; updates.completedAt = null; }
    if (status === "open" || status === "in_progress") { updates.rejectionReason = null; }
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }

  const [updated] = await db.update(internalTasksTable).set(updates).where(eq(internalTasksTable.id, id)).returning();

  const [actor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  if (isReassigning) {
    await notifyAssignment(tenantId, updated, actor?.name ?? "Someone");
  }
  if (statusChanged && (status === "done" || status === "rejected") && updated.createdById !== userId) {
    const msg = status === "done"
      ? `${actor?.name ?? "Someone"} completed your task: "${updated.title}"`
      : `${actor?.name ?? "Someone"} rejected your task "${updated.title}": ${updated.rejectionReason}`;
    await notify(tenantId, updated.createdById, updated.id, status === "done" ? "completed" : "rejected", msg);
  }

  const [enriched] = await enrichTasks(tenantId, [updated]);
  res.json(enriched);
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  if (!ADMIN_ROLES.has(role)) { res.status(403).json({ error: "Only Admin/Office can delete tasks" }); return; }

  const id = parseInt(req.params.id, 10);
  const [task] = await db.select().from(internalTasksTable).where(and(eq(internalTasksTable.id, id), eq(internalTasksTable.tenantId, tenantId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  // Delete notifications first (FK constraint), then the task
  await db.delete(taskNotificationsTable).where(eq(taskNotificationsTable.taskId, id));
  await db.delete(internalTasksTable).where(eq(internalTasksTable.id, id));
  res.status(204).end();
});

router.post("/tasks/:id/unarchive", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  if (!ADMIN_ROLES.has(role)) { res.status(403).json({ error: "Only Admin/Office can unarchive tasks" }); return; }

  const id = parseInt(req.params.id, 10);
  const [task] = await db.select().from(internalTasksTable).where(and(eq(internalTasksTable.id, id), eq(internalTasksTable.tenantId, tenantId)));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const [updated] = await db.update(internalTasksTable)
    .set({ archivedAt: null } as Partial<typeof internalTasksTable.$inferInsert>)
    .where(eq(internalTasksTable.id, id))
    .returning();

  const [enriched] = await enrichTasks(tenantId, [updated]);
  res.json(enriched);
});

router.post("/tasks/bulk-archive", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  if (!ADMIN_ROLES.has(role)) { res.status(403).json({ error: "Only Admin/Office can bulk-archive tasks" }); return; }

  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array of task IDs" }); return; }

  await db.update(internalTasksTable)
    .set({ archivedAt: new Date() } as Partial<typeof internalTasksTable.$inferInsert>)
    .where(and(eq(internalTasksTable.tenantId, tenantId), inArray(internalTasksTable.id, ids)));

  res.json({ archived: ids.length });
});

// ─── Equipment maintenance task queue ───────────────────────────────────────

router.get("/equipment/:id/tasks", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getCallerRole(tenantId, userId);
  const isAdmin = ADMIN_ROLES.has(role);
  const equipmentId = parseInt(req.params.id, 10);
  if (!(await canAccessEquipment(tenantId, userId, equipmentId))) {
    res.status(404).json({ error: "Equipment not found" });
    return;
  }
  let rows = await db.select().from(internalTasksTable).where(and(
    eq(internalTasksTable.tenantId, tenantId),
    eq(internalTasksTable.contextType, "equipment"),
    eq(internalTasksTable.contextId, equipmentId),
    or(eq(internalTasksTable.status, "open"), eq(internalTasksTable.status, "in_progress")),
  )).orderBy(desc(internalTasksTable.createdAt));
  rows = rows.filter(t => canViewTask(t, userId, role, isAdmin));
  res.json(await enrichTasks(tenantId, rows));
});

// ─── In-app notifications ───────────────────────────────────────────────────

router.get("/notifications", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rows = await db.select().from(taskNotificationsTable)
    .where(and(eq(taskNotificationsTable.tenantId, tenantId), eq(taskNotificationsTable.recipientUserId, userId)))
    .orderBy(desc(taskNotificationsTable.createdAt))
    .limit(50);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const [row] = await db.update(taskNotificationsTable).set({ isRead: true })
    .where(and(eq(taskNotificationsTable.id, id), eq(taskNotificationsTable.tenantId, tenantId), eq(taskNotificationsTable.recipientUserId, userId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Notification not found" }); return; }
  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.post("/notifications/mark-all-read", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  await db.update(taskNotificationsTable).set({ isRead: true })
    .where(and(eq(taskNotificationsTable.tenantId, tenantId), eq(taskNotificationsTable.recipientUserId, userId), eq(taskNotificationsTable.isRead, false)));
  res.json({ ok: true });
});

export default router;
