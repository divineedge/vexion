import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, tenantsTable, customersTable, jobsTable, invoicesTable, recurringInvoiceTemplatesTable, invoiceTemplatesTable, billingEmailQueueTable } from "@workspace/db";
import { generateDueTemplate } from "./billingScheduler";

describe("shared recurring invoice documents", () => {
  it("bills multiple customers separately with saved terms/notes and never rewrites issued snapshots", async () => {
    const [tenant] = await db.insert(tenantsTable).values({
      name: "Document test", slug: randomUUID(), invoiceDeliveryMode: "review", taxRate: 0,
      defaultInvoiceTerms: "Company terms", defaultInvoiceNotes: "Company notes",
    }).returning();
    try {
      const customers = await db.insert(customersTable).values([
        { tenantId: tenant.id, name: "Test A", email: "a@example.invalid", phone: "" },
        { tenantId: tenant.id, name: "Test B", email: "b@example.invalid", phone: "" },
      ]).returning();
      const [design] = await db.insert(invoiceTemplatesTable).values({ tenantId: tenant.id, name: "Design", termsText: "Design terms", notes: "Design notes", layout: "compact" }).returning();
      const [template] = await db.insert(recurringInvoiceTemplatesTable).values({
        tenantId: tenant.id, name: "All customers", customerId: null, serviceId: null,
        billingMode: "completed_work", billingCycleType: "daily", nextBillingDate: "2020-01-01",
        createdAt: new Date("2020-01-01"), termsText: "Recurring terms", notes: "",
        invoiceTemplateId: design.id,
      }).returning();
      for (const customer of customers) await db.insert(jobsTable).values({
        tenantId: tenant.id, customerId: customer.id, title: "Service", status: "completed",
        scheduledAt: new Date(), completedAt: new Date(), totalAmount: 75,
      });
      const ids = await db.transaction(tx => generateDueTemplate(tx, template));
      expect(ids).toHaveLength(2);
      const documents = await db.select().from(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id));
      expect(new Set(documents.map(i => i.customerId)).size).toBe(2);
      for (const invoice of documents) expect(invoice).toMatchObject({ status: "draft", total: 75, termsText: "Recurring terms", notes: "", layout: "compact" });
      expect(await db.select().from(billingEmailQueueTable).where(eq(billingEmailQueueTable.tenantId, tenant.id))).toHaveLength(0);
      await db.update(tenantsTable).set({ defaultInvoiceTerms: "Changed default" }).where(eq(tenantsTable.id, tenant.id));
      await db.update(recurringInvoiceTemplatesTable).set({ termsText: "Changed template" }).where(eq(recurringInvoiceTemplatesTable.id, template.id));
      expect((await db.select().from(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id))).every(i => i.termsText === "Recurring terms")).toBe(true);
    } finally {
      await db.delete(billingEmailQueueTable).where(eq(billingEmailQueueTable.tenantId, tenant.id));
      await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenant.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id));
      await db.delete(recurringInvoiceTemplatesTable).where(eq(recurringInvoiceTemplatesTable.tenantId, tenant.id));
      await db.delete(invoiceTemplatesTable).where(eq(invoiceTemplatesTable.tenantId, tenant.id));
      await db.delete(customersTable).where(eq(customersTable.tenantId, tenant.id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenant.id));
    }
  });
});
