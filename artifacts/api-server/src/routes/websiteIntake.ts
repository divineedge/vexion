import {Router,type Request,type Response,type NextFunction} from 'express';
import {db,websiteIntakeSubmissionsTable} from '@workspace/db';
import {and,eq,desc,lt,sql} from 'drizzle-orm';
import {z} from 'zod';
import multer from 'multer';
import {hrStorage} from '../lib/hrFiles';
import {requireVerifiedStaff} from '../lib/verifiedStaff';
import {getTenantId,getUserId} from '../lib/tenantHelper';
import {getCallerRole,ADMIN_ROLES} from '../lib/roles';
import {checkPermission} from '../lib/rolePermissions';
import {requireHr,HrError,hrAudit} from '../lib/hrAccess';
import {websiteFlowSchema,getWebsiteForm,type FlowKind} from '../lib/websiteFlow';
import {publicWebsiteConfig,receiveWebsiteSubmission,reviewWebsiteSubmission,reviewInput,staffSubmission} from '../lib/websiteIntake';
import {websiteCustomerChoices} from '../lib/websiteCustomerChoices';
import {GetWebsiteCustomerChoicesParams,GetWebsiteCustomerChoicesQueryParams,GetWebsiteCustomerChoicesResponse} from '@workspace/api-zod';
export const publicWebsiteIntakeRouter=Router();
const attempts=new Map<string,{until:number;count:number}>();
publicWebsiteIntakeRouter.use('/public-intake',(req,res,next)=>{
 res.set('Cache-Control','no-store');
 const now=Date.now(),key=`${req.ip}:${req.method}`;
 let entry=attempts.get(key);if(!entry||entry.until<now){entry={until:now+60000,count:0};attempts.set(key,entry);}
 if(++entry.count>(req.method==='POST'?10:60)){res.status(429).json({error:'Please wait before trying again'});return;}
 if(attempts.size>10000)for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);
 if(attempts.size>10000)attempts.delete(attempts.keys().next().value!);
 next();
});
publicWebsiteIntakeRouter.get('/public-intake/config',async(req,res)=>{
 const kind=z.enum(['quote','hiring']).parse(req.query.kind);
 const tenantId=req.query.tenantId==null?undefined:Number(req.query.tenantId);
 if(tenantId!==undefined&&(!Number.isSafeInteger(tenantId)||tenantId<1))throw new HrError('Choose a valid business');
 res.json(await publicWebsiteConfig(kind,tenantId,typeof req.query.slug==='string'?req.query.slug:undefined));
});
const intakeUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:6,fieldSize:600000,fields:12}});
publicWebsiteIntakeRouter.post('/public-intake/submit',intakeUpload.fields([{name:'resume',maxCount:1},{name:'files',maxCount:5}]),async(req,res)=>{
 let body=req.body;
 if(req.body.submission){try{body=JSON.parse(req.body.submission);}catch{throw new HrError('Provide a valid application');}}
 const uploads=req.files as Record<string,Express.Multer.File[]>|undefined;
 res.status(201).json(await receiveWebsiteSubmission(body,uploads?.resume?.[0],uploads?.files??[]));
});
const router=Router();
router.use('/website-intake',requireVerifiedStaff,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
async function access(req:Request,kind:FlowKind){
 const tenant=getTenantId(req),user=getUserId(req);
 if(kind==='hiring')await requireHr(tenant,user);
 else{
  const role=await getCallerRole(tenant,user);
  if(!ADMIN_ROLES.has(role)||!(await Promise.all(['pages.billing','financials.jobPrices','customerInfo.email','customerInfo.phone'].map(p=>checkPermission(tenant,role,p as 'pages.billing'|'financials.jobPrices'|'customerInfo.email'|'customerInfo.phone')))).every(Boolean))throw new HrError('Office customer and estimate access is required',403);
 }
}
router.get('/website-intake/forms/:kind',async(req,res)=>{
 const kind=z.enum(['quote','hiring']).parse(req.params.kind);await access(req,kind);
 res.json(await getWebsiteForm(getTenantId(req),kind));
});
router.get('/website-intake/forms/:kind/history',async(req,res)=>{
 const kind=z.enum(['quote','hiring']).parse(req.params.kind);await access(req,kind);
 const before=req.query.before==null?undefined:z.coerce.number().int().positive().parse(req.query.before);
 const result=await db.execute(sql`SELECT id,revision,definition,published_by AS "publishedBy",publisher_name AS "publisherName",published_at AS "publishedAt",legacy
   FROM website_intake_versions WHERE tenant_id=${getTenantId(req)} AND kind=${kind}
   AND (${before??null}::integer IS NULL OR id<${before??null}) ORDER BY id DESC LIMIT 21`);
 const versions=result.rows.slice(0,20);
 res.json({versions,nextCursor:result.rows.length>20?Number(versions.at(-1)!.id):null});
});
router.post('/website-intake/forms/:kind/history/:id/restore',async(req,res)=>{
 const kind=z.enum(['quote','hiring']).parse(req.params.kind);await access(req,kind);
 const id=z.coerce.number().int().positive().parse(req.params.id);
 const {revision}=z.object({revision:z.number().int().nonnegative()}).strict().parse(req.body);
 const restored=await db.transaction(async tx=>{
  const tenant=getTenantId(req);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('website-form'),hashtext(${tenant+':'+kind}))`);
  const current=await getWebsiteForm(tenant,kind,tx);
  if(current.revision!==revision)throw new HrError('Someone changed this form. Reload before restoring; the draft has not been changed.',409);
  const result=await tx.execute(sql`SELECT definition FROM website_intake_versions WHERE id=${id} AND tenant_id=${tenant} AND kind=${kind}`);
  if(!result.rows[0])throw new HrError('Published version not found',404);
  await tx.execute(sql`UPDATE website_intake_forms SET draft=${JSON.stringify(result.rows[0].definition)}::jsonb,revision=revision+1,updated_by=${getUserId(req)},updated_at=now() WHERE tenant_id=${tenant} AND kind=${kind}`);
  return getWebsiteForm(tenant,kind,tx);
 });res.json(restored);
});
router.put('/website-intake/forms/:kind',async(req,res)=>{
 const kind=z.enum(['quote','hiring']).parse(req.params.kind);await access(req,kind);
 const input=z.object({definition:websiteFlowSchema,revision:z.number().int().nonnegative(),publish:z.boolean()}).strict().parse(req.body);
 if(kind==='hiring'&&input.definition.steps.some(s=>s.kind!=='questions'))throw new HrError('Hiring forms support question steps only');
 await db.transaction(async tx=>{
  const tenant=getTenantId(req),actor=getUserId(req);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('website-form'),hashtext(${tenant+':'+kind}))`);
  const current=await getWebsiteForm(tenant,kind,tx);
  if(current.revision!==input.revision)throw new HrError('Someone changed this form. Reload before saving; your draft has not been saved.',409);
  await tx.execute(sql`INSERT INTO website_intake_versions(tenant_id,kind,revision,definition,legacy)
   SELECT ${tenant},${kind},${current.revision},${JSON.stringify(current.published??current.definition)}::jsonb,1
   WHERE NOT EXISTS(SELECT 1 FROM website_intake_versions WHERE tenant_id=${tenant} AND kind=${kind}) ON CONFLICT DO NOTHING`);
  await tx.execute(sql`INSERT INTO website_intake_forms(tenant_id,kind,draft,published,revision,updated_by)
    VALUES(${tenant},${kind},${JSON.stringify(input.definition)}::jsonb,${JSON.stringify(input.publish?input.definition:current.published??current.definition)}::jsonb,1,${actor})
    ON CONFLICT(tenant_id,kind) DO UPDATE SET draft=EXCLUDED.draft,published=CASE WHEN ${input.publish} THEN EXCLUDED.draft ELSE website_intake_forms.published END,revision=website_intake_forms.revision+1,updated_by=EXCLUDED.updated_by,updated_at=now()`);
  if(input.publish)await tx.execute(sql`INSERT INTO website_intake_versions(tenant_id,kind,revision,definition,published_by,publisher_name,published_at)
   VALUES(${tenant},${kind},${current.revision+1},${JSON.stringify(input.definition)}::jsonb,${actor},(SELECT name FROM users WHERE id=${actor} AND tenant_id=${tenant}),now())`);
 });res.json(await getWebsiteForm(getTenantId(req),kind));
});
router.get('/website-intake/submissions',async(req,res)=>{
 const kind=z.enum(['quote','hiring']).parse(req.query.kind);await access(req,kind);
 const before=req.query.before==null?undefined:z.coerce.number().int().positive().parse(req.query.before);
 const rows=await db.select().from(websiteIntakeSubmissionsTable).where(and(eq(websiteIntakeSubmissionsTable.tenantId,getTenantId(req)),eq(websiteIntakeSubmissionsTable.kind,kind),before?lt(websiteIntakeSubmissionsTable.id,before):undefined)).orderBy(desc(websiteIntakeSubmissionsTable.id)).limit(101);
 const submissions=rows.slice(0,100).map(staffSubmission);
 res.json({submissions,nextCursor:rows.length>100?submissions.at(-1)!.id:null});
});
router.get('/website-intake/submissions/:id/customer-choices',async(req,res)=>{
 await access(req,'quote');
 const {id}=GetWebsiteCustomerChoicesParams.extend({id:z.coerce.number().int().positive()}).parse(req.params);
 const {search,...corrections}=GetWebsiteCustomerChoicesQueryParams.parse(req.query);
 res.json(GetWebsiteCustomerChoicesResponse.parse(await websiteCustomerChoices(getTenantId(req),id,search,db,corrections)));
});
router.post('/website-intake/submissions/:id/review',async(req,res)=>{
 const id=z.coerce.number().int().positive().parse(req.params.id);
 const [row]=await db.select().from(websiteIntakeSubmissionsTable).where(and(eq(websiteIntakeSubmissionsTable.tenantId,getTenantId(req)),eq(websiteIntakeSubmissionsTable.id,id)));
 if(!row)throw new HrError('Submission not found',404);await access(req,row.kind as FlowKind);
 const saved=await reviewWebsiteSubmission(getTenantId(req),getUserId(req),id,reviewInput.parse(req.body));
 res.json(staffSubmission(saved));
});
router.get('/website-intake/submissions/:id/files/:fileId',async(req,res)=>{
 const id=z.coerce.number().int().positive().parse(req.params.id);
 const fileId=z.string().uuid().parse(req.params.fileId);
 const [row]=await db.select().from(websiteIntakeSubmissionsTable).where(and(eq(websiteIntakeSubmissionsTable.tenantId,getTenantId(req)),eq(websiteIntakeSubmissionsTable.id,id)));
 if(!row)throw new HrError('Submission not found',404);
 await access(req,row.kind as FlowKind);
 const files=((row.payload as Record<string,unknown>).attachments??[]) as {id:string;objectPath:string;fileName:string;mimeType:string;sizeBytes:number}[];
 const attachment=files.find(f=>f.id===fileId);
 if(!attachment)throw new HrError('Attachment not found',404);
 const object=await hrStorage.getObjectEntityFile(attachment.objectPath);
 if(row.kind==='hiring')await hrAudit(db,getTenantId(req),getUserId(req),'website_application_attachment_downloaded',null,row.applicationId,null,{submissionId:row.id,fileId});
 res.set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
 res.set('Cache-Control','private, no-store');
 res.set('X-Content-Type-Options','nosniff');
 res.set('Content-Type',attachment.mimeType);res.set('Content-Length',String(attachment.sizeBytes));
 object.createReadStream().on('error',()=>{if(!res.headersSent){res.removeHeader('Content-Length');res.type('application/json').status(502).json({error:'Unable to download this private attachment'});}else res.destroy();}).pipe(res);
});
function errors(error:unknown,_req:Request,res:Response,next:NextFunction){
 if(error instanceof HrError){res.status(error.status).json({error:error.message});return;}
 if(error instanceof z.ZodError){res.status(400).json({error:error.issues.map(i=>i.message).join('; ')});return;}next(error);
}
function uploadErrors(error:unknown,_req:Request,res:Response,next:NextFunction){
 if(error instanceof multer.MulterError){res.status(413).json({error:'Upload up to five JPEG/PDF attachments and one hiring resume, at most 10 MB each'});return;}next(error);
}
router.use(errors);publicWebsiteIntakeRouter.use(uploadErrors);publicWebsiteIntakeRouter.use(errors);
export default router;
