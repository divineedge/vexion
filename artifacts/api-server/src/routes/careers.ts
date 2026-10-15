import { Router } from "express";
import multer from "multer";
import { db,hrSettingsTable,hrPostingsTable } from "@workspace/db";
import { and,eq } from "drizzle-orm";
import { companyCareers,intakeApplication } from "../lib/hiring";
import { HrError } from "../lib/hrAccess";
import { FormError } from "../lib/jobForms";
import { hrUpload } from "../lib/hrFiles";
import {getWebsiteForm} from '../lib/websiteFlow';
import {publicWebsiteConfig,receiveWebsiteSubmission} from '../lib/websiteIntake';
const router=Router();
const attempts=new Map<string,{until:number,count:number}>();
router.get("/careers/:slug",async(req,res)=>{
 const tenant=await companyCareers(String(req.params.slug));
 const [settings]=await db.select().from(hrSettingsTable).where(eq(hrSettingsTable.tenantId,tenant.id));
 const enabled=settings?.publicHiringEnabled===true;
 const postings=enabled?await db.select({id:hrPostingsTable.id,title:hrPostingsTable.title,description:hrPostingsTable.description,fields:hrPostingsTable.fields}).from(hrPostingsTable)
 .where(and(eq(hrPostingsTable.tenantId,tenant.id),eq(hrPostingsTable.status,"open"))):[];
 res.set("Cache-Control","no-store").json({businessName:tenant.name,enabled,applicationIntro:enabled?settings?.applicationIntro:"",privacyNotice:enabled?settings?.privacyNotice:"",
 fields:enabled?settings?.applicationFields:[],postings});
});
router.post("/careers/:slug/applications",async(req,res,next)=>{
 const now=Date.now(),key=`${req.ip}:${req.params.slug}`,previous=attempts.get(key);
 if(previous&&previous.until>now){if(previous.count>=10){res.status(429).json({error:"Too many submissions. Please try again later."});return;}previous.count++;}
 else attempts.set(key,{count:1,until:now+3600000});
 if(attempts.size>10000)for(const [key,item] of attempts)if(item.until<now)attempts.delete(key);
 const tenant=await companyCareers(String(req.params.slug));
 const [settings]=await db.select({enabled:hrSettingsTable.publicHiringEnabled}).from(hrSettingsTable).where(eq(hrSettingsTable.tenantId,tenant.id));
 if(!settings?.enabled)throw new HrError("This business is not accepting online applications",403);
 res.locals.careersTenant=tenant.id;next();
},hrUpload.single("resume"),async(req,res)=>{
 let input:Record<string,unknown>;
 try{input=JSON.parse(String(req.body.application));if(!input||typeof input!=="object"||Array.isArray(input))throw new Error();}catch{throw new HrError("Provide a valid application");}
 if(typeof input.requestId!=="string")throw new HrError("A submission reference is required");
 const form=await getWebsiteForm(res.locals.careersTenant,'hiring');
 if(form.published)throw new HrError('This application form has changed. Open the careers page without ?legacy=1 to use the current questions.',409);
 const config=await publicWebsiteConfig('hiring',res.locals.careersTenant);
 const previous=input.answers&&typeof input.answers==='object'?input.answers as Record<string,unknown>:{};
 const answers:Record<string,unknown>={name:input.fullName,email:input.email,phone:input.phone,postingId:input.postingId==null?'':String(input.postingId)};
 for(const [key,value]of Object.entries(previous)){answers[`q_${key.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,40)}`]=value;answers[`p${input.postingId}_q_${key.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,40)}`]=value;}
 const receipt=await receiveWebsiteSubmission({tenantId:res.locals.careersTenant,kind:'hiring',requestId:input.requestId,revision:config.revision,answers,measurements:{},consent:input.consent},req.file);
 res.status(201).json({success:true,reference:receipt.reference,message:"Your application has been received. The business will contact you about hiring."});
});
router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
 if(error instanceof HrError||error instanceof FormError){res.status(error.status).json({error:error.message});return;}
 if(error instanceof multer.MulterError){res.status(413).json({error:"Upload one resume of at most 10 MB"});return;}next(error);
});
export default router;
