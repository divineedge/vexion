import { db,subTimersTable,timeEntriesTable,visitsTable } from "@workspace/db";
import { and,eq,isNull,sql } from "drizzle-orm";
type Handle=typeof db|Parameters<Parameters<typeof db.transaction>[0]>[0];
type Position={lat:number|null;lng:number|null};
export async function readVisitClock(tenantId:number,userId:number,visitId:number,handle:Handle=db){
 const [entry]=await handle.select().from(subTimersTable).where(and(eq(subTimersTable.tenantId,tenantId),eq(subTimersTable.userId,userId),eq(subTimersTable.visitId,visitId),eq(subTimersTable.isActive,true))).limit(1);
 return {active:!!entry,entryId:entry?.id??null,clockedInAt:entry?.startedAt.toISOString()??null};
}
export async function startVisitClock(tenantId:number,userId:number,visitId:number,handle:Handle=db,position:Position={lat:null,lng:null}){
 return handle.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},${userId})`);
  const [visit]=await tx.select().from(visitsTable).where(and(eq(visitsTable.id,visitId),eq(visitsTable.tenantId,tenantId))).for("update");
  if(!visit)throw Object.assign(new Error("Visit not found"),{status:404});
  if(visit.completedAt)throw Object.assign(new Error("This visit is already completed"),{status:409});
  const [active]=await tx.select().from(subTimersTable).where(and(eq(subTimersTable.tenantId,tenantId),eq(subTimersTable.userId,userId),eq(subTimersTable.isActive,true))).for("update");
  if(active?.visitId===visitId)return readVisitClock(tenantId,userId,visitId,tx);
  if(active)throw Object.assign(new Error("Stop your current activity before starting this visit"),{status:409});
  const now=new Date();
  const [master]=await tx.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.tenantId,tenantId),eq(timeEntriesTable.userId,userId),eq(timeEntriesTable.isMasterClock,true),isNull(timeEntriesTable.clockedOutAt))).for("update");
  if(!master)await tx.insert(timeEntriesTable).values({tenantId,userId,isMasterClock:true,clockedInAt:now,clockInLat:position.lat,clockInLng:position.lng});
  await tx.insert(subTimersTable).values({tenantId,userId,visitId,type:"visit",label:`Visit: ${visit.purpose}`,startedAt:now,startLat:position.lat,startLng:position.lng});
  return readVisitClock(tenantId,userId,visitId,tx);
 });
}
export async function stopVisitClock(tenantId:number,userId:number,visitId:number,handle:Handle=db,position:Position={lat:null,lng:null}){
 return handle.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId},${userId})`);
  const [entry]=await tx.select().from(subTimersTable).where(and(eq(subTimersTable.tenantId,tenantId),eq(subTimersTable.userId,userId),eq(subTimersTable.visitId,visitId),eq(subTimersTable.isActive,true))).for("update");
  if(entry){const now=new Date();await tx.update(subTimersTable).set({isActive:false,stoppedAt:now,elapsedSeconds:Math.max(0,Math.floor((now.getTime()-entry.startedAt.getTime())/1000)),endLat:position.lat,endLng:position.lng}).where(eq(subTimersTable.id,entry.id));}
  return readVisitClock(tenantId,userId,visitId,tx);
 });
}
