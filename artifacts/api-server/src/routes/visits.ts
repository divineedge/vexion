import { paymentGuardedJobInsert } from "../lib/paymentPolicy";
import { Router, type IRouter } from "express";
import { db, visitsTable, estimatesTable, jobsTable, customersTable, propertiesTable, usersTable,subTimersTable } from "@workspace/db";
import { readVisitClock,startVisitClock,stopVisitClock } from "../lib/visitClock";
import { eq, and, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { getCallerRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { resolveJobAssignmentRecipientIds, resolveVisitAssignmentRecipientIds, sendStaffPush } from "../lib/pushNotifications";
import { canAccessVisit } from "../lib/visitAccess";

const router: IRouter = Router();
router.get("/visits/clock-active",requireVerifiedStaff,async(req,res):Promise<void>=>{
 const tenantId=getTenantId(req),userId=getUserId(req);
 const entries=await db.select({visitId:subTimersTable.visitId,entryId:subTimersTable.id,clockedInAt:subTimersTable.startedAt}).from(subTimersTable)
 .where(and(eq(subTimersTable.tenantId,tenantId),eq(subTimersTable.userId,userId),eq(subTimersTable.isActive,true),sql`${subTimersTable.visitId} IS NOT NULL`));
 res.json({entries});
});
for(const action of ["clock","clock-in","clock-out"] as const){
 const handler=async(req:import("express").Request,res:import("express").Response):Promise<void>=>{
  const tenantId=getTenantId(req),userId=getUserId(req),visitId=Number(req.params.id);
  if(!Number.isInteger(visitId)||visitId<=0){res.status(400).json({error:"Invalid visit"});return;}
  if(!(await canAccessVisit(tenantId,userId,visitId))){res.status(403).json({error:"You are not assigned to this visit"});return;}
  const position={lat:req.body?.lat==null?null:Number(req.body.lat),lng:req.body?.lng==null?null:Number(req.body.lng)};
  if((position.lat===null)!==(position.lng===null)||(position.lat!==null&&(!Number.isFinite(position.lat)||Math.abs(position.lat)>90))||(position.lng!==null&&(!Number.isFinite(position.lng)||Math.abs(position.lng)>180))){
    res.status(400).json({error:"Invalid clock location"});return;
  }
  try{res.json(await (action==="clock"?readVisitClock(tenantId,userId,visitId):action==="clock-in"?startVisitClock(tenantId,userId,visitId,db,position):stopVisitClock(tenantId,userId,visitId,db,position)));}
  catch(error){const failure=error as Error&{status?:number};if(failure.status){res.status(failure.status).json({error:failure.message});return;}throw error;}
 };
 if(action==="clock")router.get(`/visits/:id/${action}`,requireVerifiedStaff,handler);
 else router.post(`/visits/:id/${action}`,requireVerifiedStaff,handler);
}

function notifyVisitAssignment(
  tenantId: number, visit: { id: number; purpose: string; assigneeId: number | null },
  eventKey: string, actorUserId?: number,
): void {
  void resolveVisitAssignmentRecipientIds(tenantId, visit.assigneeId)
    .then(recipientUserIds => sendStaffPush({
      tenantId, recipientUserIds: actorUserId ? recipientUserIds.filter(id => id !== actorUserId) : recipientUserIds,
      eventKey, title: "Visit assigned", body: `You have been assigned: ${visit.purpose}`,
      data: { type: "visit_assignment", visitId: visit.id },
    }))
    .catch(() => undefined);
}

function formatVisit(
  v: typeof visitsTable.$inferSelect,
  extras?: { customerName?: string | null; assigneeName?: string | null; propertyAddress?: string | null;propertyLat?:number|null;propertyLng?:number|null }
) {
  return {
    ...v,
    scheduledAt: v.scheduledAt?.toISOString() ?? null,
    completedAt: v.completedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    customerName: extras?.customerName ?? null,
    assigneeName: extras?.assigneeName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
    propertyLat:extras?.propertyLat??null,propertyLng:extras?.propertyLng??null,
  };
}

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get("/visits", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number;
  const userId = res.locals.staffUserId as number;
  const { date, assigneeId, customerId } = req.query as Record<string, string>;

  let where = eq(visitsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  const callerRole = await getCallerRole(tenantId, userId);
  if (callerRole === "technician") {
    where = and(where, eq(visitsTable.assigneeId, userId)) as typeof where;
  } else if (assigneeId) {
    where = and(where, eq(visitsTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  }
  if (customerId) where = and(where, eq(visitsTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (date) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+"T12:00:00Z"))||new Date(date+"T12:00:00Z").toISOString().slice(0,10)!==date){res.status(400).json({error:"Choose a valid calendar day"});return;}
    const company=await db.execute(sql`SELECT timezone FROM tenants WHERE id=${tenantId}`);
    const zone=String(company.rows[0]?.timezone||"UTC");
    where=and(where,sql`${visitsTable.scheduledAt} >= (${date}::date::timestamp AT TIME ZONE ${zone})`,
      sql`${visitsTable.scheduledAt} < ((${date}::date+1)::timestamp AT TIME ZONE ${zone})`) as typeof where;
  }

  const rows = await db
    .select({
      visit: visitsTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
      propertyLat:propertiesTable.lat,propertyLng:propertiesTable.lng,
    })
    .from(visitsTable)
    .leftJoin(customersTable, eq(visitsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(visitsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(visitsTable.propertyId, propertiesTable.id))
    .where(where)
    .orderBy(desc(visitsTable.createdAt));

  res.json(rows.map(r => formatVisit(r.visit, {
    customerName: r.customerName,
    assigneeName: r.assigneeName,
    propertyAddress: r.propertyAddress,
    propertyLat:r.propertyLat,propertyLng:r.propertyLng,
  })));
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post("/visits", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { customerId, propertyId, assigneeId, visitMode, purpose, notes, scheduledAt, smsReminderEnabled } = req.body;

  if (!purpose) {
    res.status(400).json({ error: "purpose is required" });
    return;
  }
  if (!scheduledAt) {
    res.status(400).json({ error: "scheduledAt is required — visits must be scheduled before they can be logged" });
    return;
  }
  if (!assigneeId) {
    res.status(400).json({ error: "assigneeId is required — a technician must be assigned to every visit" });
    return;
  }
  if (!propertyId) {
    res.status(400).json({ error: "propertyId is required — a property must be selected for every visit" });
    return;
  }

  const [visit] = await db.insert(visitsTable).values({
    tenantId,
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: parseInt(propertyId, 10),
    assigneeId: parseInt(assigneeId, 10),
    visitMode: visitMode ?? "scheduled",
    purpose,
    notes: notes ?? null,
    scheduledAt: new Date(scheduledAt),
    smsReminderEnabled: smsReminderEnabled === true || smsReminderEnabled === "true",
  }).returning();
  notifyVisitAssignment(tenantId, visit, `visit-assignment:${visit.id}:create`, userId);

  res.status(201).json(formatVisit(visit));
});

// ── GET ONE ───────────────────────────────────────────────────────────────────
router.get("/visits/:id", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number;
  const userId = res.locals.staffUserId as number;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || !(await canAccessVisit(tenantId, userId, id))) {
    res.status(404).json({ error: "Not found" }); return;
  }

  const [row] = await db
    .select({
      visit: visitsTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
      propertyLat:propertiesTable.lat,propertyLng:propertiesTable.lng,
    })
    .from(visitsTable)
    .leftJoin(customersTable, eq(visitsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(visitsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(visitsTable.propertyId, propertiesTable.id))
    .where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatVisit(row.visit, { customerName: row.customerName, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress,propertyLat:row.propertyLat,propertyLng:row.propertyLng }));
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.patch("/visits/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);
  const { assigneeId, visitMode, purpose, notes, scheduledAt, smsReminderEnabled } = req.body;
  const [current] = await db.select({ assigneeId: visitsTable.assigneeId }).from(visitsTable)
    .where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId))).limit(1);

  const updateData: Partial<typeof visitsTable.$inferInsert> = {};
  if (assigneeId !== undefined) updateData.assigneeId = assigneeId ? parseInt(assigneeId, 10) : null;
  if (visitMode) updateData.visitMode = visitMode;
  if (purpose) updateData.purpose = purpose;
  if (notes !== undefined) updateData.notes = notes;
  if (scheduledAt !== undefined) updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  if (smsReminderEnabled !== undefined) updateData.smsReminderEnabled = smsReminderEnabled === true || smsReminderEnabled === "true";

  const [updated] = await db.update(visitsTable)
    .set(updateData)
    .where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  if (assigneeId !== undefined && current?.assigneeId !== updated.assigneeId) {
    notifyVisitAssignment(
      tenantId,
      updated,
      `visit-assignment:${updated.id}:update:${updated.updatedAt.getTime()}`,
      userId,
    );
  }
  res.json(formatVisit(updated));
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete("/visits/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db.delete(visitsTable).where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ── COMPLETE ──────────────────────────────────────────────────────────────────
router.post("/visits/:id/complete", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { outcomeNotes } = req.body;
  if(!Number.isInteger(id)||!(await canAccessVisit(tenantId,getUserId(req),id))){res.status(403).json({error:"You are not assigned to this visit"});return;}

  const [updated] = await db.update(visitsTable)
    .set({ completedAt: new Date(), outcomeNotes: outcomeNotes ?? null })
    .where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  const stoppedAt=new Date();
  await db.update(subTimersTable).set({isActive:false,stoppedAt,
    elapsedSeconds:sql`GREATEST(0,FLOOR(EXTRACT(EPOCH FROM(${stoppedAt.toISOString()}::timestamptz-${subTimersTable.startedAt}))))::integer`})
    .where(and(eq(subTimersTable.tenantId,tenantId),eq(subTimersTable.visitId,id),eq(subTimersTable.isActive,true)));
  res.json(formatVisit(updated));
});

// ── CONVERT TO ESTIMATE ───────────────────────────────────────────────────────
router.post("/visits/:id/convert-to-estimate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [visit] = await db.select().from(visitsTable).where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)));
  if (!visit) { res.status(404).json({ error: "Not found" }); return; }

  const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [estimate] = await db.insert(estimatesTable).values({
    tenantId,
    customerId: visit.customerId,
    propertyId: visit.propertyId,
    assigneeId: visit.assigneeId,
    visitMode: visit.visitMode,
    scheduledAt: null,
    expiresAt: defaultExpiry,
    notes: visit.notes ?? null,
    lineItems: [],
    subtotal: 0,
    tax: 0,
    total: 0,
    status: "draft",
  }).returning();

  await db.update(visitsTable)
    .set({ convertedToEstimateId: estimate.id })
    .where(eq(visitsTable.id, id));

  res.status(201).json({ estimateId: estimate.id });
});

// ── CONVERT TO JOB ────────────────────────────────────────────────────────────
router.post("/visits/:id/convert-to-job", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals.staffTenantId as number;
  if (!["company_owner", "office_manager", "department_manager", "crew_manager"].includes(await getCallerRole(tenantId, res.locals.staffUserId as number))) {
    res.status(403).json({ error: "Manager role required to convert visits to jobs" }); return;
  }
  const id = parseInt(String(req.params.id), 10);

  const [visit] = await db.select().from(visitsTable).where(and(eq(visitsTable.id, id), eq(visitsTable.tenantId, tenantId)));
  if (!visit) { res.status(404).json({ error: "Not found" }); return; }

  const [job] = await paymentGuardedJobInsert(db).values({
    tenantId,
    title: visit.purpose,
    description: visit.notes ?? null,
    status: "scheduled",
    priority: "normal",
    customerId: visit.customerId,
    propertyId: visit.propertyId,
    assigneeId: visit.assigneeId,
    scheduledAt: visit.scheduledAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    totalAmount: 0,
  }).returning();

  await db.update(visitsTable)
    .set({ convertedToJobId: job.id })
    .where(eq(visitsTable.id, id));
  if (job.assigneeId) {
    void resolveJobAssignmentRecipientIds(tenantId, job.assigneeId, null).then(recipientUserIds => sendStaffPush({
      tenantId,
      recipientUserIds: recipientUserIds.filter(userId => userId !== res.locals.staffUserId as number),
      eventKey: `job-assignment:${job.id}:visit-conversion`,
      title: "Job assigned",
      body: `You have been assigned: ${job.title}`,
      data: { type: "job_assignment", jobId: job.id },
    }));
  }

  res.status(201).json({ jobId: job.id });
});

export default router;
