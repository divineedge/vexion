import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  activityLogTable,
  customersTable,
  db,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import customersRouter from "./customers";

const RUN = !!process.env.DATABASE_URL;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", customersRouter);
  return app;
}

describe.skipIf(!RUN)("customer-to-customer referrals", () => {
  const app = buildApp();
  let tenantId: number;
  let otherTenantId: number;
  let userId: number;
  let referrerId: number;
  let otherTenantCustomerId: number;
  let referredCustomerId: number;

  const headers = () => ({
    "x-tenant-id": String(tenantId),
    "x-user-id": String(userId),
  });

  beforeAll(async () => {
    const [tenant] = await db.insert(tenantsTable).values({ name: "__test_customer_referrals__" }).returning({ id: tenantsTable.id });
    const [otherTenant] = await db.insert(tenantsTable).values({ name: "__test_customer_referrals_other__" }).returning({ id: tenantsTable.id });
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;

    const [user] = await db.insert(usersTable).values({
      tenantId,
      name: "Referral Test Owner",
      email: `referral-owner-${tenantId}@example.test`,
      passwordHash: "mock",
      role: "company_owner",
    }).returning({ id: usersTable.id });
    userId = user.id;

    const [referrer] = await db.insert(customersTable).values({
      tenantId,
      name: "Existing Referrer",
      email: `referrer-${tenantId}@example.test`,
      phone: "555-0101",
    }).returning({ id: customersTable.id });
    referrerId = referrer.id;

    const [otherCustomer] = await db.insert(customersTable).values({
      tenantId: otherTenantId,
      name: "Other Tenant Customer",
      email: `other-referrer-${otherTenantId}@example.test`,
      phone: "555-0102",
    }).returning({ id: customersTable.id });
    otherTenantCustomerId = otherCustomer.id;
  });

  afterAll(async () => {
    await db.delete(activityLogTable).where(eq(activityLogTable.tenantId, tenantId));
    await db.delete(customersTable).where(eq(customersTable.tenantId, tenantId));
    await db.delete(customersTable).where(eq(customersTable.tenantId, otherTenantId));
    await db.delete(usersTable).where(eq(usersTable.tenantId, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, otherTenantId));
  });

  it("creates and returns a same-tenant customer referral", async () => {
    const response = await request(app).post("/api/customers").set(headers()).send({
      name: "Referred Customer",
      email: `referred-${tenantId}@example.test`,
      phone: "555-0103",
      customerType: "residential",
      referralSource: "customer_referral",
      referringCustomerId: referrerId,
    });

    expect(response.status).toBe(201);
    expect(response.body.referringCustomerId).toBe(referrerId);
    expect(response.body.referringCustomerName).toBe("Existing Referrer");
    referredCustomerId = response.body.id;

    const detail = await request(app).get(`/api/customers/${referredCustomerId}`).set(headers());
    expect(detail.status).toBe(200);
    expect(detail.body.referringCustomerId).toBe(referrerId);
    expect(detail.body.referringCustomerName).toBe("Existing Referrer");

    const exported = await request(app)
      .get(`/api/customers/export?q=${encodeURIComponent("Referred Customer")}`)
      .set(headers());
    expect(exported.status).toBe(200);
    expect(exported.text).toContain("Referring Customer Email");
    expect(exported.text).toContain(`referrer-${tenantId}@example.test`);

    const preview = await request(app)
      .post("/api/customers/import/preview")
      .set(headers())
      .attach("file", Buffer.from([
        "Name,Email,Phone,Referral Source,Referring Customer Email",
        `Imported Referral,imported-${tenantId}@example.test,555-0199,customer_referral,referrer-${tenantId}@example.test`,
      ].join("\n")), "customers.csv");
    expect(preview.status).toBe(200);
    expect(preview.body.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "referringCustomerEmail" }),
    ]));
    expect(preview.body.suggestedMapping.referringCustomerEmail).toBe("Referring Customer Email");
  });

  it("rejects a cross-tenant referring customer", async () => {
    const response = await request(app).post("/api/customers").set(headers()).send({
      name: "Invalid Cross Tenant Referral",
      email: `cross-${tenantId}@example.test`,
      phone: "555-0104",
      referralSource: "customer_referral",
      referringCustomerId: otherTenantCustomerId,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not found for this business");
  });

  it("rejects self-referrals on update", async () => {
    const response = await request(app).patch(`/api/customers/${referredCustomerId}`).set(headers()).send({
      referralSource: "customer_referral",
      referringCustomerId: referredCustomerId,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("cannot refer themselves");
    const [unchanged] = await db.select().from(customersTable)
      .where(and(eq(customersTable.id, referredCustomerId), eq(customersTable.tenantId, tenantId)));
    expect(unchanged.referringCustomerId).toBe(referrerId);
  });

  it("preserves legacy referral-source values without a linked customer", async () => {
    const response = await request(app).patch(`/api/customers/${referredCustomerId}`).set(headers()).send({
      referralSource: "Word of Mouth",
    });

    expect(response.status).toBe(200);
    expect(response.body.referralSource).toBe("Word of Mouth");
    expect(response.body.referringCustomerId).toBeNull();
  });
});