import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

// One connection and one rollback-only transaction; no business fixtures survive.
const holder = vi.hoisted(() => ({ connection: null as any }));
vi.mock('@workspace/db', async importOriginal => {
  const original = await importOriginal<typeof import('@workspace/db')>();
  return { ...original, db: new Proxy(original.db, { get(target, key) {
    const current = holder.connection ?? target, value = current[key];
    return typeof value === 'function' ? value.bind(current) : value;
  } }) };
});
import { db, pool, tenantsTable, usersTable, vendorsTable, expenseEntriesTable } from '@workspace/db';
import { installVendorExpenseDefaultsSchema, vendorExpenseDefaultsPatchSchema } from '../lib/vendorExpenseDefaults';
import router from './vendorExpenseDefaults';

describe('Vendor expense defaults (rollback-only PostgreSQL)', () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>;
  let tenant: number, other: number, owner: number, otherOwner: number, tech: number, vendor: number, foreignVendor: number, oldExpense: number;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      verifiedTenantId: req.headers['x-qa-other'] ? other : tenant,
      verifiedUserId: req.headers['x-qa-other'] ? otherOwner : req.headers['x-qa-tech'] ? tech : owner,
    }); next();
  });
  app.use(router);
  const endpoint = '/vendor-expense-defaults';
  const patch = (scope: string | number, body: object) => request(app).patch(`${endpoint}/${scope}`).send(body);
  const get = () => request(app).get(endpoint);
  const full = { salesTaxPct: 8.375, shippingAmount: 29.95, capitalizeSalesTax: true, capitalizeShipping: true };
  beforeAll(async () => {
    client = await pool.connect(); await client.query('BEGIN'); holder.connection = drizzle(client);
    await installVendorExpenseDefaultsSchema();
    tenant = (await db.insert(tenantsTable).values({ name: 'Rollback vendor defaults fixture' }).returning())[0].id;
    other = (await db.insert(tenantsTable).values({ name: 'Rollback isolated vendor defaults fixture' }).returning())[0].id;
    const addUser = async (tenantId: number, role: string) => (await db.insert(usersTable).values({
      tenantId, role, name: 'Rollback defaults test', email: `${tenantId}-${role}@vendor-defaults.invalid`,
    }).returning())[0].id;
    owner = await addUser(tenant, 'company_owner'); tech = await addUser(tenant, 'technician');
    otherOwner = await addUser(other, 'company_owner');
    vendor = (await db.insert(vendorsTable).values({ tenantId: tenant, name: 'Rollback supply vendor' }).returning())[0].id;
    foreignVendor = (await db.insert(vendorsTable).values({ tenantId: other, name: 'Rollback other vendor' }).returning())[0].id;
    oldExpense = (await db.insert(expenseEntriesTable).values({
      tenantId: tenant, vendorId: vendor, date: '2026-10-01', amount: 110, subtotal: 100,
      salesTaxPct: 5, salesTaxAmount: 5, shippingAmount: 5, capitalizeShipping: false, capitalizeSalesTax: false,
    }).returning())[0].id;
  });
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM vendor_expense_defaults WHERE tenant_id IN (${tenant}, ${other})`);
  });
  afterAll(async () => {
    if (client) { try { await client.query('ROLLBACK'); } finally { holder.connection = null; client.release(); await pool.end(); } }
  });
  it('starts with legacy zero/false values and no vendor overrides', async () => {
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ company: { salesTaxPct: 0, shippingAmount: 0, capitalizeSalesTax: false, capitalizeShipping: false }, vendors: [] });
  });
  it('persists all four company defaults and precise delivery cents across reload', async () => {
    expect((await patch('company', full)).status).toBe(200);
    expect((await get()).body.company).toEqual(full);
  });
  it('merges partial autosave updates, including explicit zero and false', async () => {
    await patch('company', full);
    expect((await patch('company', { shippingAmount: 0, capitalizeShipping: false })).body.company)
      .toEqual({ ...full, shippingAmount: 0, capitalizeShipping: false });
  });
  it('keeps independently updated company fields without lost writes', async () => {
    await patch('company', full);
    await Promise.all([patch('company', { salesTaxPct: 6.25 }), patch('company', { shippingAmount: 12.49 })]);
    expect((await get()).body.company).toEqual({ ...full, salesTaxPct: 6.25, shippingAmount: 12.49 });
  });
  it('stores vendor zero/false overrides, while blank fields inherit', async () => {
    await patch('company', full);
    const result = await patch(vendor, { salesTaxPct: 0, capitalizeShipping: false });
    expect(result.status).toBe(200);
    expect(result.body.vendors).toEqual([{ vendorId: vendor, settings: {
      salesTaxPct: 0, shippingAmount: null, capitalizeSalesTax: null, capitalizeShipping: false,
    } }]);
    expect((await patch(vendor, { salesTaxPct: null })).body.vendors[0].settings.salesTaxPct).toBeNull();
    expect((await get()).body.company).toEqual(full);
  });
  it('does not expose or mutate another company’s overrides', async () => {
    await patch('company', full); await patch(vendor, { salesTaxPct: 0 });
    const foreign = await request(app).get(endpoint).set('x-qa-other', 'true');
    expect(foreign.status).toBe(200); expect(foreign.body.vendors).toEqual([]);
    expect(foreign.body.company.salesTaxPct).toBe(0);
    expect((await patch(foreignVendor, { shippingAmount: 100 })).status).toBe(404);
    expect((await patch(2147483647, { shippingAmount: 100 })).status).toBe(404);
  });
  it('blocks technicians from reading or writing financial defaults', async () => {
    expect((await request(app).get(endpoint).set('x-qa-tech', 'true')).status).toBe(403);
    expect((await request(app).patch(`${endpoint}/company`).set('x-qa-tech', 'true').send(full)).status).toBe(403);
  });
  it.each([
    {}, { salesTaxPct: -1 }, { salesTaxPct: 101 }, { shippingAmount: -0.01 },
    { capitalizeShipping: 'true' }, { salesTaxPct: '8.25' }, { unknown: true },
    { tenantId: 1, salesTaxPct: 4 }, { shippingAmount: 1_000_000_001 }, { salesTaxPct: null },
  ])('rejects invalid company defaults without writing: %j', async body => {
    expect((await patch('company', body)).status).toBe(400);
    expect((await get()).body.company.salesTaxPct).toBe(0);
  });
  it.each(['0', '-1', 'nonsense', '2147483648', '9007199254740992'])('rejects invalid scope %s', async scope => {
    expect((await patch(scope, { salesTaxPct: 5 })).status).toBe(400);
  });
  it('rejects nonfinite values before persistence', () => {
    expect(vendorExpenseDefaultsPatchSchema.safeParse({ salesTaxPct: NaN }).success).toBe(false);
    expect(vendorExpenseDefaultsPatchSchema.safeParse({ shippingAmount: Infinity }).success).toBe(false);
  });
  it('does not rewrite previous expense costs when defaults change', async () => {
    const before = await db.execute(sql`SELECT * FROM expense_entries WHERE id=${oldExpense}`);
    await patch('company', full); await patch(vendor, { salesTaxPct: 0, shippingAmount: 0 });
    const after = await db.execute(sql`SELECT * FROM expense_entries WHERE id=${oldExpense}`);
    expect(after.rows).toEqual(before.rows);
  });
});
