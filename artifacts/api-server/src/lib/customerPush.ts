import { Router,type RequestHandler } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createHash,randomBytes,createCipheriv,createDecipheriv } from "node:crypto";
import webpush from "web-push";
import { publicAppUrl } from "./publicSite";

function masterKey(){
  const secret=process.env.SESSION_SECRET;
  if(!secret)throw new Error("Push notification encryption is not configured");
  return createHash("sha256").update(`customer-web-push:${secret}`).digest();
}
function encrypt(value:string){
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",masterKey(),iv);
  const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return [iv,cipher.getAuthTag(),bytes].map(b=>b.toString("base64url")).join(".");
}
function decrypt(value:string){
  const [iv,tag,bytes]=value.split(".").map(s=>Buffer.from(s,"base64url"));
  const cipher=createDecipheriv("aes-256-gcm",masterKey(),iv);cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(bytes),cipher.final()]).toString("utf8");
}
async function pushKeys(tenantId:number){
  let result=await db.execute(sql`SELECT public_key,encrypted_private FROM customer_push_keys WHERE tenant_id=${tenantId}`);
  if(!result.rows.length){
    const pair=webpush.generateVAPIDKeys();
    await db.execute(sql`INSERT INTO customer_push_keys(tenant_id,public_key,encrypted_private) VALUES(${tenantId},${pair.publicKey},${encrypt(pair.privateKey)}) ON CONFLICT(tenant_id) DO NOTHING`);
    result=await db.execute(sql`SELECT public_key,encrypted_private FROM customer_push_keys WHERE tenant_id=${tenantId}`);
  }
  return {publicKey:String(result.rows[0].public_key),privateKey:decrypt(String(result.rows[0].encrypted_private))};
}
export function createCustomerPushRouter(authorize:RequestHandler){
  const router=Router();
  router.get("/portal/push-key",authorize,async(req:any,res)=>{
    const keys=await pushKeys(req.portalLocals.portalTenantId);res.json({publicKey:keys.publicKey});
  });
  router.post("/portal/push-subscription",authorize,async(req:any,res)=>{
    const {endpoint,keys}=req.body??{};
    let valid=false;
    try{
      const url=new URL(endpoint);
      valid=url.protocol==="https:"&&url.port===""&&!url.username&&!url.password&&endpoint.length<=4096&&
        ["fcm.googleapis.com","push.services.mozilla.com","push.apple.com","notify.windows.com"].some(domain=>url.hostname===domain||url.hostname.endsWith(`.${domain}`));
    }catch{}
    if(!valid||!keys||typeof keys.p256dh!=="string"||!/^[\w-]{80,200}$/.test(keys.p256dh)||typeof keys.auth!=="string"||!/^[\w-]{16,100}$/.test(keys.auth)){
      res.status(400).json({error:"A valid supported browser push subscription is required"});return;
    }
    const {portalTenantId:tenant,portalCustomerId:customer}=req.portalLocals;
    await db.execute(sql`INSERT INTO customer_push_subscriptions(tenant_id,customer_id,endpoint,keys) VALUES(${tenant},${customer},${endpoint},${JSON.stringify({p256dh:keys.p256dh,auth:keys.auth})}::jsonb)
      ON CONFLICT(endpoint) DO UPDATE SET tenant_id=excluded.tenant_id,customer_id=excluded.customer_id,keys=excluded.keys`);
    res.json({enabled:true});
  });
  router.delete("/portal/push-subscription",authorize,async(req:any,res)=>{
    if(typeof req.body?.endpoint!=="string"){res.status(400).json({error:"Device endpoint required"});return;}
    await db.execute(sql`DELETE FROM customer_push_subscriptions WHERE tenant_id=${req.portalLocals.portalTenantId} AND customer_id=${req.portalLocals.portalCustomerId} AND endpoint=${req.body.endpoint}`);
    res.json({enabled:false});
  });
  return router;
}
export async function sendCustomerVisitPush(tenantId:number,customerId:number,title:string,body:string){
  const subscriptions=await db.execute(sql`SELECT id,endpoint,keys FROM customer_push_subscriptions WHERE tenant_id=${tenantId} AND customer_id=${customerId}`);
  if(!subscriptions.rows.length)return {sent:0,failed:0};
  const keys=await pushKeys(tenantId);let sent=0,failed=0;
  for(const sub of subscriptions.rows){
    try{
      await webpush.sendNotification({endpoint:String(sub.endpoint),keys:sub.keys as {p256dh:string;auth:string}},JSON.stringify({title,body,url:`${publicAppUrl}/portal/`}),
        {TTL:3600,vapidDetails:{subject:publicAppUrl,publicKey:keys.publicKey,privateKey:keys.privateKey}});
      sent++;
    }catch(error){
      const status=(error as {statusCode?:number}).statusCode;
      if(status===404||status===410)await db.execute(sql`DELETE FROM customer_push_subscriptions WHERE id=${sub.id} AND tenant_id=${tenantId}`);
      failed++;
    }
  }
  return {sent,failed};
}
