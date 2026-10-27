import { createHash,createHmac,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual } from "node:crypto";
import { and,eq,sql } from "drizzle-orm";
import { db,accountSecurityTable,staffSessionsTable } from "@workspace/db";

export const tokenDigest=(s:string)=>createHash("sha256").update(s).digest("hex");
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes:Buffer){let bits=0,value=0,out="";for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
function unbase32(s:string){let bits=0,value=0;const out:number[]=[];for(const c of s){const n=alphabet.indexOf(c);if(n<0)throw new Error("Invalid authenticator secret");value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export function totp(secret:string,step=Math.floor(Date.now()/30000)){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const h=createHmac("sha1",unbase32(secret)).update(counter).digest();const offset=h[19]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");}
function secretKey(){const seed=process.env.SESSION_SECRET;if(!seed||seed.length<16)throw new Error("Account security encryption is not configured");return createHash("sha256").update("divine-edge-authenticator-v1\0"+seed).digest();}
export function sealSecret(secret:string){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",secretKey(),iv);const data=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString("base64");}
export function openSecret(value:string){const raw=Buffer.from(value,"base64"),decipher=createDecipheriv("aes-256-gcm",secretKey(),raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString("utf8");}
export const recoveryDigest=(code:string)=>tokenDigest(code.replace(/[\s-]/g,"").toUpperCase());
export function recoveryCodes(){return Array.from({length:8},()=>randomBytes(10).toString("hex").toUpperCase());}
export function matchedStep(secret:string,code:string,lastStep:number|null,now=Date.now()){if(!/^\d{6}$/.test(code))return null;const current=Math.floor(now/30000);for(const step of [current,current-1,current+1]){if(step<=(lastStep??-1))continue;const expected=Buffer.from(totp(secret,step));if(timingSafeEqual(expected,Buffer.from(code)))return step;}return null;}
export async function authBlocked(userId:number){const [row]=await db.select({until:accountSecurityTable.blockedUntil}).from(accountSecurityTable).where(eq(accountSecurityTable.userId,userId));return !!row?.until&&row.until>new Date();}
export async function authFailure(userId:number){
  await db.insert(accountSecurityTable).values({userId,failures:1}).onConflictDoUpdate({target:accountSecurityTable.userId,set:{
    failures:sql`CASE WHEN ${accountSecurityTable.blockedUntil}<now() THEN 1 ELSE ${accountSecurityTable.failures}+1 END`,
    blockedUntil:sql`CASE WHEN ${accountSecurityTable.blockedUntil}<now() THEN NULL WHEN ${accountSecurityTable.failures}>=4 THEN now()+interval '15 minutes' ELSE ${accountSecurityTable.blockedUntil} END`,
  }});
}
/** A valid code is consumed under a row lock, including a one-use recovery code. */
export async function verifySecondFactor(userId:number,code:unknown):Promise<"ok"|"required"|"invalid">{
  await db.insert(accountSecurityTable).values({userId}).onConflictDoNothing();
  return db.transaction(async tx=>{
    const [row]=await tx.select().from(accountSecurityTable).where(eq(accountSecurityTable.userId,userId)).for("update");
    if(row.blockedUntil&&row.blockedUntil>new Date())return "invalid";
    if(!row.enabled){await tx.update(accountSecurityTable).set({failures:0,blockedUntil:null}).where(eq(accountSecurityTable.userId,userId));return "ok";}
    if(typeof code!=="string"||!code.trim())return "required";
    const hashes=Array.isArray(row.recoveryHashes)?row.recoveryHashes.filter((h):h is string=>typeof h==="string"):[];
    const hash=recoveryDigest(code),recovery=hashes.includes(hash);
    let step:number|null=null;
    if(!recovery&&row.encryptedSecret){try{step=matchedStep(openSecret(row.encryptedSecret),code,row.lastStep);}catch{/* A valid recovery code remains usable after an encryption-key change. */}}
    if(step===null&&!recovery){const failures=(row.blockedUntil&&row.blockedUntil<new Date()?0:row.failures)+1;await tx.update(accountSecurityTable).set({failures,blockedUntil:failures>=5?new Date(Date.now()+15*60000):null}).where(eq(accountSecurityTable.userId,userId));return "invalid";}
    await tx.update(accountSecurityTable).set({lastStep:step??row.lastStep,recoveryHashes:recovery?hashes.filter(h=>h!==hash):hashes,failures:0,blockedUntil:null}).where(eq(accountSecurityTable.userId,userId));
    return "ok";
  });
}
export async function revokeOtherSessions(userId:number,currentHash:string){await db.delete(staffSessionsTable).where(and(eq(staffSessionsTable.userId,userId),sql`${staffSessionsTable.tokenHash}<>${currentHash}`));}
