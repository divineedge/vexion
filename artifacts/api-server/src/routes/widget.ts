import { Router } from "express";
import { db, tenantsTable, servicesTable, customersTable, propertiesTable, quotesTable, usersTable, taskNotificationsTable } from "@workspace/db";
import { and, eq, sql, isNull } from "drizzle-orm";
import { randomUUID,createHash } from "node:crypto";
import { acquisitionSettings, saveAcquisitionAttribution } from "../lib/acquisitionRewards";
import { resolveServicePrice, type PricingTier } from "../lib/pricingMatrix";
import { geocodeAddress } from "./properties";
import { publicAppUrl } from "../lib/publicSite";
const router=Router();
const requests=new Map<string,{count:number,expires:number}>();
function requiredCustomerFields(value:unknown):any[]{
  const stored=(value as {customerFields?:any[]}|null)?.customerFields??[];
  const builtIns=[{key:"name",label:"Name",type:"text",visible:true,required:true},
    {key:"email",label:"Email",type:"text",visible:true,required:true},{key:"phone",label:"Phone",type:"text",visible:true,required:true},
    ...["secondaryPhone","company","customerType","referralSource","billingAddress","notes","tags"].map(key=>({key,label:key,type:"text",visible:true,required:false}))];
  const merged=builtIns.map(field=>({...field,...stored.find(f=>f.key===field.key)}));
  for(const field of stored)if(!builtIns.some(b=>b.key===field.key))merged.push(field);
  return merged.filter(field=>field.visible!==false&&field.required);
}
router.use("/widget", (req,res,next)=>{
  const key=String(req.ip??req.socket.remoteAddress),now=Date.now();
  let entry=requests.get(key); if (!entry||entry.expires<now) {entry={count:0,expires:now+60000};requests.set(key,entry);}
  if (++entry.count>60) {res.status(429).json({error:"Please wait a minute before requesting another quote"});return;}
  if (requests.size>5000) requests.delete(requests.keys().next().value!); next();
});
export function polygonAreaSqft(points:{lat:number;lng:number}[]):number {
  const meanLat=points.reduce((sum,p)=>sum+p.lat,0)/points.length*Math.PI/180,origin=points[0];
  const converted=points.map(p=>({x:(p.lng-origin.lng)*Math.PI/180*6371008.8*Math.cos(meanLat),y:(p.lat-origin.lat)*Math.PI/180*6371008.8}));
  let area=0;for(let i=0;i<converted.length;i++){const a=converted[i],b=converted[(i+1)%converted.length];area+=a.x*b.y-b.x*a.y;}
  return Math.round(Math.abs(area)/2*10.76391041671*100)/100;
}
async function widgetTenant(id:unknown) {
  if (!Number.isInteger(Number(id))||Number(id)<=0) return null;
  const [tenant]=await db.select().from(tenantsTable).where(eq(tenantsTable.id,Number(id)));
  return tenant && acquisitionSettings(tenant.acquisitionSettings).quoteWidgetEnabled?tenant:null;
}
router.get("/widget/config",async(req,res)=>{
  const tenant=await widgetTenant(req.query.tenantId);
  if (!tenant) {res.json({enabled:false,services:[],requiredFields:[],publicAppUrl});return;}
  const services=await db.select().from(servicesTable).where(and(eq(servicesTable.tenantId,tenant.id),eq(servicesTable.isActive,true)));
  const requiredFields=requiredCustomerFields(tenant.customFields);
  res.json({enabled:true,tenantId:tenant.id,companyName:tenant.name,requiredFields,publicAppUrl,
    services:services.map(s=>({id:s.id,name:s.name,description:s.description,pricingMode:s.pricingMode??"flat",basePrice:s.basePrice,pricingMatrix:s.pricingMatrix}))});
});
router.get("/widget/services",async(req,res)=>{
  const tenant=await widgetTenant(req.query.tenantId);
  if (!tenant) {res.json([]);return;}
  const services=await db.select().from(servicesTable).where(and(eq(servicesTable.tenantId,tenant.id),eq(servicesTable.isActive,true)));
  res.json(services.map(s=>({id:s.id,name:s.name,description:s.description,category:s.category,basePrice:s.basePrice,pricingMode:s.pricingMode,pricingMatrix:s.pricingMatrix})));
});
router.get("/widget/locate",async(req,res)=>{
  if (!await widgetTenant(req.query.tenantId)) {res.status(404).json({error:"Website quotes are not enabled"});return;}
  const address=String(req.query.address??"").trim();
  if (address.length<5||address.length>500) {res.status(400).json({error:"Enter a complete physical address"});return;}
  const result=await geocodeAddress(address);
  if (!result) {res.status(422).json({error:"Address could not be located; enter the measurement manually"});return;}
  res.json({...result,provider:"configured_geocoder"});
});
router.post("/widget/quote-request",async(req,res)=>{
  const input=req.body,tenant=await widgetTenant(input.tenantId);
  if (!tenant) {res.status(404).json({error:"Website quotes are not enabled for this company"});return;}
  for(const key of ["name","email","phone","address","city","state","zip"]) {
    if(typeof input[key]!=="string"||!input[key].trim()||input[key].length>500) {res.status(400).json({error:`${key} is required`});return;}
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)||input.phone.replace(/\D/g,"").length<7||/\bP\.?\s*O\.?\s*BOX\b/i.test(input.address)){
    res.status(400).json({error:"Provide a valid email, phone number, and physical service address"});return;
  }
  if(!/^[0-9a-f-]{36}$/i.test(input.requestId??"")) {res.status(400).json({error:"A request ID is required"});return;}
  const [service]=await db.select().from(servicesTable).where(and(eq(servicesTable.tenantId,tenant.id),eq(servicesTable.id,Number(input.serviceId)),eq(servicesTable.isActive,true)));
  if (!service||!["flat","per_sqft","per_linear_ft","matrix"].includes(service.pricingMode??"flat")) {res.status(400).json({error:"Choose a service with supported pricing"});return;}
  let area=input.areaSqft==null?null:Number(input.areaSqft);
  const points=input.measurementPolygon as {lat:number;lng:number}[]|undefined;
  if (points) {
    if (!Array.isArray(points)||points.length<(service.pricingMode==="per_linear_ft"?2:3)||points.length>500||points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)||
      points.some(p=>Math.abs(p.lat-points[0].lat)>0.05||Math.abs(p.lng-points[0].lng)>0.05)) {res.status(400).json({error:"Draw a valid lawn boundary"});return;}
    if(service.pricingMode!=="per_linear_ft")area=polygonAreaSqft(points);
  }
  let length=input.lengthFt==null?null:Number(input.lengthFt);
  if(service.pricingMode==="per_linear_ft"&&points){
    const rad=(n:number)=>n*Math.PI/180;
    length=points.slice(1).reduce((total,p,i)=>{
      const previous=points[i],a=Math.sin(rad(p.lat-previous.lat)/2)**2+Math.cos(rad(previous.lat))*Math.cos(rad(p.lat))*Math.sin(rad(p.lng-previous.lng)/2)**2;
      return total+2*6371008.8*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)))*3.280839895;
    },0);
  }
  if (area!=null&&(!Number.isFinite(area)||area<=0||area>10000000)||length!=null&&(!Number.isFinite(length)||length<=0||length>100000)||
    ["per_sqft","matrix"].includes(service.pricingMode??"")&&!(area!>0)||service.pricingMode==="per_linear_ft"&&!(length!>0)) {
    res.status(400).json({error:"This service requires a valid measurement"});return;
  }
  const price=Math.round(resolveServicePrice(service.pricingMode??"flat",service.basePrice,service.pricingMatrix as PricingTier[]|null,area,length)*100)/100;
  if (!Number.isFinite(price)||price<=0) {res.status(422).json({error:"This service needs pricing configured before an instant quote is available"});return;}
  for(const field of requiredCustomerFields(tenant.customFields)) {
    if(!String(input[field.key]??input.customFieldValues?.[field.key]??"").trim()) {
      res.status(400).json({error:`${field.label??field.key} is required by this company`});return;
    }
  }
  try {
    const requestHash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const response=await db.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenant.id},hashtext(${input.requestId}))`);
      const prior=await tx.execute(sql`SELECT response,request_hash FROM public_quote_requests WHERE tenant_id=${tenant.id} AND request_id=${input.requestId}`);
      if(prior.rows.length){
        if(prior.rows[0].request_hash!==requestHash)throw new Error("This quote request was already submitted. Start a new quote to change its information.");
        return prior.rows[0].response;
      }
      let referrer:number|null=null,employee:number|null=null,visitId:number|null=null;
      if(input.referralCode) {
        const [ref]=await tx.select({id:customersTable.id}).from(customersTable).where(and(eq(customersTable.tenantId,tenant.id),eq(customersTable.referralShareToken,String(input.referralCode)),isNull(customersTable.archivedAt)));
        if(!ref||!acquisitionSettings(tenant.acquisitionSettings).customerReferralsEnabled)throw new Error("Referral link is no longer active");
        const [refCustomer]=await tx.select().from(customersTable).where(eq(customersTable.id,ref.id));
        if(refCustomer.email.toLowerCase()===input.email.trim().toLowerCase())throw new Error("You cannot refer yourself");
        referrer=ref.id;
      }
      if(input.doorHangerCode){
        const visit=await tx.execute(sql`SELECT id,employee_id FROM door_hanger_visits WHERE tenant_id=${tenant.id} AND share_token=${String(input.doorHangerCode)} AND converted_customer_id IS NULL FOR UPDATE`);
        if(!visit.rows.length)throw new Error("Door hanger link has already been used or is not valid");
        visitId=Number(visit.rows[0].id);employee=Number(visit.rows[0].employee_id);
      }
      // Public signups never attach unverified email input to an existing customer's private account.
      const [customer]=await tx.insert(customersTable).values({tenantId:tenant.id,name:input.name.trim(),email:input.email.trim().toLowerCase(),phone:input.phone.trim(),
        physicalAddress:input.address.trim(),physicalCity:input.city.trim(),physicalState:input.state.trim(),physicalZip:input.zip.trim(),
        referralSource:referrer?"customer_referral":visitId?"door_hanger":"website_quote",referringCustomerId:referrer,
        acquiredByEmployeeId:employee,doorHangerVisitId:visitId,
        smsOptOut:true,emailOptOut:true,
        secondaryPhone:input.secondaryPhone??input.customFieldValues?.secondaryPhone??null,
        company:input.company??input.customFieldValues?.company??null,customerType:input.customerType??input.customFieldValues?.customerType??null,
        billingAddress:input.billingAddress??input.customFieldValues?.billingAddress??null,notes:input.notes??input.customFieldValues?.notes??null,
        tags:Array.isArray(input.customFieldValues?.tags)?input.customFieldValues.tags:
          typeof input.customFieldValues?.tags==="string"?input.customFieldValues.tags.split(",").map((s:string)=>s.trim()).filter(Boolean):[],
        customFieldValues:input.customFieldValues??{}}).returning();
      const snapshot={...acquisitionSettings(tenant.acquisitionSettings),assignedAt:new Date().toISOString()};
      await tx.execute(sql`UPDATE customers SET acquisition_reward_snapshot=${JSON.stringify(snapshot)}::jsonb WHERE id=${customer.id}`);
      if(visitId)await tx.execute(sql`UPDATE door_hanger_visits SET converted_customer_id=${customer.id} WHERE id=${visitId}`);
      const [property]=await tx.insert(propertiesTable).values({tenantId:tenant.id,customerId:customer.id,address:input.address.trim(),city:input.city.trim(),state:input.state.trim(),zip:input.zip.trim(),
        lat:Number.isFinite(input.lat)?input.lat:null,lng:Number.isFinite(input.lng)?input.lng:null,
        size:area,sizeUnit:"sqft",
        measurementPolygons:points?[{id:randomUUID(),label:service.pricingMode==="per_linear_ft"?"Customer-measured line":"Customer-measured lawn",
          vertices:points.map(p=>[p.lat,p.lng]),mode:service.pricingMode==="per_linear_ft"?"linear":"area",areaSqft:service.pricingMode==="per_linear_ft"?0:area,
          lengthFt:length,enabled:true,color:"#22c55e"}]:[]}).returning();
      const [quote]=await tx.insert(quotesTable).values({tenantId:tenant.id,propertyId:property.id,token:randomUUID(),serviceId:service.id,serviceName:service.name,
        selectedZoneLabels:points?["Customer-measured lawn"]:[],totalAreaSqft:area,calculatedPrice:price,priceType:service.pricingMode??"flat",status:"pending",expiresAt:new Date(Date.now()+7*86400000)}).returning();
      const admins=await tx.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenant.id),sql`${usersTable.role} IN ('company_owner','office_manager','department_manager')`));
      for(const admin of admins)await tx.insert(taskNotificationsTable).values({tenantId:tenant.id,recipientUserId:admin.id,type:"website_quote",message:`New website quote: ${customer.name} — ${service.name}, $${price.toFixed(2)}`,linkPath:`/customers/${customer.id}`});
      const result={token:quote.token,price,serviceName:service.name,areaSqft:area,exactQuote:true};
      await tx.execute(sql`INSERT INTO public_quote_requests(tenant_id,request_id,response,request_hash) VALUES(${tenant.id},${input.requestId},${JSON.stringify(result)}::jsonb,${requestHash})`);
      return result;
    });res.status(201).json(response);
  }catch(error){res.status(400).json({error:(error as Error).message});}
});
export default router;
