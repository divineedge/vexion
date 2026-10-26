import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, pool, usersTable, platformOwnersTable, platformBillingAuditTable } from "@workspace/db";

// Trusted workspace operation only. Never expose an HTTP email-claim endpoint.
// Published instances may instead use the explicit PLATFORM_OWNER_USER_ID +
// PLATFORM_OWNER_TENANT_ID identity pair, configured by their trusted deployer.
async function main(){
  if(process.env.NODE_ENV==="production")throw new Error("Use trusted deployment identity configuration, not this development setup script, in production.");
  const email=process.argv[2]?.trim();
  if(!email?.includes("@"))throw new Error("Usage: tsx src/scripts/grantSoftwareOwner.ts <existing-sign-in-email>");
  const users=await db.select().from(usersTable).where(and(sql`lower(${usersTable.email})=lower(${email})`,eq(usersTable.isActive,true)));
  if(users.length!==1)throw new Error("Exactly one active account must already exist. Create/sign in to the account first; duplicate emails require identity review.");
  const user=users[0];
  if(!user.passwordHash || !/^\$2[aby]\$\d\d\$/.test(user.passwordHash))throw new Error("Set a real account password first. Demo/mock users cannot become software owners.");
  await db.transaction(async tx=>{
    await tx.insert(platformOwnersTable).values({userId:user.id}).onConflictDoNothing();
    await tx.insert(platformBillingAuditTable).values({id:randomUUID(),actorUserId:user.id,action:"software_owner_granted",details:{userId:user.id,tenantId:user.tenantId}});
  });
  process.stdout.write(`Software-owner access granted to user ${user.id} in company ${user.tenantId}.\n`);
}
main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;}).finally(()=>pool.end());
