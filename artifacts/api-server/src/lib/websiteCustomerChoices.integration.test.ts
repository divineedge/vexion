import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  db, tenantsTable, usersTable, customersTable, propertiesTable, estimatesTable, websiteIntakeSubmissionsTable,
} from '@workspace/db';
import { websiteCustomerChoices } from './websiteCustomerChoices';
import { reviewInput, reviewWebsiteSubmission } from './websiteIntake';
import { defaultWebsiteFlow } from './websiteFlow';
import type { HrDb } from './hrAccess';

/** All fixtures and mutations roll back, including on assertion failure. */
async function fixture(run: (f: Awaited<ReturnType<typeof seed>>, tx: HrDb) => Promise<void>) {
  const rollback = new Error('rollback website inquiry fixtures');
  try {
    await db.transaction(async tx => {
      await run(await seed(tx), tx);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}
async function seed(tx: HrDb) {
  const token = randomUUID();
  const [tenant, other] = await tx.insert(tenantsTable).values([{ name: 'Inquiry test' }, { name: 'Other inquiry test' }]).returning();
  const [user] = await tx.insert(usersTable).values({ tenantId: tenant.id, name: 'Reviewer', email: `${token}@example.invalid`, role: 'company_owner' }).returning();
  const [customer, sameEmail, foreign, archived] = await tx.insert(customersTable).values([
    { tenantId: tenant.id, name: 'Returning Customer', email: 'shared@example.invalid', phone: '(303) 555-0123', smsOptOut: false, emailOptOut: false, referralSource: 'original' },
    { tenantId: tenant.id, name: 'Different Person', email: 'shared@example.invalid', phone: '' },
    { tenantId: other.id, name: 'Returning Customer', email: 'shared@example.invalid', phone: '3035550123' },
    { tenantId: tenant.id, name: 'Archived', email: 'shared@example.invalid', phone: '', archivedAt: new Date() },
  ]).returning();
  const [property, wrongOwner, wrongTenant, archivedProperty] = await tx.insert(propertiesTable).values([
    { tenantId: tenant.id, customerId: customer.id, address: '10 Existing St', size: 900, measurementPolygons: [{ source: 'verified' }] },
    { tenantId: tenant.id, customerId: sameEmail.id, address: '20 Other St' },
    { tenantId: other.id, customerId: foreign.id, address: '10 Existing St' },
    { tenantId: tenant.id, customerId: customer.id, address: 'Old property', archivedAt: new Date() },
  ]).returning();
  const payload = { answers: { name: 'RETURNING CUSTOMER', email: ' SHARED@example.invalid ', phone: '3035550123', address: '10 existing st' }, measurements: {}, areaSqft: 100, lengthFt: null };
  const [submission] = await tx.insert(websiteIntakeSubmissionsTable).values({
    tenantId: tenant.id, kind: 'quote', requestId: token, requestHash: token, reference: token,
    payload, snapshot: defaultWebsiteFlow('quote'), path: [],
    preview: { total: 42, items: [{ serviceId: 1, name: 'Submitted price', price: 42 }] },
  }).returning();
  return { tenant, other, user, customer, sameEmail, foreign, archived, property, wrongOwner, wrongTenant, archivedProperty, submission };
}

describe.skipIf(!process.env.DATABASE_URL)('website inquiry customer choices', () => {
  it('labels common address variations without confusing distinct properties', async () => fixture(async (f, tx) => {
    const addressReason = 'Similar property address (formatting or abbreviation)';
    const lookup = async (address: string) => (await websiteCustomerChoices(f.tenant.id, f.submission.id, '', tx, {
      name: '', email: '', phone: '', address,
    })).possibleMatches;
    for (const [stored, submitted] of [
      ['10 Existing St', '10 Existing Street'],
      ['10 Existing Street', '  10   EXISTING St.  '],
      ['10 Existing Avenue', '10 Existing Ave'],
      ['10 Existing Road', '10 Existing Rd.'],
      ['10 Existing Drive', '10 Existing Dr'],
      ['10 Existing Boulevard', '10 Existing Blvd'],
      ['10 Existing Lane', '10 Existing Ln'],
      ['10 Existing Court', '10 Existing Ct'],
      ['10 Existing Circle', '10 Existing Cir'],
      ['10 Existing Place', '10 Existing Pl'],
      ['10 Existing Terrace', '10 Existing Ter'],
      ['10 Existing Parkway', '10 Existing Pkwy'],
      ['10 Existing Highway', '10 Existing Hwy'],
      ['10 Existing Street Apt 2', '10 Existing St. Apt 2'],
      ['10 Existing Street, Denver, CO 80202', '10 Existing St., Denver CO 80202'],
    ]) {
      await tx.update(propertiesTable).set({ address: stored }).where(eq(propertiesTable.id, f.property.id));
      expect(await lookup(submitted), `${stored} / ${submitted}`).toEqual([
        expect.objectContaining({ id: f.customer.id, reasons: [addressReason] }),
      ]);
    }
    await tx.update(propertiesTable).set({ address: '10 Existing Street Apt 2' }).where(eq(propertiesTable.id, f.property.id));
    for (const address of ['11 Existing St Apt 2', '10 Existing St Apt 3', '10 Existing St', '10 Existing Rd Apt 2',
      '10 Existington St Apt 2', '10 Existing St Apt 02', '10 Existing St Apt 2, Other City']) {
      expect(await lookup(address), address).toEqual([]);
    }
    await tx.update(propertiesTable).set({ address: '10 Street Road' }).where(eq(propertiesTable.id, f.property.id));
    expect(await lookup('10 St Road')).toEqual([]);
    for (const [stored, different] of [
      ['10.5 Existing Street', '105 Existing St'],
      ['10 Existing Street Unit 2.1', '10 Existing St Unit 21'],
      ['10-12 Existing Street', '1012 Existing St'],
      ['10 North Existing Street', '10 South Existing St'],
    ]) {
      await tx.update(propertiesTable).set({ address: stored }).where(eq(propertiesTable.id, f.property.id));
      expect(await lookup(different)).toEqual([]);
    }
    expect((await websiteCustomerChoices(f.tenant.id, f.submission.id, '', tx, {
      name: 'Returning Customers', email: '', phone: '', address: '',
    })).possibleMatches).toEqual([]);
    await tx.update(customersTable).set({ physicalAddress: '90 Separate Street' }).where(eq(customersTable.id, f.customer.id));
    expect(await lookup('90 Separate St.')).toEqual([expect.objectContaining({ id: f.customer.id, reasons: [addressReason] })]);
    // Neither foreign nor archived properties/customers may supply evidence.
    await tx.update(propertiesTable).set({ address: '50 Hidden Street' })
      .where(eq(propertiesTable.id, f.wrongTenant.id));
    await tx.update(propertiesTable).set({ address: '50 Hidden Street' })
      .where(eq(propertiesTable.id, f.archivedProperty.id));
    await tx.update(customersTable).set({ physicalAddress: '50 Hidden Street' })
      .where(eq(customersTable.id, f.archived.id));
    expect(await lookup('50 Hidden St.')).toEqual([]);
    expect(await lookup(' . , ')).toEqual([]);
  }));

  it('recognizes explicit phone country codes without matching unrelated numbers or extensions', async () => fixture(async (f, tx) => {
    const lookup = async (phone: string) => (await websiteCustomerChoices(f.tenant.id, f.submission.id, '', tx, {
      name: '', email: '', address: '', phone,
    })).possibleMatches;
    for (const [stored, submitted] of [
      ['(303) 555-0123', '+1 (303) 555-0123'],
      ['+1 303-555-0123', '3035550123'],
      ['1-303-555-0123', '001 303 555 0123'],
      ['+44 20 7946 0958', '0044 20 7946 0958'],
    ]) {
      await tx.update(customersTable).set({ phone: stored }).where(eq(customersTable.id, f.customer.id));
      expect(await lookup(submitted)).toEqual([expect.objectContaining({
        id: f.customer.id, reasons: ['Similar phone (country code variation)'],
      })]);
    }
    await tx.update(customersTable).set({ phone: '3035550123' }).where(eq(customersTable.id, f.customer.id));
    for (const number of ['+44 3035550123', '+1 3035550124', '5550123', '+1 3035550123 ext 4', '', '()']) {
      expect(await lookup(number), number).toEqual([]);
    }
    await tx.update(customersTable).set({ phone: '5558889999' }).where(eq(customersTable.id, f.foreign.id));
    await tx.update(customersTable).set({ phone: '5558889999' }).where(eq(customersTable.id, f.archived.id));
    expect(await lookup('+1 5558889999')).toEqual([]);
  }));

  it('requires explicit confirmation for normalized-only evidence and leaves source records untouched', async () => fixture(async (f, tx) => {
    const customer = { name: 'Different Inquiry', email: '', phone: '+1 3035550123', address: '10 Existing Street' };
    const choices = await websiteCustomerChoices(f.tenant.id, f.submission.id, '', tx, customer);
    expect(choices.possibleMatches).toEqual([expect.objectContaining({
      id: f.customer.id, reasons: ['Similar phone (country code variation)', 'Similar property address (formatting or abbreviation)'],
    })]);
    for (const selection of [{}, { customerId: f.customer.id, propertyId: f.property.id }]) {
      await expect(reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, {
        action: 'approve', ...selection, ...(selection.customerId ? {} : { customer }),
      }, tx)).rejects.toThrow(/Confirm|Possible existing/);
    }
    const [pending] = await tx.select().from(websiteIntakeSubmissionsTable).where(eq(websiteIntakeSubmissionsTable.id, f.submission.id));
    expect(pending).toMatchObject({ status: 'pending', customerId: null, payload: f.submission.payload });
    const saved = await reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, {
      action: 'approve', customer, confirmCustomerChoice: true,
    }, tx);
    expect(saved.customerId).not.toBe(f.customer.id);
    const [original] = await tx.select().from(customersTable).where(eq(customersTable.id, f.customer.id));
    expect(original).toEqual(f.customer);
  }));

  it('suggests all duplicate identities without choosing one and scopes literal searches/properties to the tenant', async () => fixture(async (f, tx) => {
    const choices = await websiteCustomerChoices(f.tenant.id, f.submission.id, 'existing st', tx);
    expect(choices.possibleMatches.map(c => c.id)).toEqual(expect.arrayContaining([f.customer.id, f.sameEmail.id]));
    expect(choices.possibleMatches.find(c => c.id === f.customer.id)?.reasons).toEqual(['Same email', 'Same phone', 'Same name', 'Same property address']);
    expect(choices.customers.map(c => c.id)).toEqual([f.customer.id]);
    expect(choices.properties.map(p => p.id)).not.toContain(f.wrongTenant.id);
    expect(choices.properties.map(p => p.id)).not.toContain(f.archivedProperty.id);
    expect(choices.possibleMatches.map(c => c.id)).not.toContain(f.foreign.id);
    expect(choices.possibleMatches.map(c => c.id)).not.toContain(f.archived.id);
    expect((await websiteCustomerChoices(f.tenant.id, f.submission.id, '%', tx)).customers).toEqual([]);
    await expect(websiteCustomerChoices(f.other.id, f.submission.id, '', tx)).rejects.toThrow('not found');
  }));

  it('requires staff confirmation, rejects cross-tenant/owner/archived IDs, and keeps a failed approval pending', async () => fixture(async (f, tx) => {
    const review = (input: Parameters<typeof reviewWebsiteSubmission>[3]) => reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, input, tx);
    await expect(review({ action: 'approve', customerId: f.customer.id })).rejects.toThrow('Confirm');
    await expect(review({ action: 'approve' })).rejects.toThrow('Possible existing');
    for (const customerId of [f.foreign.id, f.archived.id]) {
      await expect(review({ action: 'approve', customerId, confirmCustomerChoice: true })).rejects.toThrow('unavailable');
    }
    for (const propertyId of [f.wrongOwner.id, f.wrongTenant.id, f.archivedProperty.id]) {
      await expect(review({ action: 'approve', customerId: f.customer.id, propertyId, confirmCustomerChoice: true })).rejects.toThrow('unavailable');
    }
    await expect(review({ action: 'approve', propertyId: f.property.id })).rejects.toThrow('Select the customer');
    await expect(review({ action: 'approve', customerId: f.customer.id, customer: { name: 'Overwrite' }, confirmCustomerChoice: true })).rejects.toThrow('cannot change');
    const [row] = await tx.select().from(websiteIntakeSubmissionsTable).where(eq(websiteIntakeSubmissionsTable.id, f.submission.id));
    expect(row.status).toBe('pending');
    expect(row.customerId).toBeNull();
  }));

  it('reuses selected customer/property, preserves submitted evidence and existing records, and creates one unsent draft on retries', async () => fixture(async (f, tx) => {
    const input = { action: 'approve' as const, customerId: f.customer.id, propertyId: f.property.id, confirmCustomerChoice: true, createEstimate: true, notes: 'Confirmed with customer' };
    const saved = await reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, input, tx);
    expect(saved).toMatchObject({ status: 'approved', customerId: f.customer.id, propertyId: f.property.id, reviewedBy: f.user.id, reviewNotes: input.notes });
    expect(saved.reviewData).toMatchObject({ ...input, customerChoice: 'existing', propertyChoice: 'existing' });
    expect(saved.reviewedAt).toBeInstanceOf(Date);
    expect(saved.payload).toEqual(f.submission.payload);
    expect(saved.snapshot).toEqual(f.submission.snapshot);
    expect(saved.preview).toEqual(f.submission.preview);
    const [customer] = await tx.select().from(customersTable).where(eq(customersTable.id, f.customer.id));
    const [property] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, f.property.id));
    expect(customer).toEqual(f.customer);
    expect(property).toEqual(f.property);
    const [estimate] = await tx.select().from(estimatesTable).where(eq(estimatesTable.id, saved.estimateId!));
    expect(estimate).toMatchObject({ customerId: f.customer.id, propertyId: f.property.id, status: 'draft', total: 42 });
    const retry = await reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, { action: 'decline' }, tx);
    expect(retry).toEqual(saved);
    expect(await tx.select().from(estimatesTable).where(eq(estimatesTable.customerId, f.customer.id))).toHaveLength(1);
    expect(await tx.select().from(customersTable).where(eq(customersTable.tenantId, f.tenant.id))).toHaveLength(3);
  }));

  it('can link without an estimate and explicitly create a new property, without changing existing measurements', async () => fixture(async (f, tx) => {
    const saved = await reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, {
      action: 'approve', customerId: f.customer.id, confirmCustomerChoice: true, createEstimate: false,
    }, tx);
    expect(saved.customerId).toBe(f.customer.id);
    expect(saved.propertyId).not.toBe(f.property.id);
    expect(saved.estimateId).toBeNull();
    expect(saved.reviewData).toMatchObject({ customerChoice: 'existing', propertyChoice: 'created' });
    const [property] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, saved.propertyId!));
    expect(property).toMatchObject({ tenantId: f.tenant.id, customerId: f.customer.id, address: '10 existing st', size: 100 });
  }));

  it('never merges by shared email and allows a deliberately confirmed new customer', async () => fixture(async (f, tx) => {
    const saved = await reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, { action: 'approve', confirmCustomerChoice: true }, tx);
    expect(saved.customerId).not.toBe(f.customer.id);
    expect(saved.customerId).not.toBe(f.sameEmail.id);
    expect(saved.reviewData).toMatchObject({ customerChoice: 'created', confirmCustomerChoice: true });
    expect(await tx.select().from(customersTable).where(and(eq(customersTable.tenantId, f.tenant.id), eq(customersTable.email, 'shared@example.invalid')))).toHaveLength(4);
  }));

  it('checks effective staff corrections for duplicates even when original answers do not match', async () => fixture(async (f, tx) => {
    const payload = { answers: { name: 'New Inquiry', email: 'typo@example.invalid', phone: '111', address: 'Unmatched address' }, measurements: {}, areaSqft: null, lengthFt: null };
    await tx.update(websiteIntakeSubmissionsTable).set({ payload }).where(eq(websiteIntakeSubmissionsTable.id, f.submission.id));
    expect((await websiteCustomerChoices(f.tenant.id, f.submission.id, '', tx)).possibleMatches).toEqual([]);
    for (const correction of [
      { name: 'Returning Customer' },
      { name: 'New Inquiry', email: 'shared@example.invalid' },
      { name: 'New Inquiry', phone: '(303) 555-0123' },
      { name: 'New Inquiry', address: '10 Existing St' },
    ]) {
      const choices = await websiteCustomerChoices(f.tenant.id, f.submission.id, '', tx, correction);
      expect(choices.possibleMatches.map(c => c.id)).toContain(f.customer.id);
      await expect(reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, {
        action: 'approve', customer: correction,
      }, tx)).rejects.toThrow('Possible existing');
    }
    const [pending] = await tx.select().from(websiteIntakeSubmissionsTable).where(eq(websiteIntakeSubmissionsTable.id, f.submission.id));
    expect(pending).toMatchObject({ status: 'pending', customerId: null, payload });
    const saved = await reviewWebsiteSubmission(f.tenant.id, f.user.id, f.submission.id, {
      action: 'approve', customer: { name: 'New Inquiry', email: 'shared@example.invalid' }, confirmCustomerChoice: true,
    }, tx);
    expect(saved.customerId).not.toBe(f.customer.id);
    expect(saved.payload).toEqual(payload);
    expect(saved.reviewData).toMatchObject({ customer: { email: 'shared@example.invalid' }, confirmCustomerChoice: true, customerChoice: 'created' });
  }));
});

describe('review selection input', () => {
  it('rejects invalid identifiers, unknown fields and non-boolean confirmations', () => {
    for (const input of [{ customerId: -1 }, { propertyId: 1.5 }, { customerId: '1' }, { confirmCustomerChoice: 'yes' }, { tenantId: 1 }]) {
      expect(reviewInput.safeParse({ action: 'approve', ...input }).success).toBe(false);
    }
  });
});
