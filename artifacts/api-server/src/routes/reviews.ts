import { Router, type IRouter } from "express";
import { db, reviewRequestsTable, customersTable, tenantsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";
import { sendReviewRequest } from "../lib/reviewService";

const router: IRouter = Router();

function formatReviewRequest(r: typeof reviewRequestsTable.$inferSelect, customerName?: string | null) {
  return {
    ...r,
    customerName: customerName ?? null,
    checklistSelections: (r.checklistSelections as string[] | null) ?? null,
    sentAt: r.sentAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ── STAFF: LIST ───────────────────────────────────────────────────────────────
router.get("/reviews", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, rating } = req.query as Record<string, string>;

  let where = eq(reviewRequestsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(reviewRequestsTable.reviewStatus, status)) as typeof where;
  if (rating) where = and(where, eq(reviewRequestsTable.rating, parseInt(rating, 10))) as typeof where;

  const rows = await db
    .select({ review: reviewRequestsTable, customerName: customersTable.name })
    .from(reviewRequestsTable)
    .leftJoin(customersTable, eq(reviewRequestsTable.customerId, customersTable.id))
    .where(where)
    .orderBy(desc(reviewRequestsTable.createdAt));

  res.json(rows.map(r => formatReviewRequest(r.review, r.customerName)));
});

// ── STAFF: SUMMARY ────────────────────────────────────────────────────────────
router.get("/reviews/summary", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const rows = await db
    .select({ rating: reviewRequestsTable.rating, checklistSelections: reviewRequestsTable.checklistSelections, createdAt: reviewRequestsTable.createdAt })
    .from(reviewRequestsTable)
    .where(and(eq(reviewRequestsTable.tenantId, tenantId), sql`${reviewRequestsTable.rating} IS NOT NULL`));

  const totalResponses = rows.length;
  const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  const issueCounts = new Map<string, number>();
  let sumRating = 0;

  for (const r of rows) {
    if (r.rating) {
      distribution[String(r.rating)] = (distribution[String(r.rating)] ?? 0) + 1;
      sumRating += r.rating;
    }
    const checklist = (r.checklistSelections as string[] | null) ?? [];
    for (const item of checklist) issueCounts.set(item, (issueCounts.get(item) ?? 0) + 1);
  }

  const topChecklistIssues = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  // Trend: last 6 months, grouped by YYYY-MM
  const trendMap = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const period = r.createdAt.toISOString().slice(0, 7);
    const bucket = trendMap.get(period) ?? { sum: 0, count: 0 };
    bucket.sum += r.rating ?? 0;
    bucket.count += 1;
    trendMap.set(period, bucket);
  }
  const trend = [...trendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([period, { sum, count }]) => ({ period, averageRating: count ? sum / count : 0, responseCount: count }));

  res.json({
    averageRating: totalResponses ? sumRating / totalResponses : 0,
    totalResponses,
    distribution,
    topChecklistIssues,
    trend,
  });
});

// ── STAFF: SEND MANUALLY ──────────────────────────────────────────────────────
router.post("/reviews", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, jobId, invoiceId, estimateId } = req.body;
  if (!customerId) { res.status(400).json({ error: "customerId required" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, parseInt(customerId, 10)), eq(customersTable.tenantId, tenantId)));
  if (!tenant || !customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const created = await sendReviewRequest({
    tenant, customer,
    jobId: jobId ? parseInt(jobId, 10) : null,
    invoiceId: invoiceId ? parseInt(invoiceId, 10) : null,
    estimateId: estimateId ? parseInt(estimateId, 10) : null,
  });
  if (!created) { res.status(400).json({ error: "Customer has no usable contact channel (opted out of SMS and email, or missing both)" }); return; }

  res.status(201).json(formatReviewRequest(created, customer.name));
});

