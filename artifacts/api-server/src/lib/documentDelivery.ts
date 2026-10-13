import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { sendEmail, type EmailProviderConfig, type SendEmailResult } from "./emailProvider";
import { publicAppUrl } from "./publicSite";
export type DeliveryContext={tenantId:number;documentType:"invoice"|"estimate";documentId:number};
export async function sendDocumentEmail(config:EmailProviderConfig,to:string,subject:string,body:string,html:string|undefined,context:DeliveryContext):Promise<SendEmailResult & {deliveryId:number}> {
  const token=randomUUID();
  const created=await db.execute(sql`INSERT INTO document_deliveries(tenant_id,document_type,document_id,channel,recipient,subject,provider,open_token)
    VALUES(${context.tenantId},${context.documentType},${context.documentId},'email',${to},${subject},${config.provider??"none"},${token}) RETURNING id`);
  const id=Number(created.rows[0].id);
  const escaped=body.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
  const tracked=(html??escaped)+`<img src="${publicAppUrl}/api/public/delivery/open/${token}.gif" width="1" height="1" alt="" style="display:none">`;
  let result:SendEmailResult;
  try {result=await sendEmail(config,to,subject,body,tracked);}
  catch(error) {
    await db.execute(sql`UPDATE document_deliveries SET status='uncertain',error=${String((error as Error).message).slice(0,2000)},completed_at=now() WHERE id=${id}`);
    throw error;
  }
  const status=result.devOnly?"dev_only":result.success?"accepted":result.definitiveFailure?"failed":"uncertain";
  await db.execute(sql`UPDATE document_deliveries SET status=${status},provider_message_id=${result.externalId??null},
    error=${result.error??null},completed_at=now() WHERE id=${id}`);
   return {...result,deliveryId:id};
}
