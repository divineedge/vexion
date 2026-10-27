import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and,eq } from "drizzle-orm";
import { db,reviewRequestsTable,reviewPhotosTable,usersTable } from "@workspace/db";
import { getTenantId,getUserId } from "../lib/tenantHelper";
import { imageMultipart,storePrivateImage,streamPrivateImage } from "../lib/supportImages";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { ADMIN_ROLES } from "../lib/roles";

export const publicReviewPhotosRouter=Router();
const router=Router();
publicReviewPhotosRouter.post("/public/reviews/:token/photos",async(req,res,next)=>{
  const [review]=await db.select({createdAt:reviewRequestsTable.createdAt}).from(reviewRequestsTable).where(eq(reviewRequestsTable.token,String(req.params.token)));
  if(!review||review.createdAt<new Date(Date.now()-30*86400000)){res.status(410).json({error:"This feedback upload link is invalid or expired"});return;}
  next();
},imageMultipart,async(req,res)=>{
  if(!req.file){res.status(400).json({error:"Image required"});res.locals.releaseImageUpload?.();return;}
  try{
    const result=await db.transaction(async tx=>{
      const [review]=await tx.select().from(reviewRequestsTable).where(eq(reviewRequestsTable.token,String(req.params.token))).for("update");
      if(!review||review.createdAt<new Date(Date.now()-30*86400000))throw Object.assign(new Error("This feedback upload link is invalid or expired"),{status:410});
      const photos=await tx.select({id:reviewPhotosTable.id}).from(reviewPhotosTable).where(eq(reviewPhotosTable.reviewId,review.id));
      if(photos.length>=3)throw Object.assign(new Error("You can attach at most three photos"),{status:400});
      const image=await storePrivateImage(req.file!);const id=randomUUID();
      await tx.insert(reviewPhotosTable).values({id,reviewId:review.id,tenantId:review.tenantId,objectPath:image.objectPath,name:image.name,contentType:image.contentType});
      return {id,name:image.name};
    });res.json(result);
  }catch(error){res.status((error as {status?:number}).status??503).json({error:(error as {status?:number}).status?(error as Error).message:"Unable to store photo. Please retry."});}
  finally{res.locals.releaseImageUpload?.();}
});
publicReviewPhotosRouter.get("/public/reviews/:token/photos/:id",async(req,res)=>{
  const [review]=await db.select().from(reviewRequestsTable).where(eq(reviewRequestsTable.token,String(req.params.token)));
  if(!review){res.status(404).end();return;}
  const [photo]=await db.select().from(reviewPhotosTable).where(and(eq(reviewPhotosTable.reviewId,review.id),eq(reviewPhotosTable.id,String(req.params.id))));
  if(!photo){res.status(404).end();return;}try{await streamPrivateImage(photo.objectPath,res,photo.name);}catch{res.status(503).end();}
});
router.get("/reviews/:reviewId/photos/:id",requireVerifiedStaff,async(req,res)=>{
  const [user]=await db.select({role:usersTable.role}).from(usersTable).where(eq(usersTable.id,getUserId(req)));
  if(!user||!ADMIN_ROLES.has(user.role)){res.status(403).end();return;}
  const [photo]=await db.select().from(reviewPhotosTable).where(and(eq(reviewPhotosTable.id,String(req.params.id)),eq(reviewPhotosTable.reviewId,Number(req.params.reviewId)),eq(reviewPhotosTable.tenantId,getTenantId(req))));
  if(!photo){res.status(404).end();return;}try{await streamPrivateImage(photo.objectPath,res,photo.name);}catch{res.status(503).end();}
});
export default router;
