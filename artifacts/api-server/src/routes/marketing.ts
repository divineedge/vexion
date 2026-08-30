import { Router, type IRouter } from "express";
import { db, marketingCampaignsTable, campaignCustomersTable, customersTable, invoicesTable } from "@workspace/db";
import { eq, and, sum, count, desc, isNull, sql } from "drizzle-orm";
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
    .innerJoin(customersTable, and(
      eq(campaignCustomersTable.customerId, customersTable.id),
      eq(customersTable.tenantId, tenantId),
    ))
    .where(and(
      eq(campaignCustomersTable.tenantId, tenantId),
      isNull(customersTable.archivedAt),
    ))
    .groupBy(campaignCustomersTable.campaignId);

  // Revenue from campaign customers (paid invoices only)
  const revenueRows = await db.execute(sql`
    SELECT
      cc.campaign_id,
      SUM(i.total) AS revenue
    FROM campaign_customers cc
    JOIN customers c ON c.id = cc.customer_id AND c.tenant_id = cc.tenant_id
    JOIN invoices i ON i.customer_id = cc.customer_id AND i.tenant_id = cc.tenant_id
    WHERE cc.tenant_id = ${tenantId}
      AND c.archived_at IS NULL
      AND i.archived_at IS NULL
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
      startDate: startDate || null,
      endDate: endDate || null,
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

// GET /marketing/campaigns/:id/customers-revenue?period=30|90|365
// Returns linked customers with their paid invoice totals for the given period.
router.get("/marketing/campaigns/:id/customers-revenue", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const campaignId = parseInt(req.params.id, 10);
  const periodDays = parseInt((req.query.period as string) ?? "30", 10) || 30;
  const sinceDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const rows = await db.execute(sql`
    SELECT
      cc.id,
      cc.campaign_id,
      cc.customer_id,
      cc.acquired_at,
      c.name AS customer_name,
      c.email AS customer_email,
      COALESCE(SUM(CASE WHEN i.status = 'paid' AND i.paid_at >= ${sinceDate} THEN i.total ELSE 0 END), 0) AS period_revenue,
      COUNT(CASE WHEN i.status = 'paid' AND i.paid_at >= ${sinceDate} THEN 1 END)::int AS invoice_count
    FROM campaign_customers cc
     INNER JOIN customers c ON cc.customer_id = c.id AND c.tenant_id = cc.tenant_id
     LEFT JOIN invoices i ON i.customer_id = cc.customer_id
       AND i.tenant_id = ${tenantId}
       AND i.archived_at IS NULL
     WHERE cc.campaign_id = ${campaignId}
       AND cc.tenant_id = ${tenantId}
       AND c.archived_at IS NULL
    GROUP BY cc.id, cc.campaign_id, cc.customer_id, cc.acquired_at, c.name, c.email
    ORDER BY period_revenue DESC, c.name
  `);

  res.json({
    period: periodDays,
    sinceDate: sinceDate.toISOString().slice(0, 10),
    customers: (rows.rows as Record<string, unknown>[]).map(r => ({
      id: r.id,
      campaignId: r.campaign_id,
      customerId: r.customer_id,
      acquiredAt: r.acquired_at,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      periodRevenue: Number(r.period_revenue ?? 0),
      invoiceCount: Number(r.invoice_count ?? 0),
    })),
  });
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
    .where(and(
      eq(customersTable.id, parseInt(customerId, 10)),
      eq(customersTable.tenantId, tenantId),
      isNull(customersTable.archivedAt),
    ));
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
       COUNT(DISTINCT c.id) AS customer_count,
      COALESCE(SUM(i.total) FILTER (WHERE i.status = 'paid'), 0) AS revenue
    FROM marketing_campaigns mc
    LEFT JOIN campaign_customers cc ON cc.campaign_id = mc.id AND cc.tenant_id = mc.tenant_id
     LEFT JOIN customers c ON c.id = cc.customer_id
       AND c.tenant_id = mc.tenant_id
       AND c.archived_at IS NULL
     LEFT JOIN invoices i ON i.customer_id = c.id
       AND i.tenant_id = mc.tenant_id
       AND i.archived_at IS NULL
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
