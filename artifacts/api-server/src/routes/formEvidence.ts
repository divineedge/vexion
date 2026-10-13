import { Router } from "express";
import { db, formEvidenceTable } from "@workspace/db";
import { Readable } from "node:stream";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { evidenceFields, finalizeEvidence, readableEvidence, type EvidenceScope } from "../lib/formEvidence";
import { hrStorage } from "../lib/hrFiles";
import { FormError } from "../lib/jobForms";
const router=Router();
router.post("/form-evidence/uploads",async(req,res)=>{
 const tenantId=getTenantId(req),actorId=getUserId(req);
 const {scope,scopeId,employeeId,fieldId,fileName,mimeType}=req.body;
 if(!["job","assignment","employee"].includes(scope)||!Number.isSafeInteger(scopeId)||scopeId<1||(scope==="employee"&&(!Number.isSafeInteger(employeeId)||employeeId<1))||typeof fileName!=="string"||fileName.length>180||!["image/png","image/jpeg","image/webp"].includes(mimeType))throw new FormError("Choose a valid image and form");
 const target:EvidenceScope={scope,scopeId,...(scope==="employee"?{employeeId}:{})};
 const fields=await evidenceFields(tenantId,actorId,target);
 const field=fields.find(f=>f.id===fieldId&&["photo","signature"].includes(f.type));
 if(!field)throw new FormError("Choose a photo or signature question");
 const uploadURL=await hrStorage.getObjectEntityUploadURL(),uploadPath=hrStorage.normalizeObjectEntityPath(uploadURL);
 const [row]=await db.insert(formEvidenceTable).values({tenantId,actorId,...target,fieldId,label:field.label,kind:field.type,uploadPath,fileName,mimeType}).returning();
 res.status(201).json({evidenceId:row.id,uploadURL});
});
router.post("/form-evidence/:id/finalize",async(req,res)=>res.json(await finalizeEvidence(getTenantId(req),getUserId(req),Number(req.params.id))));
router.get("/form-evidence/:id",async(req,res)=>{
 const row=await readableEvidence(getTenantId(req),getUserId(req),Number(req.params.id));
 const file=await hrStorage.getObjectEntityFile(row.objectPath!);
 res.set({"Content-Type":row.mimeType,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":`inline; filename="evidence-${row.id}"`});
 Readable.from(file.createReadStream()).pipe(res);
});
router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
 if(error instanceof FormError){res.status(error.status).json({error:error.message});return;}next(error);
});
export default router;
