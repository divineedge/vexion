import { Router, type IRouter } from "express";
import { db, employeeFormTemplatesTable, employeeHistoryEntriesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { hrAccess,requireHr,HrError } from "../lib/hrAccess";
import { createEmployeeRecord,employeeFields } from "../lib/employeeRecords";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { FormError } from "../lib/jobForms";

const router: IRouter = Router();
router.use(requireVerifiedStaff,async(req,res,next)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);
 const match=req.path.match(/^\/users\/(\d+)\/history$/);
 if(req.method==="GET"&&match){
  const access=await hrAccess(tenantId,actorId);
  if(!access.hasHrAccess&&Number(match[1])!==actorId)throw new HrError("Private employee history requires HR access",403);
  res.locals.employeeHistorySharedOnly=!access.hasHrAccess;
 }else await requireHr(tenantId,actorId);
 next();
});

// GET /employee-form-templates — list all active form templates for tenant
router.get("/employee-form-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(employeeFormTemplatesTable)
    .where(
      and(
        eq(employeeFormTemplatesTable.tenantId, tenantId)
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

  const admin = (await hrAccess(tenantId,userId)).hasHrAccess;
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
      fields: employeeFields(fields),
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
        eq(employeeHistoryEntriesTable.userId, userId),
        res.locals.employeeHistorySharedOnly?eq(employeeHistoryEntriesTable.sharedWithEmployee,true):undefined
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

  const recorded=await createEmployeeRecord(tenantId,callerId,userId,req.body);
  res.status(201).json(recorded);
});

router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
 if(error instanceof HrError||error instanceof FormError){res.status(error.status).json({error:error.message});return;}next(error);
});
export default router;
