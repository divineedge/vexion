import { db, invoicesTable, tenantsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { chargeInvoiceCard } from "./invoiceCardPayments";
import { logger } from "./logger";

export function companyDateKey(date:Date,timeZone:string):string {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
let running=false;
export async function processDueInvoicePayments(now=new Date()){
  if(running)return;
  running=true;
  try {
    const rows=await db.select({invoice:invoicesTable,timezone:tenantsTable.timezone}).from(invoicesTable)
      .innerJoin(tenantsTable,eq(invoicesTable.tenantId,tenantsTable.id))
      .where(and(eq(tenantsTable.automaticInvoicePaymentMode,"due_date"),inArray(invoicesTable.status,["sent","overdue"]),isNotNull(invoicesTable.dueDate)));
    for(const row of rows){
      try {
        // Invoice due dates are calendar inputs persisted at UTC midnight, not
        // appointment instants; only "today" is derived from company timezone.
        if(row.invoice.dueDate!.toISOString().slice(0,10)<=companyDateKey(now,row.timezone))
          await chargeInvoiceCard(row.invoice.tenantId,row.invoice.id,"due_date");
      }catch(error){logger.error({error,invoiceId:row.invoice.id},"Due-date payment needs staff review");}
    }
  }finally{running=false;}
}
export function startDueInvoicePayments(){
  void processDueInvoicePayments().catch(error=>logger.error({error},"Due-date payment scan failed"));
  setInterval(()=>void processDueInvoicePayments().catch(error=>logger.error({error},"Due-date payment scan failed")),15*60*1000).unref();
}
