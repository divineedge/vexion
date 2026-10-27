/** Isolated development-only browser fixtures. Never logs usable credentials. */
import {randomBytes} from "node:crypto";
import {readFileSync,writeFileSync,chmodSync,unlinkSync} from "node:fs";
import bcrypt from "bcryptjs";
import {db,pool,usersTable,customersTable,propertiesTable,servicesTable,inventoryItemsTable,platformOwnersTable,staffSessionsTable} from "@workspace/db";
import {and,eq,inArray} from "drizzle-orm";

const path="/tmp/document-workflow-qa.json";
const tenantId=276,ownerId=337;
let stage="guard";
async function main(){
  if(process.env.NODE_ENV==="production")throw new Error("Development fixtures only");
  const[owner]=await db.select().from(usersTable).where(and(eq(usersTable.id,ownerId),eq(usersTable.tenantId,tenantId)));
  if(!owner || !/^launch-qa-.*@example\.invalid$/.test(owner.email))throw new Error("Synthetic account guard failed");
  const base=`https://${process.env.REPLIT_DEV_DOMAIN}/api`;
  const rest=async(endpoint:string,token?:string,method="GET",body?:unknown)=>{
    const response=await fetch(base+endpoint,{method,headers:{"Content-Type":"application/json",...(token?{"x-staff-session":token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    if(!response.ok)throw new Error(`QA request failed with ${response.status}`);
    return await response.json();
  };
  if(process.argv.includes("verify")){
    const f=JSON.parse(readFileSync(path,"utf8"));
    const assert=(value:unknown,message:string)=>{if(!value)throw new Error(`QA check: ${message}`);};
    const[before]=await db.select({quantity:inventoryItemsTable.quantity}).from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id,f.inventory.id),eq(inventoryItemsTable.tenantId,tenantId)));
    const invoice=f.invoiceId?await rest(`/invoices/${f.invoiceId}`,f.admin.token):await rest("/invoices",f.admin.token,"POST",{
      customerId:f.customer.id,propertyId:f.property.id,dueDate:"2032-07-01",status:"draft",taxRate:0,
      notes:"QA document search and metadata verification",
      lineItems:[
        {description:f.services[0].name,quantity:1,unitPrice:40,serviceId:f.services[0].id},
        {description:f.inventory.name,quantity:2,unitPrice:10,inventoryItemId:f.inventory.id,sku:f.inventory.sku},
      ],
    });
    f.invoiceId=invoice.id;writeFileSync(path,JSON.stringify(f),{mode:0o600});
    const saved=await rest(`/invoices/${invoice.id}`,f.admin.token);
    assert(saved.lineItems?.some((line:any)=>line.serviceId===f.services[0].id),"Invoice service metadata missing");
    assert(saved.lineItems?.some((line:any)=>line.inventoryItemId===f.inventory.id&&line.sku===f.inventory.sku),"Invoice inventory metadata missing");
    assert(saved.lineItems.every((line:any)=>!("costPrice" in line)),"Internal cost leaked into invoice lines");
    const[after]=await db.select({quantity:inventoryItemsTable.quantity}).from(inventoryItemsTable).where(eq(inventoryItemsTable.id,f.inventory.id));
    assert(after.quantity===before.quantity,"Invoice billing must not consume job stock again");
    stage="draft-plan";
    const plan=await rest("/platform-billing/plans",f.owner.token,"POST",{
      name:`QA Document Feature Draft ${f.inventory.id}`,tier:`qa-doc-${f.inventory.id}`,price:29,billingInterval:"month",active:false,
      maxUsers:null,maxProperties:null,cardFeeBps:null,cardFeeFixedCents:null,achFeeBps:null,achFeeFixedCents:null,
      features:["estimates","invoices"],cardFeeMinCents:50,cardFeeMaxCents:500,achFeeMinCents:25,achFeeMaxCents:250,
    });
    f.planId=plan.id;writeFileSync(path,JSON.stringify(f),{mode:0o600});
    const updated=await rest(`/platform-billing/plans/${plan.id}`,f.owner.token,"PATCH",{
      name:plan.name,tier:plan.tier,price:29,billingInterval:"month",active:false,features:["invoices","inventory"],
      maxUsers:null,maxProperties:null,cardFeeBps:null,cardFeeFixedCents:null,achFeeBps:null,achFeeFixedCents:null,
      cardFeeMinCents:75,cardFeeMaxCents:600,achFeeMinCents:30,achFeeMaxCents:300,
    });
    assert(updated.cardFeeMinCents===75&&updated.cardFeeMaxCents===600&&updated.achFeeMinCents===30&&updated.achFeeMaxCents===300,"Plan fee bounds not saved");
    assert(updated.features.includes("inventory")&&!updated.features.includes("estimates"),"Actual feature choices not saved");
    console.log(JSON.stringify({invoiceId:invoice.id,planId:plan.id,invoiceMetadataSaved:true,stockUnchanged:true,planFeaturesAndBothFeeBoundsSaved:true,liveStripeCalls:false}));
    return;
  }
  if(process.argv.includes("cleanup")){
    const fixture=JSON.parse(readFileSync(path,"utf8"));
    const[admin]=await db.select().from(usersTable).where(and(eq(usersTable.id,fixture.admin.id),eq(usersTable.tenantId,tenantId)));
    if(!admin?.email.endsWith("@example.invalid"))throw new Error("Synthetic admin guard failed");
    if(fixture.originalWeather && fixture.owner.token)await rest("/settings/weather-locations",fixture.owner.token,"PUT",fixture.originalWeather).catch(()=>{});
    await db.update(usersTable).set({isActive:false,passwordHash:await bcrypt.hash(randomBytes(24).toString("hex"),10)}).where(inArray(usersTable.id,[ownerId,admin.id]));
    await db.update(staffSessionsTable).set({expiresAt:new Date(0)}).where(inArray(staffSessionsTable.userId,[ownerId,admin.id]));
    if(!fixture.hadGrant)await db.delete(platformOwnersTable).where(eq(platformOwnersTable.userId,ownerId));
    unlinkSync(path);
    console.log("Synthetic browser accounts deactivated; sessions expired; temporary grant and private fixture removed.");
    return;
  }
  stage="activate";
  const password=randomBytes(24).toString("base64url");
  const passwordHash=await bcrypt.hash(password,10);
  await db.update(usersTable).set({isActive:true,passwordHash}).where(eq(usersTable.id,ownerId));
  const hadGrant=(await db.select().from(platformOwnersTable).where(eq(platformOwnersTable.userId,ownerId))).length>0;
  if(!hadGrant)await db.insert(platformOwnersTable).values({userId:ownerId});
  const suffix=randomBytes(4).toString("hex");
  const[admin]=await db.insert(usersTable).values({tenantId,name:"QA document office admin",email:`qa-doc-admin-${suffix}@example.invalid`,role:"office_manager",passwordHash,isActive:true}).returning();
  const fixture:any={tenantId,hadGrant,owner:{id:ownerId,email:owner.email,password},admin:{id:admin.id,email:admin.email,password}};
  const save=()=>{writeFileSync(path,JSON.stringify(fixture),{mode:0o600});chmodSync(path,0o600);};
  save();
  stage="login";
  fixture.owner.token=(await rest("/auth/login",undefined,"POST",{email:owner.email,password})).sessionToken;
  fixture.admin.token=(await rest("/auth/login",undefined,"POST",{email:admin.email,password})).sessionToken;
  if(!fixture.owner.token || !fixture.admin.token)throw new Error("Session confirmation failed");
  save();
  stage="documents";
  const[customer]=await db.select({id:customersTable.id,name:customersTable.name}).from(customersTable).where(and(eq(customersTable.tenantId,tenantId),eq(customersTable.id,1439)));
  if(!customer)throw new Error("Synthetic customer missing");
  const[property]=await db.select({id:propertiesTable.id,address:propertiesTable.address}).from(propertiesTable).where(and(eq(propertiesTable.tenantId,tenantId),eq(propertiesTable.customerId,customer.id)));
  if(!property)throw new Error("Synthetic property missing");
  fixture.customer=customer;fixture.property=property;
  fixture.services=[];
  for(const [index,price] of [40,25,15,10].entries()){
    const[service]=await db.insert(servicesTable).values({tenantId,name:`QA Bundle ${index+1} ${suffix}`,basePrice:price}).returning();
    fixture.services.push({id:service.id,name:service.name,price});
  }
  const[item]=await db.insert(inventoryItemsTable).values({tenantId,name:`QA Document Part ${suffix}`,sku:`QA-DOC-${suffix}`,unitPrice:4,markedUpPrice:10,quantity:8}).returning();
  fixture.inventory={id:item.id,name:item.name,sku:item.sku,price:10};
  fixture.originalWeather=await rest("/settings/weather-locations",fixture.owner.token);
  await rest("/settings/weather-locations",fixture.owner.token,"PUT",{locations:[
    {id:"qa-denver",label:"Denver, CO",query:"Denver, CO"},
    {id:"qa-zip",label:"80501",query:"80501"},
  ]});
  save();
  console.log("Private synthetic document fixtures ready at /tmp/document-workflow-qa.json.");
}
main().catch(error=>{const detail=error instanceof Error&&error.message.startsWith("QA ")?error.message:error instanceof Error?error.name:"Error";console.error(`QA fixture operation failed at ${stage}: ${detail}`);process.exitCode=1;}).finally(()=>pool.end());
