import { db,usersTable,hrAccessTable,hrAuditTable } from "@workspace/db";
import { and,eq } from "drizzle-orm";
export type HrDb=typeof db|Parameters<Parameters<typeof db.transaction>[0]>[0];
export class HrError extends Error{constructor(message:string,public status=400){super(message);}}
export async function hrAccess(tenantId:number,userId:number,handle:HrDb=db){
 const [user]=await handle.select({role:usersTable.role,isActive:usersTable.isActive}).from(usersTable).where(and(eq(usersTable.tenantId,tenantId),eq(usersTable.id,userId)));
 if(!user||user.isActive===false)return {hasHrAccess:false,isOwner:false};
 const isOwner=user.role==="company_owner";
 const [grant]=isOwner?[]:await handle.select({id:hrAccessTable.id}).from(hrAccessTable).where(and(eq(hrAccessTable.tenantId,tenantId),eq(hrAccessTable.userId,userId)));
 return {isOwner,hasHrAccess:isOwner||!!grant};
}
export async function requireHr(tenantId:number,userId:number,handle:HrDb=db){if(!(await hrAccess(tenantId,userId,handle)).hasHrAccess)throw new HrError("Private HR records require owner or designated HR access",403);}
export async function requireOwnerHr(tenantId:number,userId:number,handle:HrDb=db){if(!(await hrAccess(tenantId,userId,handle)).isOwner)throw new HrError("Only the business owner can change HR access",403);}
export function hrAudit(handle:HrDb,tenantId:number,actorId:number|null,action:string,employeeId:number|null=null,applicationId:number|null=null,before:unknown=null,after:unknown=null){
 return handle.insert(hrAuditTable).values({tenantId,actorId,action,employeeId,applicationId,before,after});
}
export function calendarDate(value:unknown,optional=true):string|null{
 if((value==null||value==="")&&optional)return null;
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+"T12:00:00Z"))||new Date(value+"T12:00:00Z").toISOString().slice(0,10)!==value)throw new HrError("Choose a valid calendar date");
 return value;
}
export function boundedText(value:unknown,label:string,max=1000,required=false):string{
 if(value==null&&!required)return "";
 if(typeof value!=="string"||value.trim().length>max||(required&&!value.trim()))throw new HrError(`${label} is required and must be at most ${max} characters`);
 return value.trim();
}
