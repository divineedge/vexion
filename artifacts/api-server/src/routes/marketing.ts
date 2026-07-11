import { Router, type IRouter } from "express";
import { db, marketingCampaignsTable, campaignCustomersTable, customersTable, invoicesTable } from "@workspace/db";
import { eq, and, sum, count, desc, sql } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";
import { syncCustomerToMailchimp } from "../lib/mailchimpSync";

const router: IRouter = Router();

// GET /marketing/campaigns
router.get("/marketing/campaigns", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const campaigns = await db
    .select()
    .from(marketingCampaignsTable)
    .where(eq(marketingCampaignsTable.tenantId, tenantId))
    .orderBy(desc(marketingCampaignsTable.createdAt));

  // Get customer counts per campaign
  const customerCounts = await db
    .select({
      campaignId: campaignCustomersTable.campaignId,
      customerCount: count().mapWith(Number),
    })
    .from(campaignCustomersTable)
    .where(eq(campaignCustomersTable.tenantId, tenantId))
    .groupBy(campaignCustomersTable.campaignId);

  // Revenue from campaign customers (paid invoices only)
  const revenueRows = await db.execute(sql`
    SELECT
      cc.campaign_id,
      SUM(i.total) AS revenue
    FROM campaign_customers cc
    JOIN invoices i ON i.customer_id = cc.customer_id
    WHERE cc.tenant_id = ${tenantId}
      AND i.tenant_id = ${tenantId}
      AND i.status = 'paid'
    GROUP BY cc.campaign_id
  `);

  const countMap = new Map<number, number>();
  for (const r of customerCounts) countMap.set(r.campaignId, r.customerCount);

  const revenueMap = new Map<number, number>();
  for (const r of revenueRows.rows as { campaign_id: number; revenue: string }[]) {
    revenueMap.set(Number(r.campaign_id), Number(r.revenue ?? 0));
  }

  const result = campaigns.map(c => {
    const revenue = revenueMap.get(c.id) ?? 0;
    const budget = Number(c.budget ?? 0);
    const roas = budget > 0 ? Math.round((revenue / budget) * 100) / 100 : null;
    return {
      ...c,
      budget: Number(c.budget),
      customerCount: countMap.get(c.id) ?? 0,
      totalRevenue: revenue,
      roas,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  });

  res.json(result);
});

// POST /marketing/campaigns
router.post("/marketing/campaigns", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, channel, budget, startDate, endDate, notes } = req.body;

  if (!name || !channel) {
    res.status(400).json({ error: "name and channel are required" });
    return;
  }

  const [campaign] = await db
    .insert(marketingCampaignsTable)
    .values({
      tenantId,
      name,
      channel,
      budget: String(budget ?? 0),
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      notes: notes ?? null,
    })
    .returning();

  res.status(201).json({ ...campaign, budget: Number(campaign.budget), customerCount: 0, totalRevenue: 0, roas: null, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString() });
});

