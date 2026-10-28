/** Development-only account for checking device preference UI, never real staff. */
import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { db, pool, usersTable, staffSessionsTable } from '@workspace/db';
import { and, eq } from 'drizzle-orm';

const file = '/tmp/device-preference-qa.json';
const id = 337, tenantId = 276;
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Development only');
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, id), eq(usersTable.tenantId, tenantId)));
  if (!user || !/^launch-qa-.*@example\.invalid$/.test(user.email)) throw new Error('Synthetic account guard failed');
  if (process.argv.includes('verify')) {
    const fixture = JSON.parse(readFileSync(file, 'utf8'));
    const matches = await bcrypt.compare(fixture.password, user.passwordHash ?? '');
    const response = await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fixture.email, password: fixture.password }),
    });
    console.log(JSON.stringify({ active: user.isActive, hashMatches: matches, developmentLoginStatus: response.status }));
    return;
  }
  if (process.argv.includes('cleanup')) {
    const fixture = JSON.parse(readFileSync(file, 'utf8'));
    if (fixture.email !== user.email || fixture.id !== id) throw new Error('Fixture identity mismatch');
    await db.update(usersTable).set({ isActive: false, passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10) }).where(eq(usersTable.id, id));
    await db.update(staffSessionsTable).set({ expiresAt: new Date(0) }).where(eq(staffSessionsTable.userId, id));
    unlinkSync(file);
    console.log('Synthetic account deactivated; sessions expired; private fixture removed.');
    return;
  }
  const password = randomBytes(24).toString('base64url');
  writeFileSync(file, JSON.stringify({ id, tenantId, email: user.email, password }), { mode: 0o600 });
  await db.update(usersTable).set({ isActive: true, passwordHash: await bcrypt.hash(password, 10) }).where(eq(usersTable.id, id));
  console.log('Private device-preference UI fixture ready.');
}
main().catch(() => { console.error('Synthetic fixture operation failed.'); process.exitCode = 1; }).finally(() => pool.end());
