import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

vi.mock("../lib/weatherCheck", () => ({
  checkRainBeforeWindow: vi.fn(async () => ({ probability: 82, forecastTime: new Date().toISOString() })),
}));

const fixture = vi.hoisted(() => ({ connection: null as any }));
vi.mock("@workspace/db", async (original) => {
  const module = await original<typeof import("@workspace/db")>();
  return {
    ...module,
    db: new Proxy(module.db, {
      get(target, key) {
        const active = fixture.connection ?? target;
        const value = active[key];
        return typeof value === "function" ? value.bind(active) : value;
      },
    }),
  };
});

import { and, eq } from "drizzle-orm";
import {
  billingEmailQueueTable, customersTable, db, equipmentMaintenanceTable, equipmentTable, estimatesTable,
  followupQueueItemsTable, inventoryItemsTable, invoicesTable, jobsTable, pool, portalMessagesTable, propertiesTable,
  servicesTable, staffSessionsTable, tenantsTable, timeEntriesTable, usersTable,
} from "@workspace/db";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import operationsRouter from "./operationsDashboard";
import chemicalConditionsRouter from "./chemicalConditions";
import { defaultLayout } from "../lib/operationsDashboard";

const RUN = !!process.env.DATABASE_URL;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

describe.skipIf(!RUN)("operations dashboard", () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { void requireVerifiedStaff(req, res, next); });
  app.use(operationsRouter);
  app.use(chemicalConditionsRouter);

  let fixtureClient: { query: (text: string) => Promise<unknown>; release: () => void };
  let savepoint = 0;
  let tenantId = 0;
  let ownerId = 0;
  let otherId = 0;
  let techId = 0;
  let ownerToken = "";
  let otherToken = "";
  let techToken = "";
  let messageId = 0;
  let estimateId = 0;
  let equipmentId = 0;
  let followupId = 0;
  let rainJobId = 0;
  let draftInvoiceId = 0;
  let overdueInvoiceId = 0;
  let closeInvoiceId = 0;
  let laterInvoiceId = 0;

  const auth = (token: string) => ({ "x-staff-session": token });

  beforeAll(async () => {
    await pool.query(readFileSync(new URL("../../../../lib/db/drizzle/0115_operations_dashboard.sql", import.meta.url), "utf8"));
    await pool.query(readFileSync(new URL("../../../../lib/db/drizzle/0116_dashboard_widgets.sql", import.meta.url), "utf8"));
    fixtureClient = await pool.connect();
    await fixtureClient.query("BEGIN");
    const base = drizzle(fixtureClient);
    fixture.connection = new Proxy(base, {
      get(target, key) {
        if (key === "transaction") return async (fn: (tx: typeof base) => Promise<unknown>) => {
          const name = `ops_${++savepoint}`;
          await fixtureClient.query(`SAVEPOINT ${name}`);
          try {
            const result = await fn(fixture.connection);
            await fixtureClient.query(`RELEASE SAVEPOINT ${name}`);
            return result;
          } catch (error) {
            await fixtureClient.query(`ROLLBACK TO SAVEPOINT ${name}`);
            await fixtureClient.query(`RELEASE SAVEPOINT ${name}`);
            throw error;
          }
        };
        const value = (target as any)[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const suffix = randomBytes(4).toString("hex");
    const [tenant] = await db.insert(tenantsTable).values({
      name: `Ops ${suffix}`, timezone: "UTC",
      equipmentCategoryThresholds: [{ category: "mower", warnHours: 10 }],
    }).returning();
    tenantId = tenant.id;
    const [owner, other, tech] = await db.insert(usersTable).values([
      { tenantId, name: "Ops Owner", email: `ops-owner-${suffix}@example.invalid`, role: "company_owner", passwordHash: "mock", hourlyRate: 20 },
      { tenantId, name: "Ops Other", email: `ops-other-${suffix}@example.invalid`, role: "office_manager", passwordHash: "mock" },
      { tenantId, name: "Ops Tech", email: `ops-tech-${suffix}@example.invalid`, role: "technician", passwordHash: "mock" },
    ]).returning();
    ownerId = owner.id;
    otherId = other.id;
    techId = tech.id;
    ownerToken = `ops-owner-${suffix}`;
    otherToken = `ops-other-${suffix}`;
    techToken = `ops-tech-${suffix}`;
    await db.insert(staffSessionsTable).values([
      { tenantId, userId: ownerId, tokenHash: hash(ownerToken), expiresAt: new Date(Date.now() + 3600_000) },
      { tenantId, userId: otherId, tokenHash: hash(otherToken), expiresAt: new Date(Date.now() + 3600_000) },
      { tenantId, userId: techId, tokenHash: hash(techToken), expiresAt: new Date(Date.now() + 3600_000) },
    ]);

    const [customer] = await db.insert(customersTable).values({
      tenantId, name: "Casey Customer", email: `casey-${suffix}@example.invalid`, phone: "555-0100",
    }).returning();
    const [property] = await db.insert(propertiesTable).values({
      tenantId, customerId: customer.id, address: "1 Field Lane", lat: 39.7, lng: -104.9,
    }).returning();
    const [service] = await db.insert(servicesTable).values({
      tenantId, name: "Lawn spray", fieldRequirements: { requiresChemicalApplication: true },
    }).returning();
    const [message] = await db.insert(portalMessagesTable).values({
      tenantId, customerId: customer.id, direction: "inbound", body: "Please call me about the gate code",
    }).returning();
    messageId = message.id;
    const [estimate] = await db.insert(estimatesTable).values({
      tenantId, customerId: customer.id, status: "approved", total: 240, approvedAt: new Date(),
    }).returning();
    estimateId = estimate.id;
    const [equipment] = await db.insert(equipmentTable).values({
      tenantId, name: "Mower 1", type: "mower", currentHours: 40,
    }).returning();
    equipmentId = equipment.id;
    await db.insert(equipmentMaintenanceTable).values({
      tenantId, equipmentId, date: "2026-01-01", description: "Oil", nextServiceDueHours: 10,
    });
    const [followup] = await db.insert(followupQueueItemsTable).values({
      tenantId, customerId: customer.id, triggerType: "sent_estimate", reason: "Estimate sent with no reply",
    }).returning();
    followupId = followup.id;
    const now = new Date();
    await db.insert(jobsTable).values({
      tenantId, customerId: customer.id, title: "Finished mow", status: "completed",
      scheduledAt: now, completedAt: now, totalAmount: 120, assigneeId: ownerId,
    });
    const [rainJob] = await db.insert(jobsTable).values({
      tenantId, customerId: customer.id, propertyId: property.id, serviceId: service.id,
      title: "Spray today", status: "scheduled", scheduledAt: now,
    }).returning();
    rainJobId = rainJob.id;
    const [draftInvoice, closeInvoice, overdueInvoice, laterInvoice] = await db.insert(invoicesTable).values([
      { tenantId, customerId: customer.id, invoiceNumber: `DRF-${suffix}`, status: "draft", total: 55, dueDate: new Date(Date.now() + 10 * 86400000) },
      { tenantId, customerId: customer.id, invoiceNumber: `OPN-${suffix}`, status: "sent", total: 40, dueDate: new Date(Date.now() + 86400000) },
      { tenantId, customerId: customer.id, invoiceNumber: `OVR-${suffix}`, status: "sent", total: 25, dueDate: new Date(Date.now() - 86400000) },
      { tenantId, customerId: customer.id, invoiceNumber: `LTR-${suffix}`, status: "sent", total: 15, dueDate: new Date(Date.now() + 30 * 86400000) },
    ]).returning();
    draftInvoiceId = draftInvoice.id;
    closeInvoiceId = closeInvoice.id;
    overdueInvoiceId = overdueInvoice.id;
    laterInvoiceId = laterInvoice.id;
    await db.insert(invoicesTable).values({ tenantId, customerId: customer.id, invoiceNumber: `PAY-${suffix}`, status: "paid", total: 80, paidAt: now, dueDate: now });
    await db.insert(jobsTable).values({
      tenantId, customerId: customer.id, title: "Waiting for a date", status: "waitlist", scheduledAt: now,
    });
    await db.insert(inventoryItemsTable).values([
      { tenantId, name: "Quiet fertilizer", sku: `quiet-${suffix}`, quantity: 0, reorderPoint: 5, stockAlerts: false },
      { tenantId, name: "Loud nozzles", sku: `loud-${suffix}`, quantity: 1, reorderPoint: 5, stockAlerts: true },
      { tenantId, name: "Stocked gloves", sku: `ok-${suffix}`, quantity: 20, reorderPoint: 5, stockAlerts: true },
    ]);
    await db.insert(timeEntriesTable).values({
      tenantId, userId: ownerId, clockedInAt: new Date(Date.now() - 2 * 3600_000), clockedOutAt: now, totalMinutes: 120,
    });
  });

  afterAll(async () => {
    try { await fixtureClient?.query("ROLLBACK"); }
    finally { fixture.connection = null; fixtureClient?.release(); }
  });

  it("gives each user an independent layout and renders the default widgets", async () => {
    const owner = await request(app).get("/dashboard/operations").set(auth(ownerToken));
    expect(owner.status).toBe(200);
    expect(owner.body.layout.widgets.map((widget: { key: string }) => widget.key)).toEqual(defaultLayout().widgets.map(widget => widget.key));
    expect(owner.body.widgets.jobsCompleted.count).toBeGreaterThan(0);
    expect(owner.body.widgets.jobsCompleted.value).toBe(120);
    expect(owner.body.widgets.invoicesRevenue.openCount).toBeGreaterThan(0);
    expect(owner.body.widgets.invoicesRevenue.overdueCount).toBeGreaterThan(0);
    expect(owner.body.widgets.invoicesRevenue.collectedCount).toBeGreaterThan(0);
    expect(owner.body.widgets.payrollSummary.entries).toBeGreaterThan(0);
    expect(owner.body.widgets.schedule.empty).toBe(false);
    expect(owner.body.widgets.reportSnapshots.empty).toBe(false);
    expect(owner.body.widgets.jobWaitlist.jobs.map((job: { title: string }) => job.title)).toContain("Waiting for a date");
    expect(owner.body.widgets.inventoryReorder.items.map((item: { name: string }) => item.name)).toEqual(["Loud nozzles"]);
    expect(owner.body.widgets.invoiceAttention.toSend.map((invoice: { id: number }) => invoice.id)).toEqual([draftInvoiceId]);
    expect(owner.body.widgets.invoiceAttention.due.map((invoice: { id: number }) => invoice.id).sort()).toEqual([closeInvoiceId, overdueInvoiceId].sort());
    expect(owner.body.widgets.invoiceAttention.due.map((invoice: { id: number }) => invoice.id)).not.toContain(laterInvoiceId);
    expect(owner.body.widgets.profitAndLoss.revenue).toBe(80);
    expect(owner.body.widgets.profitAndLoss.netIncome).toBe(80);
    expect(owner.body.tasks.map((task: { source: string }) => task.source).sort()).toEqual([
      "equipment_maintenance", "estimate_response", "followup", "invoice_due", "invoice_due", "invoice_to_send", "portal_message", "rain_warning",
    ]);

    const custom = defaultLayout();
    custom.widgets = custom.widgets.map(widget => widget.key === "payroll_summary" ? { ...widget, visible: false, timeframe: "year" as const } : widget);
    const [payroll, ...rest] = [
      custom.widgets.find(widget => widget.key === "invoices_revenue")!,
      ...custom.widgets.filter(widget => widget.key !== "invoices_revenue"),
    ];
    custom.widgets = [payroll, ...rest];
    custom.taskSources = ["portal_message"];
    expect((await request(app).put("/dashboard/layout").set(auth(ownerToken)).send(custom)).status).toBe(200);

    const other = await request(app).get("/dashboard/layout").set(auth(otherToken));
    expect(other.body.widgets.map((widget: { key: string; visible: boolean }) => `${widget.key}:${widget.visible}`)).toEqual(
      defaultLayout().widgets.map(widget => `${widget.key}:${widget.visible}`),
    );
    const saved = await request(app).get("/dashboard/operations").set(auth(ownerToken));
    expect(saved.body.layout.widgets[0].key).toBe("invoices_revenue");
    expect(saved.body.widgets.payrollSummary).toBeNull();
    expect(saved.body.tasks).toHaveLength(1);
    expect(saved.body.tasks[0].source).toBe("portal_message");

    const collapsed = structuredClone(saved.body.layout);
    collapsed.widgets = collapsed.widgets.map((widget: { key: string }) => widget.key === "needs_action" ? { ...widget, minimized: true } : widget);
    expect((await request(app).put("/dashboard/layout").set(auth(ownerToken)).send(collapsed)).status).toBe(200);
    const collapsedOwner = await request(app).get("/dashboard/layout").set(auth(ownerToken));
    expect(collapsedOwner.body.widgets.at(-1)).toMatchObject({ key: "needs_action", minimized: true });
    const otherStillOpen = await request(app).get("/dashboard/layout").set(auth(otherToken));
    expect(otherStillOpen.body.widgets.find((widget: { key: string }) => widget.key === "needs_action").minimized).not.toBe(true);

    const reset = await request(app).post("/dashboard/layout/reset").set(auth(ownerToken));
    expect(reset.body.widgets.every((widget: { visible: boolean }) => widget.visible)).toBe(true);
    const otherAfter = await request(app).get("/dashboard/layout").set(auth(otherToken));
    expect(otherAfter.body.taskSources).toEqual(defaultLayout().taskSources);
  });

  it("hides invoice amounts from a technician", async () => {
    const response = await request(app).get("/dashboard/operations").set(auth(techToken));
    expect(response.status).toBe(200);
    expect(response.body.widgets.invoicesRevenue.restricted).toBe(true);
    expect(response.body.widgets.invoicesRevenue.openTotal).toBeNull();
    expect(response.body.widgets.jobsCompleted.value).toBeNull();
    expect(response.body.widgets.profitAndLoss.restricted).toBe(true);
    expect(response.body.widgets.profitAndLoss.revenue).toBeNull();
    expect(response.body.widgets.invoiceAttention.restricted).toBe(true);
    expect(response.body.widgets.invoiceAttention.toSend[0].total).toBeNull();
  });

  it("completes a portal message, estimate, follow-up, equipment alert, and rain warning on the source", async () => {
    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "portal_message", sourceId: messageId })).status).toBe(200);
    const [message] = await db.select().from(portalMessagesTable).where(eq(portalMessagesTable.id, messageId));
    expect(message.handledAt).toBeTruthy();
    expect(message.handledByUserId).toBe(ownerId);
    expect(message.readAt).toBeTruthy();

    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "estimate_response", sourceId: estimateId })).status).toBe(200);
    const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, estimateId));
    expect(estimate.responseHandledAt).toBeTruthy();

    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "followup", sourceId: followupId })).status).toBe(200);
    const [followup] = await db.select().from(followupQueueItemsTable).where(eq(followupQueueItemsTable.id, followupId));
    expect(followup.status).toBe("resolved");
    expect(followup.communicationNote).toContain("Dashboard");

    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "equipment_maintenance", sourceId: equipmentId })).status).toBe(200);
    const [equipment] = await db.select().from(equipmentTable).where(eq(equipmentTable.id, equipmentId));
    expect(equipment.maintenanceAlertAck).toContain("hours:10");
    expect(equipment.maintenanceAlertAck).toContain("cat:warn:10");

    const day = new Date().toISOString().slice(0, 10);
    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "rain_warning", sourceId: rainJobId, date: day })).status).toBe(200);
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, rainJobId));
    expect(job.rainWarningClearedOn).toBe(day);
    const rain = await request(app).get("/schedule/rain-risk").query({ date: day }).set(auth(ownerToken));
    expect(rain.status).toBe(200);
    expect(rain.body.jobs.map((item: { id: number }) => item.id)).not.toContain(rainJobId);

    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "invoice_to_send", sourceId: draftInvoiceId })).status).toBe(200);
    const [draft] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, draftInvoiceId));
    expect(draft.status).toBe("sent");
    expect(draft.publicToken).toBeTruthy();
    expect(await db.select().from(billingEmailQueueTable).where(eq(billingEmailQueueTable.invoiceId, draftInvoiceId))).toHaveLength(1);
    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "invoice_due", sourceId: overdueInvoiceId })).status).toBe(200);
    const [overdue] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, overdueInvoiceId));
    expect(overdue.status).toBe("sent");
    expect(overdue.dueAttentionHandledAt).toBeTruthy();
    expect(overdue.dueAttentionHandledByUserId).toBe(ownerId);
    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "invoice_due", sourceId: closeInvoiceId })).status).toBe(200);

    const after = await request(app).get("/dashboard/operations").set(auth(ownerToken));
    expect(after.body.tasks).toEqual([]);
    expect(after.body.widgets.invoiceAttention.toSend).toEqual([]);
    expect(after.body.widgets.invoiceAttention.due).toEqual([]);
    expect((await request(app).post("/dashboard/action-tasks/complete").set(auth(ownerToken)).send({ source: "portal_message", sourceId: messageId })).body.alreadyComplete).toBe(true);
  });

  it("rejects another company's task id", async () => {
    const response = await request(app).post("/dashboard/action-tasks/complete").set(auth(otherToken)).send({ source: "portal_message", sourceId: 999999999 });
    expect(response.status).toBe(404);
    const [message] = await db.select({ handledBy: portalMessagesTable.handledByUserId }).from(portalMessagesTable).where(and(
      eq(portalMessagesTable.id, messageId), eq(portalMessagesTable.tenantId, tenantId),
    ));
    expect(message.handledBy).toBe(ownerId);
  });
});
