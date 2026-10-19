import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

const holder = vi.hoisted(() => ({ connection: null as any }));
vi.mock('@workspace/db', async importOriginal => {
  const original = await importOriginal<typeof import('@workspace/db')>();
  return { ...original, db: new Proxy(original.db, { get(target, key) {
    const current = holder.connection ?? target, value = current[key];
    return typeof value === 'function' ? value.bind(current) : value;
  } }) };
});
import { db, pool, tenantsTable, usersTable, staffSessionsTable } from '@workspace/db';
import router from './auth';

describe('Remembered staff devices (rollback-only PostgreSQL)', () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>;
  let tenant: number, owner: number;
  const token = 'rollback-only-remembered-phone-session';
  const secondToken = 'rollback-only-second-device-session';
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const app = express(); app.use(express.json()); app.use(router);
  const remember = (credential = token) => request(app).post('/auth/remember-device').set('Authorization', `Bearer ${credential}`);
  beforeAll(async () => {
    client = await connect(); await client.query('BEGIN'); holder.connection = drizzle(client);
    tenant = (await db.insert(tenantsTable).values({ name: 'Rollback phone-session fixture' }).returning())[0].id;
    owner = (await db.insert(usersTable).values({
      tenantId: tenant, name: 'Rollback phone owner', role: 'company_owner', email: `phone-${tenant}@session.invalid`, passwordHash: 'mock',
    }).returning())[0].id;
  });
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM staff_sessions WHERE tenant_id=${tenant}`);
    await db.execute(sql`UPDATE users SET is_active=true WHERE id=${owner}`);
    await db.insert(staffSessionsTable).values([token, secondToken].map(value => ({
      tenantId: tenant, userId: owner, tokenHash: hash(value), expiresAt: new Date(Date.now() + 30 * 86400000),
    })));
  });
  afterAll(async () => {
    if (client) { try { await client.query('ROLLBACK'); } finally { holder.connection = null; client.release(); await pool.end(); } }
  });
  it('requires a real authenticated session, not identity headers', async () => {
    expect((await request(app).post('/auth/remember-device').set('x-user-id', String(owner)).set('x-tenant-id', String(tenant))).status).toBe(401);
    expect((await remember('invalid-device-token')).status).toBe(401);
  });
  it('remembers a valid phone without storing a password or issuing a different identity', async () => {
    expect((await remember()).body).toEqual({ remembered: true });
    const rows = await db.execute(sql`SELECT token_hash, expires_at FROM staff_sessions WHERE token_hash=${hash(token)}`);
    expect(new Date(rows.rows[0].expires_at as string).getUTCFullYear()).toBe(9999);
    expect(rows.rows[0].token_hash).toBe(hash(token));
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200); expect(me.body).toMatchObject({ id: owner, tenantId: tenant });
  });
  it('does not extend another device or ordinary web session', async () => {
    await remember();
    const rows = await db.execute(sql`SELECT expires_at FROM staff_sessions WHERE token_hash=${hash(secondToken)}`);
    expect(new Date(rows.rows[0].expires_at as string).getTime()).toBeLessThan(Date.now() + 31 * 86400000);
  });
  it('is idempotent and keeps only the existing session on repeated phone unlocks', async () => {
    expect((await remember()).status).toBe(200); expect((await remember()).status).toBe(200);
    const rows = await db.execute(sql`SELECT count(*)::int AS total FROM staff_sessions WHERE tenant_id=${tenant}`);
    expect(rows.rows[0].total).toBe(2);
  });
  it('cannot revive an expired session', async () => {
    await db.execute(sql`UPDATE staff_sessions SET expires_at=now()-interval '1 day' WHERE token_hash=${hash(token)}`);
    expect((await remember()).status).toBe(401);
  });
  it('cannot revive a revoked session', async () => {
    await db.execute(sql`DELETE FROM staff_sessions WHERE token_hash=${hash(token)}`);
    expect((await remember()).status).toBe(401);
  });
  it('does not remember or authenticate a deactivated staff account', async () => {
    await db.execute(sql`UPDATE users SET is_active=false WHERE id=${owner}`);
    expect((await remember()).status).toBe(401);
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email: `phone-${tenant}@session.invalid`, password: 'unused-fixture-value' })).status).toBe(401);
  });
  it('sign-out revokes even a remembered session', async () => {
    await remember();
    expect((await request(app).post('/auth/logout').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await remember()).status).toBe(401);
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${secondToken}`)).status).toBe(200);
  });
});
