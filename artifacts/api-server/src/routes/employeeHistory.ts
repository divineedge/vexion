import { Router, type IRouter } from "express";
import { db, employeeFormTemplatesTable, employeeHistoryEntriesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";

const router: IRouter = Router();

// GET /employee-form-templates — list all active form templates for tenant
router.get("/employee-form-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(employeeFormTemplatesTable)
    .where(
      and(
        eq(employeeFormTemplatesTable.tenantId, tenantId),
        eq(employeeFormTemplatesTable.isActive, "true")
      )
    )
    .orderBy(desc(employeeFormTemplatesTable.createdAt));

  res.json(
    rows.map((r) => ({
      ...r,
      fields: r.fields ?? [],
      createdAt: r.createdAt.toISOString(),
    }))
  );
});

// POST /employee-form-templates — create a new form template (admin only)
router.post("/employee-form-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

  const admin = await isAdminRole(tenantId, userId);
  if (!admin) {
    res.status(403).json({ error: "Only managers and owners can create form templates" });
    return;
  }

  const { name, description, fields } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [created] = await db
    .insert(employeeFormTemplatesTable)
    .values({
      tenantId,
      name,
      description: description ?? null,
      fields: fields ?? [],
      isActive: "true",
    })
    .returning();

  res.status(201).json({
    ...created,
    fields: created.fields ?? [],
    createdAt: created.createdAt.toISOString(),
  });
});

// GET /users/:userId/history — list history entries for an employee
router.get("/users/:userId/history", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = parseInt(req.params.userId, 10);
  const { type } = req.query as Record<string, string>;

  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  // Verify user belongs to tenant
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const creatorAlias = db.$with("creator").as(
    db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
  );
  const templateAlias = db.$with("tmpl").as(
    db.select({ id: employeeFormTemplatesTable.id, name: employeeFormTemplatesTable.name }).from(employeeFormTemplatesTable)
  );

  // Simple join approach
  const rows = await db
    .select({
      entry: employeeHistoryEntriesTable,
      createdByName: usersTable.name,
      formTemplateName: employeeFormTemplatesTable.name,
    })
    .from(employeeHistoryEntriesTable)
    .leftJoin(usersTable, eq(employeeHistoryEntriesTable.createdById, usersTable.id))
    .leftJoin(
      employeeFormTemplatesTable,
      eq(employeeHistoryEntriesTable.formTemplateId, employeeFormTemplatesTable.id)
    )
    .where(
      and(
        eq(employeeHistoryEntriesTable.tenantId, tenantId),
        eq(employeeHistoryEntriesTable.userId, userId)
      )
    )
    .orderBy(desc(employeeHistoryEntriesTable.createdAt));

  let result = rows.map((r) => ({
    ...r.entry,
    formData: r.entry.formData ?? {},
    createdByName: r.createdByName ?? null,
    formTemplateName: r.formTemplateName ?? null,
    createdAt: r.entry.createdAt.toISOString(),
  }));

  if (type) {
    result = result.filter((r) => r.type === type);
  }

  res.json(result);
});

// POST /users/:userId/history — create a new history entry
router.post("/users/:userId/history", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const callerId = getUserId(req);
  const userId = parseInt(req.params.userId, 10);

  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const { type, title, notes, formTemplateId, formData } = req.body;

  if (!type || !title) {
    res.status(400).json({ error: "type and title are required" });
    return;
  }

  const validTypes = ["review", "complaint", "callback", "custom_form"];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
    return;
  }

  // Verify target user belongs to tenant
  const [targetUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // If custom_form, validate template belongs to tenant
  if (type === "custom_form" && formTemplateId) {
    const [tmpl] = await db
      .select({ id: employeeFormTemplatesTable.id })
      .from(employeeFormTemplatesTable)
      .where(
        and(
          eq(employeeFormTemplatesTable.id, parseInt(formTemplateId, 10)),
          eq(employeeFormTemplatesTable.tenantId, tenantId)
        )
      );
    if (!tmpl) {
      res.status(404).json({ error: "Form template not found" });
      return;
    }
  }

  const [created] = await db
    .insert(employeeHistoryEntriesTable)
    .values({
      tenantId,
      userId,
      type,
      title,
      notes: notes ?? null,
      formTemplateId: formTemplateId ? parseInt(formTemplateId, 10) : null,
      formData: formData ?? {},
      createdById: callerId,
    })
    .returning();

  // Fetch creator name and template name for response
  const [creatorRow] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, callerId));

  let formTemplateName: string | null = null;
  if (created.formTemplateId) {
    const [tmplRow] = await db
      .select({ name: employeeFormTemplatesTable.name })
      .from(employeeFormTemplatesTable)
      .where(eq(employeeFormTemplatesTable.id, created.formTemplateId));
    formTemplateName = tmplRow?.name ?? null;
  }

  res.status(201).json({
    ...created,
    formData: created.formData ?? {},
    createdByName: creatorRow?.name ?? null,
    formTemplateName,
    createdAt: created.createdAt.toISOString(),
  });
});

export default router;
