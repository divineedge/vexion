import { db, customersTable, propertiesTable, websiteIntakeSubmissionsTable } from '@workspace/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { HrDb } from './hrAccess';
import { HrError } from './hrAccess';
import type { Answers } from './websiteFlow';
import { addressComparisonKey, phoneComparisonKey } from './websiteCustomerNormalization';

const text = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const phone = (value: unknown) => text(value).replace(/\D/g, '');

/** Suggestions are evidence for a human decision, never an automatic identity merge. */
export async function websiteCustomerChoices(tenantId: number, id: number, search = '', handle: HrDb = db,
  corrections?: { name?: string; email?: string; phone?: string; address?: string }) {
  const [submission] = await handle.select().from(websiteIntakeSubmissionsTable).where(and(
    eq(websiteIntakeSubmissionsTable.tenantId, tenantId), eq(websiteIntakeSubmissionsTable.id, id),
    eq(websiteIntakeSubmissionsTable.kind, 'quote'),
  ));
  if (!submission) throw new HrError('Quote inquiry not found', 404);
  const a = { ...(submission.payload as { answers: Answers }).answers, ...corrections };
  const email = text(a.email), name = text(a.name), number = phone(a.phone), address = text(a.address);
  const addressKey = addressComparisonKey(sql`${address}`);
  const numberKey = phoneComparisonKey(sql`${number}`);
  const sameAddress = sql`(
    lower(trim(${customersTable.physicalAddress})) = ${address} OR EXISTS (
      SELECT 1 FROM properties p WHERE p.tenant_id = ${tenantId}
      AND p.customer_id = customers.id AND p.archived_at IS NULL
      AND lower(trim(p.address)) = ${address}
    ))`;
  const similarAddress = sql`(
    ${addressComparisonKey(sql`${customersTable.physicalAddress}`)} = ${addressKey} OR EXISTS (
      SELECT 1 FROM properties p WHERE p.tenant_id = ${tenantId}
      AND p.customer_id = customers.id AND p.archived_at IS NULL
      AND ${addressComparisonKey(sql`p.address`)} = ${addressKey}
    ))`;
  const reasons = sql<string[]>`array_remove(ARRAY[
    CASE WHEN ${email} <> '' AND lower(trim(${customersTable.email})) = ${email} THEN 'Same email' END,
    CASE WHEN ${number} <> '' AND regexp_replace(${customersTable.phone}, '[^0-9]', '', 'g') = ${number} THEN 'Same phone'
      WHEN ${numberKey} <> '' AND ${phoneComparisonKey(sql`${customersTable.phone}`)} = ${numberKey}
      THEN 'Similar phone (country code variation)' END,
    CASE WHEN ${name} <> '' AND lower(trim(${customersTable.name})) = ${name} THEN 'Same name' END,
    CASE WHEN ${address} <> '' AND ${sameAddress} THEN 'Same property address'
      WHEN ${addressKey} <> '' AND ${similarAddress}
      THEN 'Similar property address (formatting or abbreviation)' END
  ], NULL)`;
  const base = and(eq(customersTable.tenantId, tenantId), isNull(customersTable.archivedAt));
  const fields = {
    id: customersTable.id, name: customersTable.name, email: customersTable.email,
    phone: customersTable.phone, address: customersTable.physicalAddress, reasons,
  };
  const possibleMatches = await handle.select(fields).from(customersTable)
    .where(and(base, sql`cardinality(${reasons}) > 0`)).orderBy(asc(customersTable.name), asc(customersTable.id)).limit(51);
  // strpos treats search text literally, including SQL wildcard characters.
  const term = search.trim().toLowerCase();
  const customers = await handle.select(fields).from(customersTable).where(and(base, term ? or(
    sql`strpos(lower(${customersTable.name}), ${term}) > 0`,
    sql`strpos(lower(${customersTable.email}), ${term}) > 0`,
    sql`strpos(lower(${customersTable.phone}), ${term}) > 0`,
    sql`strpos(lower(coalesce(${customersTable.physicalAddress}, '')), ${term}) > 0`,
    sql`EXISTS (SELECT 1 FROM properties p WHERE p.tenant_id = ${tenantId} AND p.customer_id = customers.id
      AND p.archived_at IS NULL AND strpos(lower(p.address), ${term}) > 0)`,
  ) : undefined)).orderBy(asc(customersTable.name), asc(customersTable.id)).limit(51);
  const ids = [...new Set([...possibleMatches.slice(0, 50), ...customers.slice(0, 50)].map(c => c.id))];
  const properties = ids.length ? await handle.select({
    id: propertiesTable.id, customerId: propertiesTable.customerId, address: propertiesTable.address,
    city: propertiesTable.city, state: propertiesTable.state, zip: propertiesTable.zip,
  }).from(propertiesTable).where(and(eq(propertiesTable.tenantId, tenantId),
    inArray(propertiesTable.customerId, ids), isNull(propertiesTable.archivedAt)))
    .orderBy(asc(propertiesTable.address), asc(propertiesTable.id)) : [];
  return {
    possibleMatches: possibleMatches.slice(0, 50), customers: customers.slice(0, 50), properties,
    matchesTruncated: possibleMatches.length > 50, hasMore: customers.length > 50,
  };
}
