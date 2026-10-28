/** Temporary development-only access for verifying the software-plan editor. */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { db, pool, usersTable, platformOwnersTable, plansTable, softwareBillingAccountsTable, platformBillingSettingsTable } from '@workspace/db';
import { and, count, eq } from 'drizzle-orm';
import { SOFTWARE_FEATURE_CATALOG } from '../src/lib/softwareFeatures';

const results = '/tmp/software-plan-qa-results.json';
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Development only');
  const fixture = JSON.parse(readFileSync('/tmp/device-preference-qa.json', 'utf8'));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, fixture.id));
  if (!user || user.id !== 337 || user.tenantId !== 276 || user.email !== fixture.email || !/^launch-qa-.*@example\.invalid$/.test(user.email)) throw new Error('Synthetic identity guard failed');
  if (process.argv.includes('cleanup')) {
    const state = JSON.parse(readFileSync(results, 'utf8'));
    await db.transaction(async tx => {
      if(state.slotFixture){
        if(state.originalAccount){
          const restored={...state.originalAccount};
          for(const key of ['currentPeriodEnd','confirmedAt','connectStartedAt','termsAcceptedAt','checkoutStartedAt'])if(restored[key])restored[key]=new Date(restored[key]);
          await tx.update(softwareBillingAccountsTable).set(restored).where(eq(softwareBillingAccountsTable.tenantId,user.tenantId));
        }else await tx.delete(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,user.tenantId));
      }
      const plans = await tx.select().from(plansTable);
      for (const plan of plans.filter(p => p.tier === state.tierPrefix || p.tier === `${state.tierPrefix}_annual`)) {
        if (!plan.name.startsWith('QA annual UI') || plan.stripePriceId || plan.stripeProductId) throw new Error('Draft guard failed');
        const [account] = await tx.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.planId, plan.id));
        if (account) throw new Error('Plan is in use');
        await tx.delete(plansTable).where(eq(plansTable.id, plan.id));
      }
      if (state.grantCreated) await tx.delete(platformOwnersTable).where(eq(platformOwnersTable.userId, user.id));
    });
    unlinkSync(results);
    console.log('Temporary plan drafts and test-only grant removed.');
    return;
  }
  const [grant] = await db.select().from(platformOwnersTable).where(eq(platformOwnersTable.userId, user.id));
  const [originalAccount]=await db.select().from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId,user.tenantId));
  const [settings]=await db.select().from(platformBillingSettingsTable).where(eq(platformBillingSettingsTable.id,1));
  const slotFixture=process.argv.includes('slots');
  if(slotFixture && (settings?.enabled || originalAccount?.stripeSubscriptionId || originalAccount?.connectAccountId))throw new Error('Not safe to seed a paused synthetic subscription');
  const tierPrefix=`qa_annual_ui_${randomBytes(4).toString('hex')}`;
  writeFileSync(results, JSON.stringify({tierPrefix, grantCreated:!grant,slotFixture,originalAccount:originalAccount??null}), { mode: 0o600 });
  if (!grant) await db.insert(platformOwnersTable).values({ userId: user.id });
  if(slotFixture){
    const [usage]=await db.select({n:count()}).from(usersTable).where(and(eq(usersTable.tenantId,user.tenantId),eq(usersTable.isActive,true)));
    const values={status:'active',stripeSubscriptionId:`sub_${tierPrefix}`,stripeCustomerId:`cus_${tierPrefix}`,additionalUserSlots:2,
      planPolicy:{version:3,featureKeys:SOFTWARE_FEATURE_CATALOG.map(f=>f.key),userSlots:{includedUsers:Math.max(2,Number(usage.n)),extraUserPriceCents:500,basePriceCents:1000,interval:'month'}}};
    await db.insert(softwareBillingAccountsTable).values({tenantId:user.tenantId,...values}).onConflictDoUpdate({target:softwareBillingAccountsTable.tenantId,set:values});
  }
  console.log('Development plan-editor fixture ready.');
}
main().catch(() => { console.error('Synthetic plan fixture failed.'); process.exitCode = 1; }).finally(() => pool.end());
