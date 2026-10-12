import { Router } from "express";
import { db, tenantsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
const router=Router();
router.get("/public/delivery/open/:token.gif",async(req,res)=>{
  const token=String(req.params.token);
  if(/^[0-9a-f-]{36}$/i.test(token))await db.execute(sql`WITH recorded AS (
    INSERT INTO document_delivery_opens(delivery_id)
    SELECT id FROM document_deliveries WHERE open_token=${token} AND channel='email' AND status NOT IN ('failed','dev_only') RETURNING delivery_id)
    UPDATE document_deliveries SET open_count=open_count+1,first_opened_at=COALESCE(first_opened_at,now()),last_opened_at=now()
    WHERE id IN (SELECT delivery_id FROM recorded)`);
  res.set({"Content-Type":"image/gif","Cache-Control":"no-store"}).end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64"));
});
router.use("/document-deliveries",requireVerifiedStaff,async(req,res,next)=>{
  if(!await isAdminRole(getTenantId(req),getUserId(req))){res.status(403).json({error:"Office access required"});return;}next();
});
router.get("/document-deliveries",async(req,res)=>{
  const eventDate=(value:unknown)=>value instanceof Date?value:new Date(String(value));
  const type=String(req.query.type),id=Number(req.query.id),channel=String(req.query.channel??"email"),tenantId=getTenantId(req);
  if(!["invoice","estimate"].includes(type)||!["email","sms"].includes(channel)||!Number.isInteger(id)||id<1){res.status(400).json({error:"Choose a valid document and channel"});return;}
  const count=Math.min(100,Math.max(1,Number(req.query.limit)||25));
  let cursor:{at:string;id:number}|null=null;
  if(req.query.before){
    try{
      const value=String(req.query.before);if(value.length>512)throw new Error();
      if(/^\d+$/.test(value)){
        const previous=await db.execute(sql`SELECT id,created_at FROM document_deliveries WHERE tenant_id=${tenantId} AND document_type=${type} AND document_id=${id} AND id=${Number(value)}`);
        if(!previous.rows.length)throw new Error();
        cursor={at:eventDate(previous.rows[0].created_at).toISOString(),id:Number(value)};
      }else cursor=JSON.parse(Buffer.from(value,"base64url").toString("utf8"));
      if(!cursor||typeof cursor.at!=="string"||!Number.isSafeInteger(cursor.id)||Number.isNaN(Date.parse(cursor.at)))throw new Error();
      cursor.at=new Date(cursor.at).toISOString();
    }catch{res.status(400).json({error:"Invalid history cursor"});return;}
  }
  const document=await db.execute(type==="invoice"?sql`SELECT id,customer_id,public_token AS token FROM invoices WHERE tenant_id=${tenantId} AND id=${id}`:sql`SELECT id,customer_id,approval_token AS token FROM estimates WHERE tenant_id=${tenantId} AND id=${id}`);
  if(!document.rows.length){res.status(404).json({error:"Document not found"});return;}
  const rows=await db.execute(sql`SELECT d.id,'document_delivery' AS source,d.channel,d.status,d.provider,d.provider_message_id AS "providerMessageId",
    d.recipient,d.created_at AS "createdAt",d.completed_at AS "completedAt",d.delivered_at AS "deliveredAt",d.first_opened_at AS "firstOpenedAt",
    d.last_opened_at AS "lastOpenedAt",d.open_count AS "openCount",d.error,d.provider_receipt AS receipt,d.provider_checked_at AS "providerCheckedAt",
    COALESCE((SELECT jsonb_agg(o.opened_at ORDER BY o.id) FROM document_delivery_opens o WHERE o.delivery_id=d.id),'[]'::jsonb) AS "openHistory",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('resolution',v.resolution,'evidence',v.evidence,'createdAt',v.created_at,'actorName',u.name) ORDER BY v.id)
      FROM document_delivery_verifications v JOIN users u ON u.id=v.actor_id WHERE v.delivery_id=d.id AND v.tenant_id=${tenantId}),'[]'::jsonb) AS verifications
    FROM document_deliveries d WHERE d.tenant_id=${tenantId} AND d.document_type=${type} AND d.document_id=${id} AND d.channel=${channel}
    ${cursor?sql`AND (d.created_at<${cursor.at}::timestamptz OR (d.created_at=${cursor.at}::timestamptz AND d.id<${cursor.id}))`:sql``}
    ORDER BY d.created_at DESC,d.id DESC LIMIT ${count+1}`);
  const combined=rows.rows;
  // Existing queue attempts remain visible even if they predate document-level tracking.
  if(type==="invoice"&&channel==="email"){
    const legacy=await db.execute(sql`SELECT -q.id AS id,'legacy_invoice_queue' AS source,'email' AS channel,
      CASE WHEN q.status='sent' AND q.provider_message_id IS NOT NULL THEN 'accepted' WHEN q.status='sent' THEN 'unknown' ELSE q.status END AS status,q.delivery_provider AS provider,
      q.provider_message_id AS "providerMessageId",q.delivery_recipient AS recipient,q.created_at AS "createdAt",q.last_attempt_at AS "completedAt",
      0 AS "openCount",q.error_msg AS error,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('resolution','provider_verification','evidence',a.message,'createdAt',a.created_at,'actorName',u.name) ORDER BY a.id)
        FROM activity_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=q.tenant_id AND a.entity_id=q.invoice_id AND a.type='invoice_email_verified'
        AND a.message LIKE 'Email queue '||q.id||':%'),'[]'::jsonb) AS verifications
      FROM billing_email_queue q WHERE q.tenant_id=${tenantId} AND q.invoice_id=${id}
      AND NOT EXISTS(SELECT 1 FROM document_deliveries d WHERE d.tenant_id=q.tenant_id AND d.document_type='invoice' AND d.document_id=q.invoice_id
       AND d.provider_message_id=q.provider_message_id AND q.provider_message_id IS NOT NULL)
      ${cursor?sql`AND (q.created_at<${cursor.at}::timestamptz OR (q.created_at=${cursor.at}::timestamptz AND -q.id<${cursor.id}))`:sql``}
      ORDER BY q.created_at DESC,-q.id DESC LIMIT ${count+1}`);
    combined.push(...legacy.rows);
  }
  const info=document.rows[0];
  if(info.token){
    const legacyMessages=await db.execute(sql`SELECT -(1000000000+c.id::bigint) AS id,'legacy_communication' AS source,c.channel,
      CASE WHEN c.status='sent' AND c.external_id IS NOT NULL THEN 'accepted' WHEN c.status='sent' THEN 'unknown' ELSE c.status END AS status,
      c.external_id AS "providerMessageId",c.to_address AS recipient,c.created_at AS "createdAt",c.subject,0 AS "openCount",
      c.error_note AS error,'[]'::jsonb AS verifications,'[]'::jsonb AS "openHistory"
      FROM communications_log c WHERE c.tenant_id=${tenantId} AND c.customer_id=${Number(info.customer_id)}
      AND c.direction='outbound' AND c.channel=${channel} AND c.body LIKE ${`%${String(info.token)}%`}
      AND NOT EXISTS(SELECT 1 FROM document_deliveries d WHERE d.tenant_id=c.tenant_id AND d.document_type=${type} AND d.document_id=${id}
        AND d.provider_message_id=c.external_id AND c.external_id IS NOT NULL)
      ${type==="invoice"&&channel==="email"?sql`AND NOT EXISTS(SELECT 1 FROM billing_email_queue q WHERE q.tenant_id=c.tenant_id AND q.invoice_id=${id} AND q.provider_message_id=c.external_id AND c.external_id IS NOT NULL)`:sql``}
      ${cursor?sql`AND (c.created_at<${cursor.at}::timestamptz OR (c.created_at=${cursor.at}::timestamptz AND -(1000000000+c.id::bigint)<${cursor.id}))`:sql``}
      ORDER BY c.created_at DESC,-(1000000000+c.id::bigint) DESC LIMIT ${count+1}`);
    combined.push(...legacyMessages.rows);
  }
  combined.sort((a,b)=>eventDate(b.createdAt).getTime()-eventDate(a.createdAt).getTime()||Number(b.id)-Number(a.id));
  const deliveries=combined.slice(0,count),last=deliveries.at(-1);
  res.json({deliveries,nextBefore:combined.length>count&&last?Buffer.from(JSON.stringify({at:eventDate(last.createdAt).toISOString(),id:Number(last.id)})).toString("base64url"):null});
});
router.post("/document-deliveries/:id/verify",async(req,res)=>{
  const tenantId=getTenantId(req),id=Number(req.params.id),{resolution,evidence}=req.body;
  if(!["accepted","not_sent","unknown","delivered","failed"].includes(resolution)||typeof evidence!=="string"||evidence.trim().length<3||evidence.length>5000){
    res.status(400).json({error:"Choose a verification result and provide provider evidence"});return;
  }
  const row=await db.execute(sql`SELECT id FROM document_deliveries WHERE id=${id} AND tenant_id=${tenantId}`);
  if(!row.rows.length){res.status(404).json({error:"Delivery not found"});return;}
  await db.execute(sql`INSERT INTO document_delivery_verifications(delivery_id,tenant_id,actor_id,resolution,evidence)
    VALUES(${id},${tenantId},${getUserId(req)},${resolution},${evidence.trim()})`);
  res.json({success:true,message:"Verification recorded. No message has been resent."});
});
router.post("/document-deliveries/:id/check-provider",async(req,res)=>{
  const tenantId=getTenantId(req),id=Number(req.params.id);
  const result=await db.execute(sql`SELECT * FROM document_deliveries WHERE tenant_id=${tenantId} AND id=${id}`);
  const delivery=result.rows[0];
  if(!delivery){res.status(404).json({error:"Delivery not found"});return;}
  const [tenant]=await db.select().from(tenantsTable).where(eq(tenantsTable.id,tenantId));
  if(!tenant||!delivery.provider_message_id){res.status(409).json({error:"This attempt has no provider receipt ID. Verify it with the original provider; do not resend automatically."});return;}
  let url:string,headers:Record<string,string>;
  if(delivery.channel==="email" && delivery.provider==="resend" && tenant.emailProvider==="resend"){
    const config=tenant.emailProviderConfig as Record<string,string>;
    if(!config?.apiKey){res.status(409).json({error:"Original email provider connection is not available"});return;}
    url=`https://api.resend.com/emails/${encodeURIComponent(String(delivery.provider_message_id))}`;headers={Authorization:`Bearer ${config.apiKey}`};
  }else if(delivery.channel==="sms" && delivery.provider==="twilio" && tenant.phonePlatform==="twilio"){
    const config=tenant.phonePlatformConfig as Record<string,string>;
    if(!config?.accountSid||!config.authToken){res.status(409).json({error:"Original text provider connection is not available"});return;}
    url=`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages/${encodeURIComponent(String(delivery.provider_message_id))}.json`;
    headers={Authorization:`Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`};
  }else{res.status(409).json({error:"Automatic receipt lookup is not supported for this provider. Check the original provider and record its evidence manually."});return;}
  try{
    const response=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});
    if(!response.ok){res.status(409).json({error:"Provider lookup could not confirm this attempt. This does not mean it was not sent."});return;}
    const data=await response.json() as Record<string,unknown>;
    const state=String(data.last_event??data.status??"unknown");
    const receipt={id:data.id??data.sid??delivery.provider_message_id,status:state,createdAt:data.created_at??data.date_created??null,
      updatedAt:data.date_updated??null,errorCode:data.error_code??null,checkedAt:new Date().toISOString()};
    const status=state==="delivered"?"delivered":["bounced","undelivered","failed"].includes(state)?"failed":
      ["opened","clicked"].includes(state)?"opened_reported":delivery.status;
    await db.execute(sql`UPDATE document_deliveries SET provider_receipt=${JSON.stringify(receipt)}::jsonb,provider_checked_at=now(),status=${status}
      WHERE id=${id} AND tenant_id=${tenantId}`);
    res.json({receipt,status,message:"Provider record saved. Nothing has been resent."});
  }catch{res.status(409).json({error:"Provider did not respond. Delivery remains uncertain; no message was resent."});}
});
export default router;