// ── STAFF: UPDATE STATUS/NOTE ─────────────────────────────────────────────────
router.patch("/reviews/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { reviewStatus, reviewNote } = req.body;

  const updates: Partial<typeof reviewRequestsTable.$inferInsert> = {};
  if (reviewStatus !== undefined) updates.reviewStatus = reviewStatus;
  if (reviewNote !== undefined) updates.reviewNote = reviewNote;

  const [updated] = await db.update(reviewRequestsTable).set(updates)
    .where(and(eq(reviewRequestsTable.id, id), eq(reviewRequestsTable.tenantId, tenantId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [customer] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json(formatReviewRequest(updated, customer?.name));
});

// ── PUBLIC: GET REVIEW PAGE DATA ──────────────────────────────────────────────
router.get("/public/reviews/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const [row] = await db
    .select({ review: reviewRequestsTable, tenant: tenantsTable })
    .from(reviewRequestsTable)
    .leftJoin(tenantsTable, eq(reviewRequestsTable.tenantId, tenantsTable.id))
    .where(eq(reviewRequestsTable.token, token));

  if (!row?.review || !row.tenant) { res.status(404).json({ error: "Review not found" }); return; }

  res.json({
    token,
    tenantId: row.tenant.id,
    companyName: row.tenant.name,
    status: row.review.rating ? "rated" : "pending",
    rating: row.review.rating ?? null,
    googleUrl: row.tenant.reviewGoogleUrl ?? null,
    facebookUrl: row.tenant.reviewFacebookUrl ?? null,
    customLink1Label: row.tenant.reviewCustomLink1Label ?? null,
    customLink1Url: row.tenant.reviewCustomLink1Url ?? null,
    customLink2Label: row.tenant.reviewCustomLink2Label ?? null,
    customLink2Url: row.tenant.reviewCustomLink2Url ?? null,
  });
});

// ── PUBLIC: SUBMIT RATING ─────────────────────────────────────────────────────
router.post("/public/reviews/:token/rating", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { rating } = req.body;
  if (!rating || rating < 1 || rating > 5) { res.status(400).json({ error: "rating must be 1-5" }); return; }

  const [row] = await db
    .select({ review: reviewRequestsTable, tenant: tenantsTable })
    .from(reviewRequestsTable)
    .leftJoin(tenantsTable, eq(reviewRequestsTable.tenantId, tenantsTable.id))
    .where(eq(reviewRequestsTable.token, token));
  if (!row?.review || !row.tenant) { res.status(404).json({ error: "Review not found" }); return; }

  const [updated] = await db.update(reviewRequestsTable)
    .set({ rating, respondedAt: new Date() })
    .where(eq(reviewRequestsTable.token, token))
    .returning();

  res.json({
    token,
    tenantId: row.tenant.id,
    companyName: row.tenant.name,
    status: "rated",
    rating: updated.rating,
    googleUrl: row.tenant.reviewGoogleUrl ?? null,
    facebookUrl: row.tenant.reviewFacebookUrl ?? null,
    customLink1Label: row.tenant.reviewCustomLink1Label ?? null,
    customLink1Url: row.tenant.reviewCustomLink1Url ?? null,
    customLink2Label: row.tenant.reviewCustomLink2Label ?? null,
    customLink2Url: row.tenant.reviewCustomLink2Url ?? null,
  });
});

// ── PUBLIC: SUBMIT STRUCTURED FEEDBACK (1-4 STARS) ────────────────────────────
router.post("/public/reviews/:token/feedback", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { checklistSelections, feedbackText, improvementText } = req.body;

  const [row] = await db
    .select({ review: reviewRequestsTable, tenant: tenantsTable })
    .from(reviewRequestsTable)
    .leftJoin(tenantsTable, eq(reviewRequestsTable.tenantId, tenantsTable.id))
    .where(eq(reviewRequestsTable.token, token));
  if (!row?.review || !row.tenant) { res.status(404).json({ error: "Review not found" }); return; }

  const [updated] = await db.update(reviewRequestsTable)
    .set({
      checklistSelections: checklistSelections ?? [],
      feedbackText: feedbackText ?? null,
      improvementText: improvementText ?? null,
    })
    .where(eq(reviewRequestsTable.token, token))
    .returning();

  res.json({
    token,
    tenantId: row.tenant.id,
    companyName: row.tenant.name,
    status: updated.rating ? "rated" : "pending",
    rating: updated.rating ?? null,
    googleUrl: row.tenant.reviewGoogleUrl ?? null,
    facebookUrl: row.tenant.reviewFacebookUrl ?? null,
    customLink1Label: row.tenant.reviewCustomLink1Label ?? null,
    customLink1Url: row.tenant.reviewCustomLink1Url ?? null,
    customLink2Label: row.tenant.reviewCustomLink2Label ?? null,
    customLink2Url: row.tenant.reviewCustomLink2Url ?? null,
  });
});

// ── PUBLIC: MARK REDIRECTED (5-STAR ONLY) ─────────────────────────────────────
router.post("/public/reviews/:token/redirect", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [row] = await db
    .select({ review: reviewRequestsTable, tenant: tenantsTable })
    .from(reviewRequestsTable)
    .leftJoin(tenantsTable, eq(reviewRequestsTable.tenantId, tenantsTable.id))
    .where(eq(reviewRequestsTable.token, token));
  if (!row?.review || !row.tenant) { res.status(404).json({ error: "Review not found" }); return; }

  const [updated] = await db.update(reviewRequestsTable)
    .set({ publicRedirected: true })
    .where(eq(reviewRequestsTable.token, token))
    .returning();

  res.json({
    token,
    tenantId: row.tenant.id,
    companyName: row.tenant.name,
    status: updated.rating ? "rated" : "pending",
    rating: updated.rating ?? null,
    googleUrl: row.tenant.reviewGoogleUrl ?? null,
    facebookUrl: row.tenant.reviewFacebookUrl ?? null,
    customLink1Label: row.tenant.reviewCustomLink1Label ?? null,
    customLink1Url: row.tenant.reviewCustomLink1Url ?? null,
    customLink2Label: row.tenant.reviewCustomLink2Label ?? null,
    customLink2Url: row.tenant.reviewCustomLink2Url ?? null,
  });
});

export default router;
