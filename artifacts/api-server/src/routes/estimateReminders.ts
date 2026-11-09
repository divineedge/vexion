import {Router} from "express";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {getTenantId,getUserId} from "../lib/tenantHelper";
import {isAdminRole} from "../lib/roles";
import {requireVerifiedStaff} from "../lib/verifiedStaff";
import {coerceEstimateReminderSettings} from "../lib/estimateReminderSettings";
import {logger} from "../lib/logger";
import {selectTenantById} from "../lib/schemaSafety";
const router=Router();
const rule=z.object({offsetDays:z.number().int().min(1).max(365),label:z.string().trim().min(1).max(100),channels:z.array(z.enum(["email","sms"])).max(2),notifyAdmin:z.boolean(),createTask:z.boolean()}).refine(r=>r.channels.length>0||r.notifyAdmin||r.createTask,"Choose a channel or internal action");
const settings=z.object({enabled:z.boolean(),rules:z.array(rule).max(10)}).refine(s=>!s.enabled||s.rules.length>0,"Add a reminder rule").refine(s=>new Set(s.rules.map(r=>r.offsetDays)).size===s.rules.length,"Use distinct reminder days");
router.use("/estimate-reminder-settings",requireVerifiedStaff,async(req,res,next)=>{if(!await isAdminRole(getTenantId(req),getUserId(req))){res.status(403).json({error:"Office access required"});return;}next();});
router.get("/estimate-reminder-settings",async(req,res)=>{
  const tenant=await selectTenantById(getTenantId(req));
  res.json(coerceEstimateReminderSettings(tenant?.estimateReminderSettings));
});
router.patch("/estimate-reminder-settings",async(req,res)=>{
  const parsed=settings.safeParse(req.body);if(!parsed.success){res.status(400).json({error:parsed.error.issues[0].message});return;}
  const tenantId=getTenantId(req);
  const current=await selectTenantById(tenantId);
  const merged={...asRecord(current?.estimateReminderSettings),...parsed.data};
  try {
    await db.transaction(async tx=>{
      await tx.execute(sql`UPDATE tenants SET estimate_reminder_settings=coalesce(estimate_reminder_settings,'{}'::jsonb) || ${JSON.stringify(merged)}::jsonb WHERE id=${tenantId}`);
      if(parsed.data.enabled)await tx.execute(sql`UPDATE estimates SET reminder_anchor_at=now() WHERE tenant_id=${tenantId} AND status='sent' AND reminder_anchor_at IS NULL`);
    });
  } catch (error) {
    logger.error({err:error,tenantId},"Estimate reminder settings were not written. Existing reminder JSON was left unchanged.");
    res.status(503).json({error:"Estimate reminder settings could not be saved. Existing reminders were left unchanged."});
    return;
  }
  res.json(coerceEstimateReminderSettings(merged));
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export default router;
