import multer from "multer";
import type { RequestHandler,Response } from "express";
import { randomUUID } from "node:crypto";
import { and,eq,sql,count,gt } from "drizzle-orm";
import { db,supportUploadsTable,supportMessagesTable,supportThreadsTable } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { getTenantId,getUserId } from "./tenantHelper";
import { isSoftwareOwner } from "./softwareBilling";

const storage=new ObjectStorageService();
let activeImageUploads=0;
export const imageMultipart:RequestHandler=(req,res,next)=>{
  if(activeImageUploads>=8){res.status(429).json({error:"Uploads are busy. Please retry shortly."});return;}
  activeImageUploads++;let released=false,processing=false;const release=()=>{if(!released){released=true;activeImageUploads--;}};res.locals.releaseImageUpload=release;
  res.once("finish",release);res.once("close",()=>{if(!processing)release();});
  multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2}}).single("file")(req,res,error=>{
    if(error){release();res.status(400).json({error:"Choose one PNG, JPEG, or WebP image no larger than 5 MiB"});return;}
    if(req.aborted||res.destroyed){release();return;}processing=true;next();
  });
};
export function imageType(buffer:Buffer){if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return "image/jpeg";if(buffer.length>=12&&buffer.toString("ascii",0,4)==="RIFF"&&buffer.toString("ascii",8,12)==="WEBP")return "image/webp";return null;}
export function privateImageName(original:string,contentType:string){
  const stem=original.replace(/[^a-zA-Z0-9 ._-]/g,"_").replace(/\.[^.]*$/,"").replace(/^\.+/,"").slice(0,90)||"image";
  return stem+(contentType==="image/png"?".png":contentType==="image/jpeg"?".jpg":".webp");
}
export async function storePrivateImage(file:Express.Multer.File){
  const contentType=imageType(file.buffer);if(!contentType||file.size>5*1024*1024)throw Object.assign(new Error("Only PNG, JPEG, and WebP images up to 5 MiB are accepted"),{status:400});
  const url=await storage.getObjectEntityUploadURL();
  const response=await fetch(url,{method:"PUT",headers:{"Content-Type":contentType},body:new Uint8Array(file.buffer),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error("Image storage unavailable");
  const objectPath=storage.normalizeObjectEntityPath(url);
  return {objectPath,contentType,name:privateImageName(file.originalname,contentType),size:file.size};
}
export async function streamPrivateImage(objectPath:string,res:Response,name:string){
  const file=await storage.getObjectEntityFile(objectPath);
  res.set({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Type":"application/octet-stream"}).attachment(name);
  file.createReadStream().on("error",()=>{if(!res.headersSent)res.status(503).end();else res.end();}).pipe(res);
}
export const privateImageUpload:RequestHandler[]=[imageMultipart,async(req,res)=>{
  if(!req.file){res.status(400).json({error:"Image file required"});res.locals.releaseImageUpload?.();return;}
  try{const saved=await db.transaction(async tx=>{
    const userId=getUserId(req),tenantId=getTenantId(req);await tx.execute(sql`SELECT pg_advisory_xact_lock(426982,${userId})`);
    const [recent]=await tx.select({n:count()}).from(supportUploadsTable).where(and(eq(supportUploadsTable.userId,userId),gt(supportUploadsTable.createdAt,new Date(Date.now()-86400000))));
    if(Number(recent.n)>=20)throw Object.assign(new Error("The daily limit is 20 support images. Please try again tomorrow."),{status:400});
    const image=await storePrivateImage(req.file!);const id=randomUUID();await tx.insert(supportUploadsTable).values({id,userId,tenantId,...image});return {id,name:image.name};
  });res.json(saved);}
  catch(error){res.status((error as {status?:number}).status??503).json({error:(error as {status?:number}).status===400?(error as Error).message:"Unable to store image. Retry later."});}
  finally{res.locals.releaseImageUpload?.();}
}];
export const downloadPrivateImage:RequestHandler=async(req,res)=>{
  const id=String(req.params.id),userId=getUserId(req),tenantId=getTenantId(req);
  const [upload]=await db.select().from(supportUploadsTable).where(eq(supportUploadsTable.id,id));
  if(!upload){res.status(404).end();return;}
  let allowed=upload.userId===userId&&upload.tenantId===tenantId;
  if(!allowed){
    // Admins may read an uploaded image only AFTER its owner attached it to a request.
    const linked=await db.select({thread:supportThreadsTable,internal:supportMessagesTable.internal}).from(supportMessagesTable).innerJoin(supportThreadsTable,eq(supportThreadsTable.id,supportMessagesTable.threadId)).where(sql`${supportMessagesTable.attachments} @> ${JSON.stringify([id])}::jsonb`);
    allowed=linked.some(r=>!r.internal&&r.thread.userId===userId&&r.thread.tenantId===tenantId)||linked.length>0&&await isSoftwareOwner(userId,tenantId);
  }
  if(!allowed){res.status(404).end();return;}
  try{await streamPrivateImage(upload.objectPath,res,upload.name);}catch{res.status(503).end();}
};