// PATCH /marketing/campaigns/:id
router.patch("/marketing/campaigns/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, channel, budget, startDate, endDate, notes } = req.body;

  const updates: Partial<typeof marketingCampaignsTable.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (channel !== undefined) updates.channel = channel;
  if (budget !== undefined) updates.budget = String(budget);
  if (startDate !== undefined) updates.startDate = startDate;
  if (endDate !== undefined) updates.endDate = endDate;
  if (notes !== undefined) updates.notes = notes;

  const [updated] = await db
    .update(marketingCampaignsTable)
    .set(updates)
    .where(and(eq(marketingCampaignsTable.id, id), eq(marketingCampaignsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({ ...updated, budget: Number(updated.budget), createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

// DELETE /marketing/campaigns/:id
router.delete("/marketing/campaigns/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  // Delete customer links first
  await db.delete(campaignCustomersTable).where(and(eq(campaignCustomersTable.campaignId, id), eq(campaignCustomersTable.tenantId, tenantId)));
  await db.delete(marketingCampaignsTable).where(and(eq(marketingCampaignsTable.id, id), eq(marketingCampaignsTable.tenantId, tenantId)));
  res.status(204).send();
});

// GET /marketing/campaigns/:id/customers
router.get("/marketing/campaigns/:id/customers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const rows = await db
    .select({ link: campaignCustomersTable, customerName: customersTable.name, customerEmail: customersTable.email })
    .from(campaignCustomersTable)
    .leftJoin(customersTable, eq(campaignCustomersTable.customerId, customersTable.id))
    .where(and(eq(campaignCustomersTable.campaignId, id), eq(campaignCustomersTable.tenantId, tenantId)));

  res.json(rows.map(r => ({
    ...r.link,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    acquiredAt: r.link.acquiredAt.toISOString(),
  })));
});

// POST /marketing/campaigns/:id/customers
router.post("/marketing/campaigns/:id/customers", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const campaignId = parseInt(req.params.id, 10);
  const { customerId, notes } = req.body;

  if (!customerId) { res.status(400).json({ error: "customerId is required" }); return; }

  // Validate campaign belongs to this tenant
  const [campaignCheck] = await db
    .select({ id: marketingCampaignsTable.id })
    .from(marketingCampaignsTable)
    .where(and(eq(marketingCampaignsTable.id, campaignId), eq(marketingCampaignsTable.tenantId, tenantId)));
  if (!campaignCheck) { res.status(404).json({ error: "Campaign not found" }); return; }

  // Validate customer belongs to this tenant
  const [customerCheck] = await db
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(and(eq(customersTable.id, parseInt(customerId, 10)), eq(customersTable.tenantId, tenantId)));
  if (!customerCheck) { res.status(404).json({ error: "Customer not found" }); return; }

  // Idempotent — ignore if already linked
  const [existing] = await db
    .select({ id: campaignCustomersTable.id })
    .from(campaignCustomersTable)
    .where(and(
      eq(campaignCustomersTable.campaignId, campaignId),
      eq(campaignCustomersTable.customerId, parseInt(customerId, 10)),
      eq(campaignCustomersTable.tenantId, tenantId),
    ));
  if (existing) { res.status(200).json({ message: "Already linked" }); return; }

  const [link] = await db
    .insert(campaignCustomersTable)
    .values({ tenantId, campaignId, customerId: parseInt(customerId, 10), notes: notes ?? null })
    .returning();

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, parseInt(customerId, 10)));
  if (customer) void syncCustomerToMailchimp(tenantId, customer);

  res.status(201).json({ ...link, acquiredAt: link.acquiredAt.toISOString() });
});

// DELETE /marketing/campaigns/:id/customers/:customerId
router.delete("/marketing/campaigns/:id/customers/:customerId", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const campaignId = parseInt(req.params.id, 10);
  const customerId = parseInt(req.params.customerId, 10);
  await db.delete(campaignCustomersTable).where(and(
    eq(campaignCustomersTable.campaignId, campaignId),
    eq(campaignCustomersTable.customerId, customerId),
    eq(campaignCustomersTable.tenantId, tenantId),
  ));
  res.status(204).send();
});

// GET /marketing/roas — ranked ROAS leaderboard across all campaigns
router.get("/marketing/roas", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const rows = await db.execute(sql`
    SELECT
      mc.id,
      mc.name,
      mc.channel,
      mc.budget::numeric AS budget,
      mc.start_date,
      mc.end_date,
      COUNT(DISTINCT cc.customer_id) AS customer_count,
      COALESCE(SUM(i.total) FILTER (WHERE i.status = 'paid'), 0) AS revenue
    FROM marketing_campaigns mc
    LEFT JOIN campaign_customers cc ON cc.campaign_id = mc.id AND cc.tenant_id = mc.tenant_id
    LEFT JOIN invoices i ON i.customer_id = cc.customer_id AND i.tenant_id = mc.tenant_id
    WHERE mc.tenant_id = ${tenantId}
    GROUP BY mc.id
    ORDER BY
      CASE WHEN mc.budget::numeric > 0
        THEN COALESCE(SUM(i.total) FILTER (WHERE i.status = 'paid'), 0) / mc.budget::numeric
        ELSE 0
      END DESC
  `);

  const leaderboard = (rows.rows as {
    id: number; name: string; channel: string; budget: string;
    customer_count: string; revenue: string;
  }[]).map(r => {
    const budget = Number(r.budget ?? 0);
    const revenue = Number(r.revenue ?? 0);
    const roas = budget > 0 ? Math.round((revenue / budget) * 100) / 100 : null;
    return {
      id: Number(r.id),
      name: r.name,
      channel: r.channel,
      budget,
      customerCount: Number(r.customer_count ?? 0),
      totalRevenue: revenue,
      roas,
      roasLabel: roas != null ? `${roas.toFixed(1)}x` : "N/A",
    };
  });

  res.json(leaderboard);
});

export default router;
