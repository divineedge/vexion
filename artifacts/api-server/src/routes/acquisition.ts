import { Router } from "express";
import { db, tenantsTable, usersTable, jobsTable, customersTable, propertiesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { acquisitionSettings, defaultAcquisitionSettings, processAcquisitionRewards } from "../lib/acquisitionRewards";
import { publicAppUrl } from "../lib/publicSite";
const router = Router();
router.use("/marketing/acquisition", async(req,res,next) => {
  if (!await isAdminRole(getTenantId(req),getUserId(req))) {res.status(403).json({error:"Office access required"});return;} next();
});
router.get("/marketing/acquisition/settings", async(req,res) => {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id,getTenantId(req)));
  res.json({settings:acquisitionSettings(tenant?.acquisitionSettings)});
});
router.patch("/marketing/acquisition/settings", async(req,res) => {
  const body = req.body;
  const input = body && Object.prototype.hasOwnProperty.call(body,"settings") ? body.settings : body;
  if (!input || typeof input!=="object" || Array.isArray(input)) {
    res.status(400).json({error:"Settings must be an object"});return;
  }
  if (Object.keys(input).some(key=>!Object.prototype.hasOwnProperty.call(defaultAcquisitionSettings,key))) {
    res.status(400).json({error:"Unknown growth program setting"});return;
  }
  // Autosave sends changed fields only. Lock and merge with the latest company
  // settings so separate edits never reset other programs or their reward values.
  const saved=await db.transaction(async tx=>{
    const tenantId=getTenantId(req);
    const [tenant]=await tx.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId)).for("update");
    if (!tenant) {res.status(404).json({error:"Company not found"});return;}
    const merged={...acquisitionSettings(tenant.acquisitionSettings),...input};
    for (const field of ["doorHangersEnabled","employeeRewardsEnabled","customerReferralsEnabled","quoteWidgetEnabled"]) {
      if (typeof merged[field]!=="boolean") {res.status(400).json({error:`${field} must be true or false`});return;}
    }
    for (const prefix of ["employee","referral"]) {
      if (!["fixed","percent"].includes(merged[`${prefix}RewardType`]) || typeof merged[`${prefix}RewardValue`]!=="number" ||
        !Number.isFinite(merged[`${prefix}RewardValue`]) || merged[`${prefix}RewardValue`]<0 ||
        merged[`${prefix}RewardValue`]>(merged[`${prefix}RewardType`]==="percent"?100:100000)) {
        res.status(400).json({error:"Invalid reward amount"});return;
      }
    }
    if (merged.trigger!=="first_paid_invoice") {res.status(400).json({error:"Unsupported reward trigger"});return;}
    const settings=acquisitionSettings(merged);
    await tx.execute(sql`UPDATE tenants SET acquisition_settings=${JSON.stringify(settings)}::jsonb WHERE id=${tenantId}`);
    // Respond only after the transaction commits successfully.
    return settings;
  });
  if(saved)res.json({settings:saved});
});
router.get("/marketing/acquisition/rewards",async(req,res)=>{
  const tenantId=getTenantId(req); await processAcquisitionRewards(tenantId);
  const rows=await db.execute(sql`SELECT r.id,r.kind,r.customer_id AS "customerId",c.name AS "customerName",
    r.recipient_user_id AS "recipientUserId",u.name AS "employeeName",r.recipient_customer_id AS "recipientCustomerId",
    rc.name AS "referringCustomerName",r.invoice_id AS "invoiceId",r.amount::float AS amount,r.earned_at AS "earnedAt"
    FROM acquisition_rewards r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.recipient_user_id
    LEFT JOIN customers rc ON rc.id=r.recipient_customer_id WHERE r.tenant_id=${tenantId} ORDER BY r.id DESC`);
  res.json({rewards:rows.rows});
});
router.get("/marketing/door-hangers",async(req,res)=>{
  const tenantId=getTenantId(req),userId=getUserId(req),office=await isAdminRole(tenantId,userId);
  const jobId=req.query.jobId?Number(req.query.jobId):null;
  const rows=await db.execute(sql`SELECT v.id,v.address,v.lat,v.lng,v.job_id AS "jobId",v.employee_id AS "employeeId",u.name AS "employeeName",v.share_token AS "shareToken",
    v.completed_at AS "completedAt",v.converted_customer_id AS "convertedCustomerId"
    FROM door_hanger_visits v JOIN users u ON u.id=v.employee_id WHERE v.tenant_id=${tenantId}
    ${office?sql``:sql`AND v.employee_id=${userId}`} ${jobId?sql`AND v.job_id=${jobId}`:sql``} ORDER BY v.completed_at DESC LIMIT 1000`);
  const employees=await db.select({id:usersTable.id,name:usersTable.name}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),office?undefined:eq(usersTable.id,userId)));
  const jobs=await db.select({id:jobsTable.id,title:jobsTable.title,customerName:customersTable.name,propertyAddress:propertiesTable.address,propertyId:jobsTable.propertyId})
    .from(jobsTable).leftJoin(customersTable,eq(customersTable.id,jobsTable.customerId)).leftJoin(propertiesTable,eq(propertiesTable.id,jobsTable.propertyId))
    .where(and(eq(jobsTable.tenantId,tenantId),office?undefined:sql`(${jobsTable.assigneeId}=${userId} OR EXISTS(
      SELECT 1 FROM crew_members cm WHERE cm.crew_id=${jobsTable.crewId} AND cm.user_id=${userId}))`)).limit(200);
  res.json({visits:rows.rows.map(v=>({...v,shareUrl:`${publicAppUrl}/quote-widget?tenantId=${tenantId}&dh=${v.shareToken}`})),employees,jobs});
});
router.post("/marketing/door-hangers",async(req,res)=>{
  const tenantId=getTenantId(req),actorId=getUserId(req),office=await isAdminRole(tenantId,actorId);
  const [tenant]=await db.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  if (!acquisitionSettings(tenant?.acquisitionSettings).doorHangersEnabled) {res.status(409).json({error:"Door hanger tracking is disabled in company settings"});return;}
  const {address,lat,lng,jobId}=req.body;
  const employeeId=office && req.body.employeeId?Number(req.body.employeeId):actorId;
  const completedAt=req.body.completedAt?new Date(req.body.completedAt):new Date();
  if (typeof address!=="string" || !address.trim() || address.length>500 || !Number.isFinite(completedAt.getTime()) ||
    completedAt.getTime()>Date.now()+60000 || lat!=null && (!Number.isFinite(lat)||Math.abs(lat)>90) || lng!=null && (!Number.isFinite(lng)||Math.abs(lng)>180)) {
    res.status(400).json({error:"A valid house address, coordinates, and non-future completion date are required"});return;
  }
  const [employee]=await db.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,employeeId)));
  if (!employee) {res.status(400).json({error:"Employee not in this company"});return;}
  if (jobId) {
    const [job]=await db.select({id:jobsTable.id}).from(jobsTable).where(and(eq(jobsTable.tenantId,tenantId),eq(jobsTable.id,Number(jobId)),
      office?undefined:sql`(${jobsTable.assigneeId}=${actorId} OR EXISTS(SELECT 1 FROM crew_members cm WHERE cm.crew_id=${jobsTable.crewId} AND cm.user_id=${actorId}))`));
    if (!job) {res.status(403).json({error:"Job not available to this employee"});return;}
  }
  const result=await db.execute(sql`INSERT INTO door_hanger_visits(tenant_id,job_id,employee_id,address,lat,lng,completed_at,recorded_by)
    VALUES(${tenantId},${jobId?Number(jobId):null},${employeeId},${address.trim()},${lat??null},${lng??null},${completedAt.toISOString()},${actorId}) RETURNING id`);
  res.status(201).json({id:result.rows[0].id});
});
export default router;
