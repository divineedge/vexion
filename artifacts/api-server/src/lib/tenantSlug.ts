import { db,tenantsTable } from "@workspace/db";
import { eq,sql } from "drizzle-orm";
type Handle=typeof db|Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function ensureTenantSlug(tenantId:number,handle:Handle=db):Promise<string>{
 return handle.transaction(async tx=>{
  const [tenant]=await tx.select({id:tenantsTable.id,name:tenantsTable.name,slug:tenantsTable.slug}).from(tenantsTable).where(eq(tenantsTable.id,tenantId)).for("update");
  if(!tenant)throw new Error("Business not found");
  if(tenant.slug)return tenant.slug;
  const base=tenant.name.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")||"business";
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('portal-slug'),hashtext(${base}))`);
  let slug=base,counter=2;
  while((await tx.select({id:tenantsTable.id}).from(tenantsTable).where(eq(tenantsTable.slug,slug)).limit(1)).length)slug=`${base}-${counter++}`;
  await tx.update(tenantsTable).set({slug}).where(eq(tenantsTable.id,tenantId));
  return slug;
 });
}
