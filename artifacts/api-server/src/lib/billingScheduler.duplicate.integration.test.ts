/**
 * DB-backed integration tests for the billing duplicate-prevention guards.
 *
 * Three layers are tested:
 *   1. Double-call idempotency — calling generateDueTemplate twice for the same
 *      template on the same day produces exactly one invoice (the concurrent-process
 *      guard detects the advanced nextBillingDate on the second call and skips).
 *   2. Unique index hard stop — a direct INSERT of a second row with the same
 *      (generated_from_template_id, customer_id, billing_date) tuple is rejected
 *      by the DB-level partial unique index.
 *   3. Concurrent-lock path — two parallel db.transaction() calls for the same
 *      template (simulating two scheduler processes starting at the same moment)
 *      produce exactly one invoice between them; the loser skips after seeing the
 *      advanced nextBillingDate once the winner's lock is released.
 *
 * Tests are skipped when DATABASE_URL is absent so the suite stays green in CI
 * environments without a DB sidecar.  They clean up after themselves and are safe
 * to run against the development database.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  tenantsTable,
  customersTable,
  recurringInvoiceTemplatesTable,
  invoicesTable,
  billingEmailQueueTable,
} from "@workspace/db";
import type { RecurringInvoiceTemplate } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { generateDueTemplate } from "./billingScheduler";

// ---------------------------------------------------------------------------
// Guard — skip everything when there is no database
// ---------------------------------------------------------------------------
const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("billing duplicate-prevention — DB integration", () => {
  // ── Shared fixture state ──────────────────────────────────────────────────
  let tenantId: number;
  let customerId: number;
  /** Fresh template inserted per test so runs never interfere with each other. */
  const insertedTemplateIds: number[] = [];
  const insertedInvoiceIds: number[] = [];
  const insertedEmailQueueIds: number[] = [];

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Today as a yyyy-mm-dd string (UTC), matching todayDateString() in billingScheduler. */
  function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Insert a minimal 'static' recurring invoice template whose nextBillingDate is today
   * (i.e. it is due right now).  Returns the full row so tests can pass it to generateDueTemplate.
   */
  async function insertDueTemplate(overrides: Partial<typeof recurringInvoiceTemplatesTable.$inferInsert> = {}): Promise<RecurringInvoiceTemplate> {
    const [tmpl] = await db
      .insert(recurringInvoiceTemplatesTable)
      .values({
        tenantId,
        customerId,
        name: "__test_dup_guard__",
        billingMode: "static",
        billingCycleType: "monthly",
        billingCycleDay: 1,
        nextBillingDate: todayStr(), // due today → generateDueTemplate will process it
        isActive: true,
        lineItems: JSON.stringify([
          { description: "Test service", quantity: 1, unitPrice: 100, total: 100 },
        ]),
        ...overrides,
      })
      .returning();
    insertedTemplateIds.push(tmpl.id);
    return tmpl;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ name: "__test_billing_dup_guard__" })
      .returning({ id: tenantsTable.id });
    tenantId = tenant.id;

    const [customer] = await db
      .insert(customersTable)
      .values({
        tenantId,
        name: "__test_dup_customer__",
        email: "duptest@example.invalid",
        phone: "555-0000",
      })
      .returning({ id: customersTable.id });
    customerId = customer.id;
  });

  afterAll(async () => {
    // Clean up in FK-safe order: email queue → invoices → templates → customers → tenant
    if (insertedEmailQueueIds.length > 0) {
      await db.delete(billingEmailQueueTable).where(inArray(billingEmailQueueTable.id, insertedEmailQueueIds));
    }
    if (insertedInvoiceIds.length > 0) {
      await db.delete(invoicesTable).where(inArray(invoicesTable.id, insertedInvoiceIds));
    }
    if (insertedTemplateIds.length > 0) {
      await db.delete(recurringInvoiceTemplatesTable).where(inArray(recurringInvoiceTemplatesTable.id, insertedTemplateIds));
    }
    await db.delete(customersTable).where(eq(customersTable.id, customerId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  });

  // ── Helper to track invoices and email-queue rows created by a test ───────

  async function collectNewInvoicesForTemplate(templateId: number): Promise<number[]> {
    const rows = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.generatedFromTemplateId, templateId));
    const ids = rows.map(r => r.id);
    insertedInvoiceIds.push(...ids);
    return ids;
  }

  async function collectNewEmailQueueForInvoices(invoiceIds: number[]): Promise<void> {
    if (invoiceIds.length === 0) return;
    const rows = await db
      .select({ id: billingEmailQueueTable.id })
      .from(billingEmailQueueTable)
      .where(inArray(billingEmailQueueTable.invoiceId, invoiceIds));
    insertedEmailQueueIds.push(...rows.map(r => r.id));
  }

  // ── 1. Double-call idempotency ────────────────────────────────────────────

  it("calling generateDueTemplate twice produces exactly one invoice", async () => {
    const template = await insertDueTemplate();

    // First call: template is due → one invoice is generated and nextBillingDate advances.
    const ids1 = await db.transaction(async tx => generateDueTemplate(tx, template));
    expect(ids1).toHaveLength(1);

    // Track for cleanup
    await collectNewEmailQueueForInvoices(ids1);
    insertedInvoiceIds.push(...ids1);

    // Second call: the scheduler guard re-reads nextBillingDate inside the FOR UPDATE
    // lock and sees it is now past today → it returns [] without touching invoicesTable.
    const ids2 = await db.transaction(async tx => generateDueTemplate(tx, template));
    expect(ids2).toHaveLength(0);

    // Confirm exactly one invoice exists for this template in the database.
    const allInvoices = await collectNewInvoicesForTemplate(template.id);
    // ids1 was already pushed; don't double-count via collectNew — check count directly.
    const invoiceCount = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.generatedFromTemplateId, template.id));
    expect(invoiceCount).toHaveLength(1);
  });

  // ── 2. Unique index hard stop ─────────────────────────────────────────────

  it("unique index rejects a second invoice with the same (templateId, customerId, billingDate)", async () => {
    const template = await insertDueTemplate();
    const today = todayStr();

    const commonValues = {
      tenantId,
      invoiceNumber: `INV-TEST-${Date.now()}`,
      customerId,
      status: "sent" as const,
      subtotal: 100,
      tax: 0,
      total: 100,
      lineItems: JSON.stringify([{ description: "Test", quantity: 1, unitPrice: 100, total: 100 }]),
      generatedFromTemplateId: template.id,
      billingDate: today,
    };

    // First insert should succeed.
    const [first] = await db.insert(invoicesTable).values(commonValues).returning({ id: invoicesTable.id });
    insertedInvoiceIds.push(first.id);

    // Collect email queue entries created by the trigger if any (none expected here since
    // generateDueTemplate is not called, but be safe).

    // Second insert with the same (templateId, customerId, billingDate) must be rejected.
    await expect(
      db.insert(invoicesTable).values({
        ...commonValues,
        invoiceNumber: `INV-TEST-${Date.now()}-dup`,
      }),
    ).rejects.toThrow(); // DB unique constraint violation
  });

  // ── 3. Concurrent-lock path ───────────────────────────────────────────────

  it("two parallel generateDueTemplate calls produce one invoice and one skip", async () => {
    const template = await insertDueTemplate();

    // Launch two transactions concurrently — they race for the FOR UPDATE lock on the
    // template row.  The winner generates the invoice and advances nextBillingDate; the
    // loser acquires the lock only after the winner commits, sees nextBillingDate > today,
    // and returns [] without inserting anything.
    const [ids1, ids2] = await Promise.all([
      db.transaction(async tx => generateDueTemplate(tx, template)),
      db.transaction(async tx => generateDueTemplate(tx, template)),
    ]);

    const winner = ids1.length > 0 ? ids1 : ids2;
    const loser  = ids1.length > 0 ? ids2 : ids1;

    // Exactly one process created an invoice.
    expect(winner).toHaveLength(1);
    // The other process was skipped by the concurrent-process guard.
    expect(loser).toHaveLength(0);

    // Track for cleanup
    await collectNewEmailQueueForInvoices(winner);
    insertedInvoiceIds.push(...winner);

    // Confirm only one invoice row exists in the DB for this template.
    const allForTemplate = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.generatedFromTemplateId, template.id));
    expect(allForTemplate).toHaveLength(1);
  });
});
