/**
 * Development-only, rollback-only restore drill. No live table is replaced.
 * This verifies synthetic core record restoration, NOT a full system backup.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db,pool,tenantsTable,customersTable,propertiesTable,jobsTable,invoicesTable,estimatesTable,recoveryDrillsTable } from "@workspace/db";
import { isSoftwareOwner } from "../lib/softwareBilling";
class DrillRolledBack extends Error {}
async function main(){
  if(process.env.NODE_ENV==="production")throw new Error("Never run a restore drill against production.");
  let evidence="";
  try{
    await db.transaction(async tx=>{
      const [tenant]=await tx.insert(tenantsTable).values({name:"Rollback-only recovery verification"}).returning();
      const [customer]=await tx.insert(customersTable).values({tenantId:tenant.id,name:"Synthetic restore customer",email:"restore-fixture@example.invalid",phone:""}).returning();
      const [property]=await tx.insert(propertiesTable).values({tenantId:tenant.id,customerId:customer.id,address:"Synthetic recovery property"}).returning();
      const [invoice]=await tx.insert(invoicesTable).values({tenantId:tenant.id,customerId:customer.id,invoiceNumber:`DRILL-${randomUUID()}`,status:"draft",subtotal:125,total:125}).returning();
      await tx.insert(jobsTable).values({tenantId:tenant.id,customerId:customer.id,propertyId:property.id,title:"Synthetic recovery job",scheduledAt:new Date(),status:"scheduled",invoiceId:invoice.id});
      await tx.insert(estimatesTable).values({tenantId:tenant.id,customerId:customer.id,status:"draft",subtotal:125,total:125});
      const results=[];
      for(const table of ["customers","properties","jobs","invoices","estimates"]){
        const name=`restore_drill_${table}`;
        const rows=(await tx.execute(sql`SELECT * FROM ${sql.identifier(table)} WHERE tenant_id=${tenant.id}`)).rows;
        await tx.execute(sql`CREATE TEMP TABLE ${sql.identifier(name)} (LIKE ${sql.identifier(table)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP`);
        await tx.execute(sql`INSERT INTO ${sql.identifier(name)} SELECT * FROM jsonb_populate_recordset(NULL::${sql.identifier(name)},${JSON.stringify(rows)}::jsonb)`);
        const hashes=(await tx.execute(sql`SELECT (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) FROM ${sql.identifier(table)} t WHERE tenant_id=${tenant.id}) source,(SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'[]')) FROM ${sql.identifier(name)} r) restored`)).rows[0] as {source:string;restored:string};
        if(!rows.length||hashes.source!==hashes.restored)throw new Error(`Restore comparison failed for ${table}`);
        results.push(`${table}: ${rows.length} record, exact canonical match`);
      }
      const linked=(await tx.execute(sql`SELECT count(*)::int n FROM restore_drill_jobs j JOIN restore_drill_customers c ON c.id=j.customer_id JOIN restore_drill_properties p ON p.id=j.property_id JOIN restore_drill_invoices i ON i.id=j.invoice_id`)).rows[0] as {n:number};
      if(linked.n!==1)throw new Error("Restored job/customer/property/invoice relationship failed");
      evidence=`Automated development-only synthetic core-record drill: ${results.join("; ")}. Restored job relationships verified. All fixture records and staging tables rolled back. Does NOT verify a whole-database, production, or attachment backup.`;
      throw new DrillRolledBack();
    });
  }catch(error){if(!(error instanceof DrillRolledBack))throw error;}
  const actorId=Number(process.argv[2]),tenantId=Number(process.argv[3]);
  if(actorId&&tenantId&&await isSoftwareOwner(actorId,tenantId))await db.insert(recoveryDrillsTable).values({id:randomUUID(),userId:actorId,environment:"development",evidence,passed:true});
  process.stdout.write(evidence+"\n");
}
main().catch(e=>{process.stderr.write((e as Error).message+"\n");process.exitCode=1;}).finally(()=>pool.end());
