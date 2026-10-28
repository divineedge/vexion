/** Temporary development-only access for verifying the software-plan editor. */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { db, pool, usersTable, platformOwnersTable, plansTable, softwareBillingAccountsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';

const results = '/tmp/software-plan-qa-results.json';
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Development only');
  const fixture = JSON.parse(readFileSync('/tmp/device-preference-qa.json', 'utf8'));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, fixture.id));
  if (!user || user.id !== 337 || user.tenantId !== 276 || user.email !== fixture.email || !/^launch-qa-.*@example\.invalid$/.test(user.email)) throw new Error('Synthetic identity guard failed');
  if (process.argv.includes('cleanup')) {
    const state = JSON.parse(readFileSync(results, 'utf8'));
    await db.transaction(async tx => {
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
  writeFileSync(results, JSON.stringify({ tierPrefix: `qa_annual_ui_${randomBytes(4).toString('hex')}`, grantCreated: !grant }), { mode: 0o600 });
  if (!grant) await db.insert(platformOwnersTable).values({ userId: user.id });
  console.log('Development plan-editor fixture ready.');
}
main().catch(() => { console.error('Synthetic plan fixture failed.'); process.exitCode = 1; }).finally(() => pool.end());
