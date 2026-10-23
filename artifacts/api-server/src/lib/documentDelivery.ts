import { db, invoicesTable, estimatesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { sendEmail, type EmailProviderConfig, type SendEmailResult } from "./emailProvider";
import { publicAppUrl } from "./publicSite";
import { companyDocumentLink } from "./documentLinks";
import { chargeInvoiceCard } from "./invoiceCardPayments";
import { and, eq } from "drizzle-orm";
export type DeliveryContext={tenantId:number;documentType:"invoice"|"estimate";documentId:number};
export async function sendDocumentEmail(config:EmailProviderConfig,to:string,subject:string,body:string,html:string|undefined,context:DeliveryContext):Promise<SendEmailResult & {deliveryId:number}> {
  if(context.documentType==="invoice"){
    const outcome=await chargeInvoiceCard(context.tenantId,context.documentId,"when_sent");
    if(outcome.status==="paid"){
      subject=`Payment processed — ${subject}`;
      body+=`\n\nPayment status: PAID. ${outcome.message}`;
      if(html)html+=`<p><strong>Payment status: PAID.</strong> Payment has been processed successfully.</p>`;
    } else if(outcome.status==="failed"||outcome.status==="pending"){
      body+=`\n\nPayment status: NOT CONFIRMED PAID. ${outcome.message}`;
      if(html)html+=`<p>Payment has not been confirmed. Please check the invoice or contact the office before paying again.</p>`;
    }
  }
  const [document] = context.documentType === "invoice"
    ? await db.select({ token: invoicesTable.publicToken }).from(invoicesTable).where(and(eq(invoicesTable.id, context.documentId), eq(invoicesTable.tenantId, context.tenantId)))
    : await db.select({ token: estimatesTable.approvalToken }).from(estimatesTable).where(and(eq(estimatesTable.id, context.documentId), eq(estimatesTable.tenantId, context.tenantId)));
  if (document?.token) {
    const link = await companyDocumentLink(context.tenantId, context.documentType, document.token);
    const direct = `${publicAppUrl}/${context.documentType}/${document.token}`;
    const portal = `${publicAppUrl}/portal/share/${context.documentType}/${document.token}`;
    body = body.split(direct).join(link).split(portal).join(link);
    if (html) html = html.split(direct).join(link).split(portal).join(link);
    if (!body.includes(link)) body += `\n\nView your ${context.documentType}: ${link}`;
    if (html && !html.includes(link)) html += `<p><a href="${link}">View your ${context.documentType}</a></p>`;
  }
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
