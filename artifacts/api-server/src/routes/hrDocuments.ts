import { Router } from "express";
import multer from "multer";
import { db,usersTable,hrDocumentsTable,hrApplicationsTable,employeeHistoryEntriesTable } from "@workspace/db";
import { and,eq } from "drizzle-orm";
import { getTenantId,getUserId } from "../lib/tenantHelper";
import { requireHr,hrAccess,HrError,hrAudit,boundedText } from "../lib/hrAccess";
import { hrUpload,hrStorage,hrFile } from "../lib/hrFiles";
const router=Router();
for(const kind of ["employees","applications"] as const){
 router.post(`/hr/${kind}/:id/documents`,async(req,_res,next)=>{await requireHr(getTenantId(req),getUserId(req));next();},hrUpload.single("file"),async(req,res)=>{
  const tenantId=getTenantId(req),actorId=getUserId(req),targetId=Number(req.params.id);
  if(!Number.isSafeInteger(targetId)||targetId<1)throw new HrError("Invalid document target");
  const employeeId=kind==="employees"?targetId:null,applicationId=kind==="applications"?targetId:null;
  if(employeeId){
   const [employee]=await db.select({id:usersTable.id}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,employeeId)));
   if(!employee)throw new HrError("Employee not found",404);
  }else{
   const [application]=await db.select({id:hrApplicationsTable.id}).from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.id,applicationId!)));
   if(!application)throw new HrError("Application not found",404);
  }
  let historyEntryId:number|null=null;
  if(req.body.historyEntryId){
   historyEntryId=Number(req.body.historyEntryId);
   if(!employeeId||!Number.isSafeInteger(historyEntryId))throw new HrError("A document can only link to this employee's personnel record");
   const [entry]=await db.select({id:employeeHistoryEntriesTable.id}).from(employeeHistoryEntriesTable).where(and(eq(employeeHistoryEntriesTable.tenantId,tenantId),eq(employeeHistoryEntriesTable.userId,employeeId),eq(employeeHistoryEntriesTable.id,historyEntryId)));
   if(!entry)throw new HrError("Personnel record not found",404);
  }
  const info=hrFile(req.file),title=boundedText(req.body.title||info.fileName,"Document title",200,true);
  const objectPath=await hrStorage.saveHrDocument(req.file!.buffer,info.mimeType);
  try{
   const document=await db.transaction(async tx=>{
    const [document]=await tx.insert(hrDocumentsTable).values({tenantId,employeeId,applicationId,historyEntryId,title,...info,objectPath,
     sharedWithEmployee:employeeId!==null&&(req.body.sharedWithEmployee==="true"||req.body.sharedWithEmployee===true),uploadedBy:actorId}).returning();
    await hrAudit(tx,tenantId,actorId,"hr_document_uploaded",employeeId,applicationId,null,{documentId:document.id,title,fileName:info.fileName,sharedWithEmployee:document.sharedWithEmployee});
    return document;
   });
   const {objectPath:_,...publicMetadata}=document;res.status(201).json(publicMetadata);
  }catch(error){await hrStorage.deleteObjectEntity(objectPath).catch(()=>{});throw error;}
 });
}
router.post("/hr/documents/:id/share",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);await requireHr(tenantId,actorId);
 if(typeof req.body.sharedWithEmployee!=="boolean")throw new HrError("Choose whether to share this document");
 const document=await db.transaction(async tx=>{
  const [before]=await tx.select().from(hrDocumentsTable).where(and(eq(hrDocumentsTable.tenantId,tenantId),eq(hrDocumentsTable.id,Number(req.params.id)))).for("update");
  if(!before)throw new HrError("Document not found",404);
  let employeeId=before.employeeId;
  if(!employeeId&&before.applicationId){
   const [application]=await tx.select({userId:hrApplicationsTable.userId}).from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.id,before.applicationId)));
   employeeId=application?.userId??null;
  }
  if(!employeeId)throw new HrError("Only a document linked to an employee can be shared");
  const [after]=await tx.update(hrDocumentsTable).set({sharedWithEmployee:req.body.sharedWithEmployee}).where(eq(hrDocumentsTable.id,before.id)).returning();
  await hrAudit(tx,tenantId,actorId,"hr_document_sharing_changed",employeeId,before.applicationId,{shared:before.sharedWithEmployee},{documentId:before.id,shared:after.sharedWithEmployee});
  const {objectPath:_,...metadata}=after;return metadata;
 });res.json(document);
});
router.get("/hr/documents/:id/download",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req),access=await hrAccess(tenantId,actorId);
 const [document]=await db.select().from(hrDocumentsTable).where(and(eq(hrDocumentsTable.tenantId,tenantId),eq(hrDocumentsTable.id,Number(req.params.id))));
 if(!document)throw new HrError("Document not found",404);
 let employeeId=document.employeeId;
 if(!employeeId&&document.applicationId){
  const [application]=await db.select({userId:hrApplicationsTable.userId}).from(hrApplicationsTable).where(and(eq(hrApplicationsTable.tenantId,tenantId),eq(hrApplicationsTable.id,document.applicationId)));
  employeeId=application?.userId??null;
 }
 if(!access.hasHrAccess&&!(document.sharedWithEmployee&&employeeId===actorId))throw new HrError("This document has not been shared with you",403);
 const file=await hrStorage.getObjectEntityFile(document.objectPath);
 await hrAudit(db,tenantId,actorId,"hr_document_downloaded",employeeId,document.applicationId,null,{documentId:document.id});
 res.set({"Content-Type":document.mimeType,"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
 "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Length":String(document.sizeBytes)});
 file.createReadStream().on("error",()=>{if(!res.headersSent)res.status(502).json({error:"Unable to download the private document"});else res.destroy();}).pipe(res);
});
router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
 if(error instanceof multer.MulterError){res.status(error.code==="LIMIT_FILE_SIZE"?413:400).json({error:"Upload one document of at most 10 MB"});return;}next(error);
});
export default router;
