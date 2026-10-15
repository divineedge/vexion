import {Router} from 'express';
import {db,tenantsTable,servicesTable} from '@workspace/db';
import {and,eq} from 'drizzle-orm';
import {acquisitionSettings} from '../lib/acquisitionRewards';
import {geocodeAddress} from './properties';
import {publicAppUrl} from '../lib/publicSite';
import {publicWebsiteConfig,receiveWebsiteSubmission} from '../lib/websiteIntake';
import {HrError} from '../lib/hrAccess';
const router=Router();
const requests=new Map<string,{count:number;expires:number}>();
router.use('/widget',(req,res,next)=>{
 const key=String(req.ip),now=Date.now();let item=requests.get(key);
 if(!item||item.expires<now){item={count:0,expires:now+60000};requests.set(key,item);}
 if(++item.count>60){res.status(429).json({error:'Please wait before trying again'});return;}
 if(requests.size>5000)requests.delete(requests.keys().next().value!);res.set('Cache-Control','no-store');next();
});
async function widgetTenant(id:unknown){
 if(!Number.isSafeInteger(Number(id))||Number(id)<1)return null;
 const [tenant]=await db.select().from(tenantsTable).where(eq(tenantsTable.id,Number(id)));
 return tenant&&acquisitionSettings(tenant.acquisitionSettings).quoteWidgetEnabled?tenant:null;
}
export function polygonAreaSqft(points:{lat:number;lng:number}[]):number{
 if(points.length<3)return 0;
 const mean=points.reduce((n,p)=>n+p.lat,0)/points.length*Math.PI/180,origin=points[0];
 const xy=points.map(p=>({x:(p.lng-origin.lng)*Math.PI/180*6371008.8*Math.cos(mean),y:(p.lat-origin.lat)*Math.PI/180*6371008.8}));
 return Math.round(Math.abs(xy.reduce((n,p,i)=>{const b=xy[(i+1)%xy.length];return n+p.x*b.y-b.x*p.y;},0))/2*10.76391041671*100)/100;
}
router.get('/widget/config',async(req,res)=>{
 const tenant=await widgetTenant(req.query.tenantId);
 if(!tenant){res.json({enabled:false,services:[],requiredFields:[],publicAppUrl});return;}
 const services=await db.select().from(servicesTable).where(and(eq(servicesTable.tenantId,tenant.id),eq(servicesTable.isActive,true)));
 const form=await publicWebsiteConfig('quote',tenant.id);
 res.json({...form,requiredFields:form.definition.steps.flatMap(s=>s.questions).filter(q=>q.required).map(q=>({...q,key:q.id})),services:services.map(s=>({id:s.id,name:s.name,description:s.description,pricingMode:s.pricingMode,basePrice:s.basePrice,pricingMatrix:s.pricingMatrix})),publicAppUrl});
});
router.get('/widget/services',async(req,res)=>{
 const tenant=await widgetTenant(req.query.tenantId);
 if(!tenant){res.json([]);return;}
 const rows=await db.select().from(servicesTable).where(and(eq(servicesTable.tenantId,tenant.id),eq(servicesTable.isActive,true)));
 // Never expose staff-only cost or internal service fields through a public list.
 res.json(rows.map(s=>({id:s.id,name:s.name,description:s.description,category:s.category,basePrice:s.basePrice,pricingMode:s.pricingMode,pricingMatrix:s.pricingMatrix})));
});
router.get('/widget/locate',async(req,res)=>{
 if(!await widgetTenant(req.query.tenantId))throw new HrError('Website quotes are not enabled',404);
 const address=String(req.query.address??'').trim();if(address.length<5||address.length>500)throw new HrError('Enter a complete physical address');
 const point=await geocodeAddress(address);if(!point)throw new HrError('Address could not be located. Staff can confirm the property location.',422);
 res.json({...point,provider:'configured_geocoder'});
});
router.post('/widget/quote-request',async(req,res)=>{
 // Old embedded clients must use the same review barrier as the new configurable form.
 const input=req.body,config=await publicWebsiteConfig('quote',Number(input.tenantId));
 const form=await import('../lib/websiteFlow').then(m=>m.getWebsiteForm(config.tenantId,'quote'));
 if(form.published)throw new HrError('Please refresh the website form before submitting',409);
 const answers={...input.customFieldValues,...input,name:input.name,serviceIds:input.serviceId?[String(input.serviceId)]:[]};
 const measurement=config.definition.steps.find(s=>s.kind==='measurement');
 const measurements=measurement&&(input.measurementPolygon?.length||input.areaSqft||input.lengthFt)?{[measurement.id]:{mode:input.lengthFt?'linear':'area',points:input.measurementPolygon??[],manual:input.lengthFt??input.areaSqft}}:{};
 // Prior clients had no explicit privacy consent; never infer consent from a request.
 if(input.consent!==true)throw new HrError('Please refresh the website form and confirm the privacy notice',409);
 res.status(201).json(await receiveWebsiteSubmission({tenantId:config.tenantId,kind:'quote',requestId:input.requestId,revision:config.revision,answers,measurements,consent:true,referralCode:input.referralCode,doorHangerCode:input.doorHangerCode}));
});
router.use((error:unknown,_req:import('express').Request,res:import('express').Response,next:import('express').NextFunction)=>{
 if(error instanceof HrError){res.status(error.status).json({error:error.message});return;}next(error);
});
export default router;
