import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, tenantsTable, usersTable, jobsTable, timeEntriesTable, servicesTable } from "@workspace/db";
import payroll from "./p4p";
import efficiency from "./efficiency";

describe("owner payroll and efficiency", () => {
  it("shows base pay without priced jobs and includes the enabled owner in efficiency", async () => {
    const key = randomUUID();
    const [tenant] = await db.insert(tenantsTable).values({ name: "Payroll QA", slug: key, ownersSchedulable: true, p4pMasterPercentage: 20 }).returning();
    try {
      const [owner] = await db.insert(usersTable).values({ tenantId: tenant.id, name: "QA Owner", email: `${key}@example.invalid`, role: "company_owner", hourlyRate: 25 }).returning();
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { Object.assign(req, { verifiedTenantId: tenant.id, verifiedUserId: owner.id }); next(); });
      app.use(payroll);
      app.use(efficiency);
      const end = new Date(Date.now() - 60_000), start = new Date(end.getTime() - 4 * 3600_000);
      await db.insert(timeEntriesTable).values({ tenantId: tenant.id, userId: owner.id, clockedInAt: start, clockedOutAt: end, isMasterClock: true });
      let result = await request(app).get("/p4p/summary?period=30d");
      expect(result.status).toBe(200);
      expect(result.body.technicians[0]).toMatchObject({ userId: owner.id, baseHourlyRate: 25, clockHours: 4, basePay: 100, p4pEarnings: 0, grossPay: 100 });
      const [job] = await db.insert(jobsTable).values({ tenantId: tenant.id, title: "Priced test job", assigneeId: owner.id, scheduledAt: start, completedAt: end, status: "completed", totalAmount: 1000, jobParts: [{ total: 100 }] }).returning();
      result = await request(app).get("/p4p/summary?period=30d");
      expect(result.body.technicians[0]).toMatchObject({ basePay: 100, p4pEarnings: 180, grossPay: 180 });
      const [service] = await db.insert(servicesTable).values({ tenantId: tenant.id, name: "QA P4P service", p4pPercentage: 30 }).returning();
      await db.update(jobsTable).set({ serviceId: service.id }).where(eq(jobsTable.id, job.id));
      result = await request(app).get("/p4p/summary?period=30d");
      expect(result.body.technicians[0]).toMatchObject({ basePay: 100, p4pEarnings: 270, grossPay: 270 });
      const breakdown = await request(app).get("/p4p/jobs?period=30d");
      expect(breakdown.body[0]).toMatchObject({ p4pPct: 30, p4pPool: 270, usingGlobalRate: false });
      await db.update(jobsTable).set({ totalAmount: 0 }).where(eq(jobsTable.id, job.id));
      result = await request(app).get("/p4p/summary?period=30d");
      expect(result.body.technicians[0]).toMatchObject({ basePay: 100, p4pEarnings: 0, grossPay: 100 });
      const enabled = await request(app).get("/efficiency?period=30d");
      expect(enabled.status).toBe(200);
      expect(enabled.body.technicians.some((u: { userId: number }) => u.userId === owner.id)).toBe(true);
      await db.update(tenantsTable).set({ ownersSchedulable: false }).where(eq(tenantsTable.id, tenant.id));
      expect((await request(app).get("/efficiency?period=30d")).body.technicians).toHaveLength(0);
      expect((await request(app).get("/p4p/summary?period=30d")).body.technicians).toHaveLength(0);
    } finally {
      await db.delete(timeEntriesTable).where(eq(timeEntriesTable.tenantId, tenant.id));
      await db.delete(jobsTable).where(eq(jobsTable.tenantId, tenant.id));
      await db.delete(servicesTable).where(eq(servicesTable.tenantId, tenant.id));
      await db.delete(usersTable).where(eq(usersTable.tenantId, tenant.id));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenant.id));
    }
  });
});
