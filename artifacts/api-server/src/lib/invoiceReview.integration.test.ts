import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, tenantsTable, usersTable, customersTable, invoicesTable, billingEmailQueueTable } from "@workspace/db";

// Never drain the workspace's real email queue during a test.
vi.mock("./billingScheduler", async importOriginal => ({
  ...await importOriginal<typeof import("./billingScheduler")>(),
  processEmailQueue: vi.fn(async () => {}),
  enqueueInvoiceEmail: vi.fn(async () => {}),
}));
import invoiceRouter from "../routes/invoices";

describe("invoice admin review and sending", () => {
  it("requires an admin, rejects unpriced or undeliverable drafts, and queues approval only once", async () => {
    const key = randomUUID();
    const [tenant] = await db.insert(tenantsTable).values({ name: "Invoice review test", slug: `review-${key}` }).returning();
    try {
      const [owner, tech] = await db.insert(usersTable).values([
        { tenantId: tenant.id, name: "Review owner", email: `owner-${key}@example.invalid`, role: "company_owner" },
        { tenantId: tenant.id, name: "Review technician", email: `tech-${key}@example.invalid`, role: "technician" },
      ]).returning();
      const [customer] = await db.insert(customersTable).values({ tenantId: tenant.id, name: "Review test", email: "review@example.invalid", phone: "" }).returning();
      const appFor = (userId: number) => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { Object.assign(req, { verifiedTenantId: tenant.id, verifiedUserId: userId }); next(); });
        app.use(invoiceRouter);
        return app;
      };
      const adminApp = appFor(owner.id);
      const techApp = appFor(tech.id);
      const createInvoice = async (total: number) => (await db.insert(invoicesTable).values({
        tenantId: tenant.id, customerId: customer.id, invoiceNumber: randomUUID(), status: "draft",
        subtotal: total, tax: 0, total, lineItems: [{ description: "Test service", quantity: 1, unitPrice: total, total }],
      }).returning())[0];
      const draft = await createInvoice(100);
      expect((await request(techApp).patch(`/invoices/${draft.id}`).send({ status: "sent" })).status).toBe(403);
      expect((await db.select().from(invoicesTable).where(eq(invoicesTable.id, draft.id)))[0].status).toBe("draft");
      expect(await db.select().from(billingEmailQueueTable).where(eq(billingEmailQueueTable.tenantId, tenant.id))).toHaveLength(0);
      const zero = await createInvoice(0);
      expect((await request(adminApp).patch(`/invoices/${zero.id}`).send({ status: "sent" })).status).toBe(422);
      await db.update(customersTable).set({ email: "" }).where(eq(customersTable.id, customer.id));
      expect((await request(adminApp).patch(`/invoices/${draft.id}`).send({ status: "sent" })).status).toBe(422);
      await db.update(customersTable).set({ email: "review@example.invalid" }).where(eq(customersTable.id, customer.id));
      const replies = await Promise.all([
        request(adminApp).patch(`/invoices/${draft.id}`).send({ status: "sent" }),
        request(adminApp).patch(`/invoices/${draft.id}`).send({ status: "sent" }),
      ]);
      expect(replies.map(r => r.status)).toEqual([200, 200]);
      const [sent] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, draft.id));
      expect(sent.status).toBe("sent");
      expect(sent.publicToken).toBeTruthy();
      expect(await db.select().from(billingEmailQueueTable).where(eq(billingEmailQueueTable.invoiceId, draft.id))).toHaveLength(1);
      await db.update(invoicesTable).set({ status: "paid" }).where(eq(invoicesTable.id, draft.id));
      expect((await request(adminApp).patch(`/invoices/${draft.id}`).send({ status: "sent" })).status).toBe(409);
    } finally {
      await db.delete(billingEmailQueueTable).where(eq(billingEmailQueueTable.tenantId, tenant.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id));
      await db.delete(customersTable).where(eq(customersTable.tenantId, tenant.id));
      await db.delete(usersTable).where(eq(usersTable.tenantId, tenant.id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenant.id));
    }
  });
});
