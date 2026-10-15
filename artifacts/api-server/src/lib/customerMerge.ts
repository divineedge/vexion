import {db,customersTable} from '@workspace/db';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {HrError,type HrDb} from './hrAccess';
type Customer=typeof customersTable.$inferSelect;
type Reference={schema:string;table:string;column:string;scoped:boolean};
async function references(handle:HrDb){
 const result=await handle.execute(sql`SELECT DISTINCT n.nspname AS schema,t.relname AS "table",a.attname AS "column",
  EXISTS(SELECT 1 FROM pg_attribute x WHERE x.attrelid=t.oid AND x.attname='tenant_id' AND NOT x.attisdropped) AS scoped
  FROM pg_constraint f JOIN pg_class t ON t.oid=f.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=f.conkey[1]
  WHERE f.contype='f' AND f.confrelid='customers'::regclass AND array_length(f.conkey,1)=1 AND n.nspname='public'
  AND t.relname NOT IN ('customer_merge_records','customer_otp_sessions')`);
 return result.rows as unknown as Reference[];
}
export async function installCustomerMergeSchema(){
 await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS merged_into_customer_id integer REFERENCES customers(id)`);
 await db.execute(sql`CREATE TABLE IF NOT EXISTS customer_merge_records(id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),source_id integer NOT NULL REFERENCES customers(id),primary_id integer NOT NULL REFERENCES customers(id),actor_id integer NOT NULL REFERENCES users(id),source_snapshot jsonb NOT NULL,primary_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,source_id))`);
 // Redirect incoming money/history; stale operational writes must re-check the primary's rules.
 await db.execute(sql`CREATE OR REPLACE FUNCTION customer_merge_reference() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE original integer;canonical integer;next_id integer;owner_id integer;depth integer:=0;
 BEGIN
 original:=(to_jsonb(NEW)->>TG_ARGV[0])::integer;canonical:=original;
 IF original IS NULL THEN RETURN NEW;END IF;
 LOOP
  SELECT merged_into_customer_id,tenant_id INTO next_id,owner_id FROM customers WHERE id=canonical FOR KEY SHARE;
  EXIT WHEN NOT FOUND OR next_id IS NULL;
  IF to_jsonb(NEW)?'tenant_id' AND (to_jsonb(NEW)->>'tenant_id')::integer<>owner_id THEN RAISE EXCEPTION 'Customer merge tenant mismatch';END IF;
  canonical:=next_id;depth:=depth+1;
  IF depth>100 THEN RAISE EXCEPTION 'Invalid customer merge chain';END IF;
 END LOOP;
 IF canonical IS DISTINCT FROM original THEN
  IF TG_TABLE_NAME NOT IN ('customer_credits','communications_log','activity_log','customers','property_ownership_history') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Customer was merged; use customer #'||canonical;
  END IF;
  IF TG_TABLE_NAME='customers' AND TG_ARGV[0]='referring_customer_id' AND canonical=(to_jsonb(NEW)->>'id')::integer THEN canonical:=NULL;END IF;
  NEW:=jsonb_populate_record(NEW,jsonb_build_object(TG_ARGV[0],canonical));
 END IF;
 RETURN NEW;
 END $$`);
 for(const ref of await references(db)){
  const table=sql`${sql.identifier(ref.schema)}.${sql.identifier(ref.table)}`,column=sql.identifier(ref.column),name='crm_'+createHash('sha256').update(ref.table+':'+ref.column).digest('hex').slice(0,18);
  const exists=await db.execute(sql`SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(${ref.schema+'.'+ref.table}) AND tgname=${name}`);
  if(!exists.rows.length)await db.execute(sql`CREATE TRIGGER ${sql.identifier(name)} BEFORE INSERT OR UPDATE OF ${column} ON ${table} FOR EACH ROW EXECUTE FUNCTION customer_merge_reference(${sql.raw("'"+ref.column.replace(/'/g,"''")+"'")})`);
 }
}
function blockers(primary:Customer,source:Customer){
 const errors:string[]=[];
 if(primary.mergedIntoCustomerId||source.mergedIntoCustomerId)errors.push('One of these records has already been merged. Open its current customer record.');
 if(source.stripeCustomerId&&source.stripeCustomerId!==primary.stripeCustomerId)errors.push(primary.stripeCustomerId?'Both customers have separate payment profiles. Reconcile those profiles before merging; cards and payment authorizations will not be moved.':'Use the customer with the payment profile as the record to keep.');
 if(source.stripeDefaultPaymentMethodId&&!source.stripeCustomerId)errors.push('The duplicate has an incomplete saved-card profile. Resolve it before merging.');
 if(source.paymentPolicy&&primary.paymentPolicy&&!isDeepStrictEqual(source.paymentPolicy,primary.paymentPolicy))errors.push('Customer payment requirements differ. Reconcile the prepayment/deposit rules before merging so no restriction is lost.');
 return errors;
}
const identity=(c:Customer)=>({id:c.id,name:c.name,email:c.email,phone:c.phone,archivedAt:c.archivedAt?.toISOString()??null});
export async function customerMergePreview(tenantId:number,primaryId:number,sourceId:number,handle:HrDb=db){
 if(primaryId===sourceId)throw new HrError('Choose a different duplicate customer');
 const rows=await handle.select().from(customersTable).where(and(eq(customersTable.tenantId,tenantId),inArray(customersTable.id,[primaryId,sourceId])));
 const primary=rows.find(c=>c.id===primaryId),source=rows.find(c=>c.id===sourceId);
 if(!primary||!source)throw new HrError('Customer not found',404);
 const relations=[];
 for(const ref of await references(handle)){
  const result=await handle.execute(sql`SELECT count(*)::int AS count FROM ${sql.identifier(ref.schema)}.${sql.identifier(ref.table)} WHERE ${sql.identifier(ref.column)}=${sourceId} ${ref.scoped?sql`AND tenant_id=${tenantId}`:sql``}`);
  if(Number(result.rows[0]?.count))relations.push({table:ref.table,count:Number(result.rows[0].count)});
 }
 return {primary:identity(primary),source:identity(source),relations,blockers:blockers(primary,source)};
}
export async function mergeCustomers(tenantId:number,actorId:number,primaryId:number,sourceId:number){
 if(primaryId===sourceId)throw new HrError('Choose a different duplicate customer');
 try{return await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},-93015)`);
  const rows=await tx.select().from(customersTable).where(and(eq(customersTable.tenantId,tenantId),inArray(customersTable.id,[primaryId,sourceId]))).orderBy(customersTable.id).for('update');
  const primary=rows.find(c=>c.id===primaryId),source=rows.find(c=>c.id===sourceId);
  if(!primary||!source)throw new HrError('Customer not found',404);
  if(source.mergedIntoCustomerId===primaryId)return {primaryId,sourceId};
  const problems=blockers(primary,source);if(problems.length)throw new HrError(problems.join(' '),409);
  await tx.execute(sql`INSERT INTO customer_merge_records(tenant_id,source_id,primary_id,actor_id,source_snapshot,primary_snapshot)
   VALUES(${tenantId},${sourceId},${primaryId},${actorId},${JSON.stringify(source)}::jsonb,${JSON.stringify(primary)}::jsonb)`);
  const updates:Partial<typeof customersTable.$inferInsert>={totalSpend:primary.totalSpend+source.totalSpend,smsOptOut:primary.smsOptOut||source.smsOptOut,emailOptOut:primary.emailOptOut||source.emailOptOut,
   tags:[...new Set([...(primary.tags??[]),...(source.tags??[])])],paymentPolicy:primary.paymentPolicy??source.paymentPolicy,
   customFieldValues:{...(source.customFieldValues as Record<string,unknown>??{}),...(primary.customFieldValues as Record<string,unknown>??{})},
   notes:[primary.notes,source.notes?`Merged from ${source.name} (#${source.id}):\n${source.notes}`:null].filter(Boolean).join('\n\n')||null};
  const contacts=['email','phone','secondaryPhone','company','customerType','billingAddress','billingCity','billingState','billingZip','physicalAddress','physicalCity','physicalState','physicalZip'] as const;
  for(const key of contacts)if(!primary[key]&&source[key])updates[key]=source[key];
  if(primary.stripeCustomerId&&primary.stripeCustomerId===source.stripeCustomerId&&!primary.stripeDefaultPaymentMethodId&&source.stripeDefaultPaymentMethodId){
   updates.stripeDefaultPaymentMethodId=source.stripeDefaultPaymentMethodId;
   updates.cardExpiresAt=source.cardExpiresAt;
   updates.cardExpiryReminderSentAt=source.cardExpiryReminderSentAt;
  }
  await tx.update(customersTable).set(updates).where(and(eq(customersTable.tenantId,tenantId),eq(customersTable.id,primaryId)));
  await tx.execute(sql`DELETE FROM customer_otp_sessions WHERE customer_id=${sourceId} AND tenant_id=${tenantId}`);
  for(const ref of await references(tx)){
   const self=ref.table==='customers'&&ref.column==='referring_customer_id';
   await tx.execute(sql`UPDATE ${sql.identifier(ref.schema)}.${sql.identifier(ref.table)} SET ${sql.identifier(ref.column)}=${self?sql`CASE WHEN id=${primaryId} THEN NULL ELSE ${primaryId}::integer END`:sql`${primaryId}`}
    WHERE ${sql.identifier(ref.column)}=${sourceId} ${ref.scoped?sql`AND tenant_id=${tenantId}`:sql``}`);
  }
  await tx.update(customersTable).set({mergedIntoCustomerId:primaryId,archivedAt:source.archivedAt??new Date(),totalSpend:0}).where(and(eq(customersTable.tenantId,tenantId),eq(customersTable.id,sourceId)));
  return {primaryId,sourceId};
 });}catch(error){
  if((error as {code?:string}).code==='23505'||(error as {cause?:{code?:string}}).cause?.code==='23505')throw new HrError('The customers have conflicting related records. Nothing was merged. Reconcile duplicate campaign, plan, or billing assignments before retrying.',409);
  throw error;
 }
}
