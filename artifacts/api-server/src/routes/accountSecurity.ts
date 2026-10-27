import { Router } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { and,eq,gt,sql } from "drizzle-orm";
import { db,accountSecurityTable,usersTable,tenantsTable,staffSessionsTable } from "@workspace/db";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { getUserId } from "../lib/tenantHelper";
import { getPresentedStaffToken } from "./auth";
import { base32,sealSecret,openSecret,matchedStep,recoveryCodes,recoveryDigest,tokenDigest,verifySecondFactor,revokeOtherSessions,authBlocked,authFailure } from "../lib/accountSecurity";
import { sendEmail } from "../lib/emailProvider";
import { audit } from "../lib/softwareBilling";
import { recordOperationsAlert } from "../lib/experienceCore";

export const publicAccountSecurityRouter=Router();
const router=Router();
router.use("/account-security",requireVerifiedStaff);
router.get("/account-security",async(req,res)=>{
  const [row]=await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,getUserId(req)));
  res.set("Cache-Control","no-store").json({enabled:row?.enabled??false,recoveryCodesRemaining:Array.isArray(row?.recoveryHashes)?row.recoveryHashes.length:0});
});
router.post("/account-security",async(req,res)=>{
  const parsed=z.object({action:z.enum(["enroll","confirm","disable","recoveryCodes"]),password:z.string().min(1).max(256),code:z.string().max(80).optional()}).strict().safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Invalid security request"});return;}
  const userId=getUserId(req),input=parsed.data;
  const [user]=await db.select().from(usersTable).where(eq(usersTable.id,userId));
  if(await authBlocked(userId)||!user||user.passwordHash==="mock"||!await bcrypt.compare(input.password,user.passwordHash)){if(user)await authFailure(userId);res.status(403).json({error:"Password could not be verified. Too many attempts temporarily block changes."});return;}
  res.set("Cache-Control","no-store");
  await db.insert(accountSecurityTable).values({userId}).onConflictDoNothing();
  if(input.action==="enroll"){
    const [row]=await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,userId));
    if(row.enabled){res.status(409).json({error:"Authenticator already enabled"});return;}
    const secret=base32(randomBytes(20));
    await db.update(accountSecurityTable).set({pendingSecret:sealSecret(secret),pendingExpires:new Date(Date.now()+10*60000)}).where(and(eq(accountSecurityTable.userId,userId),eq(accountSecurityTable.enabled,false)));
    res.json({secret,otpauthUrl:`otpauth://totp/${encodeURIComponent("Divine Edge OS:"+user.email)}?secret=${secret}&issuer=Divine%20Edge%20OS&algorithm=SHA1&digits=6&period=30`});return;
  }
  if(input.action==="confirm"){
    const result=await db.transaction(async tx=>{
      const [row]=await tx.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,userId)).for("update");
      if(row.enabled||!row.pendingSecret||!row.pendingExpires||row.pendingExpires<new Date())return null;
      const secret=openSecret(row.pendingSecret),step=matchedStep(secret,input.code??"",null);
      if(step===null)return null;
      const codes=recoveryCodes();
      await tx.update(accountSecurityTable).set({enabled:true,encryptedSecret:row.pendingSecret,pendingSecret:null,pendingExpires:null,lastStep:step,recoveryHashes:codes.map(recoveryDigest),failures:0,blockedUntil:null}).where(eq(accountSecurityTable.userId,userId));
      return codes;
    });
    if(!result){await authFailure(userId);res.status(400).json({error:"Invalid or expired setup code"});return;}
    await revokeOtherSessions(userId,tokenDigest(getPresentedStaffToken(req)??""));
    await audit(userId,"authenticator_enabled",{});
    res.json({enabled:true,recoveryCodes:result});return;
  }
  const [security]=await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,userId));
  if(!security.enabled||await verifySecondFactor(userId,input.code)!=="ok"){res.status(403).json({error:"A current authenticator code or unused recovery code is required"});return;}
  if(input.action==="disable"){
    await db.update(accountSecurityTable).set({enabled:false,encryptedSecret:null,pendingSecret:null,pendingExpires:null,recoveryHashes:[],lastStep:null}).where(eq(accountSecurityTable.userId,userId));
    await audit(userId,"authenticator_disabled",{});res.json({enabled:false});return;
  }
  const codes=recoveryCodes();await db.update(accountSecurityTable).set({recoveryHashes:codes.map(recoveryDigest)}).where(eq(accountSecurityTable.userId,userId));
  await audit(userId,"recovery_codes_regenerated",{});res.json({enabled:true,recoveryCodes:codes});
});
publicAccountSecurityRouter.post("/auth/password-reset/request",async(req,res)=>{
  const input=z.object({email:z.string().email().max(254)}).strict().safeParse(req.body);
  const generic={message:"If this account can receive recovery email, a reset code will be sent. Check your inbox and spam folder."};
  if(!input.success){res.json(generic);return;}
  const [user]=await db.select().from(usersTable).where(and(sql`lower(${usersTable.email})=${input.data.email.toLowerCase()}`,eq(usersTable.isActive,true)));
  if(!user){res.json(generic);return;}
  const [tenant]=await db.select().from(tenantsTable).where(eq(tenantsTable.id,user.tenantId));
  if(!tenant?.emailProvider||!["smtp","sendgrid","mailgun","resend","gmail"].includes(tenant.emailProvider)){await recordOperationsAlert(`recovery-email-${user.tenantId}`,user.tenantId,"account_recovery","high","Password recovery needs a configured company email provider.");res.json(generic);return;}
  await db.insert(accountSecurityTable).values({userId:user.id}).onConflictDoNothing();
  const [current]=await db.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,user.id));
  if(current.resetExpires&&current.resetExpires>new Date(Date.now()+14*60000)){res.json(generic);return;}
  const token=randomBytes(24).toString("base64url"),hash=tokenDigest(token);
  const reserved=await db.update(accountSecurityTable).set({resetHash:hash,resetExpires:new Date(Date.now()+15*60000)}).where(and(eq(accountSecurityTable.userId,user.id),sql`(${accountSecurityTable.resetExpires} IS NULL OR ${accountSecurityTable.resetExpires}<now()+interval '14 minutes')`)).returning({userId:accountSecurityTable.userId});
  if(!reserved.length){res.json(generic);return;}
  try{
    // A code, not a caller-controlled Origin URL, prevents reset-link poisoning.
    const sent=await sendEmail({provider:tenant.emailProvider as Parameters<typeof sendEmail>[0]["provider"],config:(tenant.emailProviderConfig??{}) as Record<string,string>,fromAddress:null},user.email,"Reset your Divine Edge OS password",`Use the password reset page in your app and paste this reset code:\n\n${token}\n\nThis code expires in 15 minutes and can be used once. If you did not request this, ignore this message. Authenticator protection is not removed by resetting a password.`);
    if(!sent.success||sent.devOnly){await db.update(accountSecurityTable).set({resetHash:null,resetExpires:null}).where(and(eq(accountSecurityTable.userId,user.id),eq(accountSecurityTable.resetHash,hash)));await recordOperationsAlert(`recovery-email-${user.tenantId}`,user.tenantId,"account_recovery","high","A password recovery email was not delivered. Check the configured provider.");}
  }catch{await db.update(accountSecurityTable).set({resetHash:null,resetExpires:null}).where(and(eq(accountSecurityTable.userId,user.id),eq(accountSecurityTable.resetHash,hash)));await recordOperationsAlert(`recovery-email-${user.tenantId}`,user.tenantId,"account_recovery","high","A password recovery email failed. Check the configured provider.");}
  res.json(generic);
});
publicAccountSecurityRouter.post("/auth/password-reset/confirm",async(req,res)=>{
  const parsed=z.object({token:z.string().min(24).max(200),password:z.string().min(12).max(256)}).strict().safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Enter the reset code and a password of at least 12 characters"});return;}
  const hash=tokenDigest(parsed.data.token.trim());
  const [validToken]=await db.select({userId:accountSecurityTable.userId}).from(accountSecurityTable).where(and(eq(accountSecurityTable.resetHash,hash),gt(accountSecurityTable.resetExpires,new Date())));
  if(!validToken){res.status(400).json({error:"Reset code is invalid or expired"});return;}
  const passwordHash=await bcrypt.hash(parsed.data.password,12);
  const changed=await db.transaction(async tx=>{
    const [row]=await tx.select().from(accountSecurityTable).where(and(eq(accountSecurityTable.resetHash,hash),gt(accountSecurityTable.resetExpires,new Date()))).for("update");
    if(!row)return false;
    await tx.update(usersTable).set({passwordHash}).where(and(eq(usersTable.id,row.userId),eq(usersTable.isActive,true)));
    await tx.update(accountSecurityTable).set({resetHash:null,resetExpires:null,failures:0,blockedUntil:null}).where(eq(accountSecurityTable.userId,row.userId));
    await tx.delete(staffSessionsTable).where(eq(staffSessionsTable.userId,row.userId));return true;
  });
  if(!changed){res.status(400).json({error:"Reset code is invalid or expired"});return;}
  res.json({success:true});
});
export default router;
