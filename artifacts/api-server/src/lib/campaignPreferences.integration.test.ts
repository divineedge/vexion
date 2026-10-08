import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, tenantsTable, customersTable, marketingCampaignsTable, broadcastsTable, campaignResponsesTable, campaignCustomersTable } from "@workspace/db";
import { applyCampaignPreference, campaignEmail, marketingEmailAllowed, validateCampaignDestination } from "./campaignPreferences";
import { resolveRecipients } from "../routes/broadcasts";
import express from "express";
import request from "supertest";
import preferencesRouter from "../routes/campaignPreferences";
const app = express(); app.use(express.json()); app.use(preferencesRouter);

describe("campaign preference isolation, enrollment and consent", () => {
  let tenant: number, customer: number, source: number, destination: number, broadcast: number, token: string;
  beforeAll(async () => {
    [tenant] = (await db.insert(tenantsTable).values({ name: `__campaign_test_${randomUUID()}` }).returning()).map(r => r.id);
    [customer] = (await db.insert(customersTable).values({ tenantId: tenant, name: "Synthetic", email: "synthetic@example.invalid", phone: "" }).returning()).map(r => r.id);
    [source, destination] = (await db.insert(marketingCampaignsTable).values([{ tenantId: tenant, name: "Original", channel: "other" }, { tenantId: tenant, name: "Later", channel: "other" }]).returning()).map(r => r.id);
    await db.insert(campaignCustomersTable).values({ tenantId: tenant, campaignId: source, customerId: customer });
    [broadcast] = (await db.insert(broadcastsTable).values({ tenantId: tenant, channel: "email", body: "Hello <customer>", recipientFilter: { campaignId: source }, notInterestedCampaignId: destination }).returning()).map(r => r.id);
  });
  afterAll(async () => {
    if (!tenant) return;
    await db.delete(campaignResponsesTable).where(eq(campaignResponsesTable.tenantId, tenant));
    await db.delete(broadcastsTable).where(eq(broadcastsTable.tenantId, tenant));
    await db.delete(campaignCustomersTable).where(eq(campaignCustomersTable.tenantId, tenant));
    await db.delete(marketingCampaignsTable).where(eq(marketingCampaignsTable.tenantId, tenant));
    await db.delete(customersTable).where(eq(customersTable.tenantId, tenant));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenant));
  });
  it("rejects missing, same-source, and cross-tenant destinations", async () => {
    await expect(validateCampaignDestination(tenant, undefined, source)).rejects.toThrow();
    await expect(validateCampaignDestination(tenant, source, source)).rejects.toThrow();
    await expect(validateCampaignDestination(-1, destination, source)).rejects.toThrow();
  });
  it("includes both buttons and does not mutate preferences from an email scanner GET", async () => {
    const email = await campaignEmail(tenant, broadcast, customer, "Hello <customer>");
    expect(email.html).toContain("Not interested right now");
    expect(email.html).toContain("Unsubscribe");
    expect(email.html).toContain("&lt;customer&gt;");
    token = email.text.match(/campaign-preferences\/([a-f0-9]+)/)![1];
    const preview = await request(app).get(`/public/campaign-preferences/${token}?action=not_interested`);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain('method="post"');
    expect(await marketingEmailAllowed(tenant, customer, source)).toBe(true);
    expect((await resolveRecipients(tenant, "email", { campaignId: destination })).length).toBe(0);
  });
  it("moves campaign audience once, suppresses source, and preserves original acquisition metrics", async () => {
    await Promise.all([applyCampaignPreference(token, "not_interested"), applyCampaignPreference(token, "not_interested")]);
    expect(await marketingEmailAllowed(tenant, customer, source)).toBe(false);
    expect((await resolveRecipients(tenant, "email", { campaignId: source })).length).toBe(0);
    expect((await resolveRecipients(tenant, "email", { campaignId: destination })).map(r => r.id)).toEqual([customer]);
    expect((await db.select().from(campaignCustomersTable).where(eq(campaignCustomersTable.tenantId, tenant))).map(r => r.campaignId)).toEqual([source]);
    expect((await db.select().from(customersTable).where(eq(customersTable.id, customer)))[0].emailOptOut).toBe(false);
  });
  it("unsubscribe always wins, even if an old not-interested link is clicked again", async () => {
    await applyCampaignPreference(token, "unsubscribe");
    await applyCampaignPreference(token, "not_interested");
    expect(await marketingEmailAllowed(tenant, customer, destination)).toBe(false);
    expect((await resolveRecipients(tenant, "email", { allCustomers: true })).length).toBe(0);
    expect((await request(app).post("/public/campaign-preferences/bogus").send({ action: "unsubscribe" })).status).toBe(400);
  });
});
