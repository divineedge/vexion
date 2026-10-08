import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, tenantsTable, usersTable, customersTable, servicesTable, jobsTable, invoicesTable, activityLogTable } from "@workspace/db";
import servicesRouter from "../routes/services";
import invoicesRouter from "../routes/invoices";

describe("service invoice date persistence", () => {
  it("saves service choices, dates invoices in tenant time, and preserves already-created invoices", async () => {
    const suffix = randomUUID();
    const [tenant] = await db.insert(tenantsTable).values({ name: "Invoice date test", slug: `date-${suffix}`, timezone: "America/Denver" }).returning();
    try {
      const [user] = await db.insert(usersTable).values({ tenantId: tenant.id, name: "Test Owner", email: `date-${suffix}@example.invalid`, role: "company_owner" }).returning();
      const [customer] = await db.insert(customersTable).values({ tenantId: tenant.id, name: "Date Test Customer", email: "", phone: "" }).returning();
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        Object.assign(req, { verifiedTenantId: tenant.id, verifiedUserId: user.id });
        next();
      });
      app.use(servicesRouter, invoicesRouter);
      const created = await request(app).post("/services").send({ name: "Date-specific work", basePrice: 100, fieldRequirements: { invoiceDateBasis: "completed" } });
      expect(created.status).toBe(201);
      const serviceId = created.body.id;
      const createJob = async () => (await db.insert(jobsTable).values({
        tenantId: tenant.id, customerId: customer.id, serviceId, title: "Test work", status: "completed",
        scheduledAt: new Date("2026-10-02T12:00:00Z"), completedAt: new Date("2026-10-05T01:30:00Z"),
        totalAmount: 100, lineItems: [{ description: "Test work", quantity: 1, unitPrice: 100, total: 100 }],
      }).returning())[0];
      const first = await createJob();
      const invoice = await request(app).post(`/invoices/from-job/${first.id}`).send({});
      expect(invoice.status).toBe(201);
      expect(invoice.body.lineItems[0].description).toContain("Completed Oct 4, 2026");
      const changed = await request(app).patch(`/services/${serviceId}`).send({ fieldRequirements: { invoiceDateBasis: "scheduled" } });
      expect(changed.status).toBe(200);
      expect((await request(app).get(`/services/${serviceId}`)).body.fieldRequirements.invoiceDateBasis).toBe("scheduled");
      const second = await createJob();
      const scheduled = await request(app).post(`/invoices/from-job/${second.id}`).send({});
      expect(scheduled.status).toBe(201);
      expect(scheduled.body.lineItems[0].description).toContain("Scheduled Oct 2, 2026");
      const [saved] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.body.id));
      expect(JSON.stringify(saved.lineItems)).toContain("Completed Oct 4, 2026");
    } finally {
      await db.delete(activityLogTable).where(eq(activityLogTable.tenantId, tenant.id));
      await db.update(jobsTable).set({ invoiceId: null }).where(eq(jobsTable.tenantId, tenant.id));
      await db.delete(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id));
      await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenant.id));
      await db.delete(servicesTable).where(eq(servicesTable.tenantId, tenant.id));
      await db.delete(customersTable).where(eq(customersTable.tenantId, tenant.id));
      await db.delete(usersTable).where(eq(usersTable.tenantId, tenant.id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenant.id));
    }
  });
});
