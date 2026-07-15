import { Router, type IRouter } from "express";
import { db, quotesTable, propertiesTable, customersTable, servicesTable, jobsTable, blueprintsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";
import crypto from "crypto";

const router: IRouter = Router();

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function formatQuote(q: typeof quotesTable.$inferSelect) {
  return {
    ...q,
    selectedZoneLabels: (q.selectedZoneLabels as string[]) ?? [],
    expiresAt: q.expiresAt?.toISOString() ?? null,
    respondedAt: q.respondedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

// POST /properties/:id/quotes — create an instant quote
router.post("/properties/:id/quotes", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const propertyId = parseInt(req.params.id, 10);

  const { serviceId, selectedZoneLabels, totalAreaSqft, priceType, blueprintId } = req.body;

  const [property] = await db
    .select({ property: propertiesTable, customerName: customersTable.name })
    .from(propertiesTable)
    .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)));

  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  // Validate blueprintId belongs to this tenant (and ideally the same property)
  let resolvedBlueprintId: number | null = null;
  if (blueprintId) {
    const bpId = parseInt(blueprintId, 10);
    const [bp] = await db
      .select({ id: blueprintsTable.id })
      .from(blueprintsTable)
      .where(and(eq(blueprintsTable.id, bpId), eq(blueprintsTable.tenantId, tenantId)));
    if (!bp) { res.status(404).json({ error: "Blueprint not found" }); return; }
    resolvedBlueprintId = bp.id;
  }

  let serviceName = "Custom Quote";
  let serviceDescription: string | null = null;
  let calculatedPrice = 0;
  const resolvedPriceType = priceType ?? "flat";

  if (serviceId) {
    const [service] = await db
      .select()
      .from(servicesTable)
      .where(and(eq(servicesTable.id, parseInt(serviceId, 10)), eq(servicesTable.tenantId, tenantId)));

    if (service) {
      serviceName = service.name;
      serviceDescription = service.description ?? null;
      if (resolvedPriceType === "per_sqft" && totalAreaSqft) {
        calculatedPrice = service.basePrice * totalAreaSqft;
      } else {
        calculatedPrice = service.basePrice;
      }
    }
  } else if (req.body.calculatedPrice !== undefined) {
    calculatedPrice = parseFloat(req.body.calculatedPrice);
    serviceName = req.body.serviceName ?? "Custom Quote";
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [quote] = await db.insert(quotesTable).values({
    tenantId,
    propertyId,
    token: generateToken(),
    serviceId: serviceId ? parseInt(serviceId, 10) : null,
    blueprintId: resolvedBlueprintId,
    serviceName,
    serviceDescription,
    selectedZoneLabels: selectedZoneLabels ?? [],
    totalAreaSqft: totalAreaSqft ?? null,
    calculatedPrice,
    priceType: resolvedPriceType,
    status: "pending",
    expiresAt,
  }).returning();

  res.status(201).json(formatQuote(quote));
});

// GET /properties/:id/quotes — list quotes for a property
router.get("/properties/:id/quotes", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const propertyId = parseInt(req.params.id, 10);

  const quotes = await db
    .select()
    .from(quotesTable)
    .where(and(eq(quotesTable.propertyId, propertyId), eq(quotesTable.tenantId, tenantId)))
    .orderBy(quotesTable.createdAt);

  res.json(quotes.map(formatQuote));
});

// GET /quotes/:token — public route (no auth required)
router.get("/quotes/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [row] = await db
    .select({
      quote: quotesTable,
      property: propertiesTable,
      customerName: customersTable.name,
    })
    .from(quotesTable)
    .leftJoin(propertiesTable, eq(quotesTable.propertyId, propertiesTable.id))
    .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
    .where(eq(quotesTable.token, token));

  if (!row) { res.status(404).json({ error: "Quote not found" }); return; }

  const q = row.quote;
  const now = new Date();
  const expired = q.expiresAt && q.expiresAt < now;

  res.json({
    ...formatQuote(q),
    property: row.property ? {
      id: row.property.id,
      address: row.property.address,
      city: row.property.city,
      state: row.property.state,
      zip: row.property.zip,
      lat: row.property.lat,
      lng: row.property.lng,
      measurementPolygons: (row.property.measurementPolygons as unknown[]) ?? [],
      serviceableAreaSqft: row.property.serviceableAreaSqft,
      customerName: row.customerName ?? null,
    } : null,
    expired: !!expired,
  });
});

// POST /quotes/:token/respond — public: approve or decline
router.post("/quotes/:token/respond", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { action, customerNote } = req.body; // action: 'approved' | 'declined'

  if (!["approved", "declined"].includes(action)) {
    res.status(400).json({ error: "action must be 'approved' or 'declined'" });
    return;
  }

  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.token, token));
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }
  if (quote.status !== "pending") {
    res.status(409).json({ error: `Quote already ${quote.status}` });
    return;
  }
  if (quote.expiresAt && quote.expiresAt < new Date()) {
    res.status(410).json({ error: "Quote has expired" });
    return;
  }

  const [updated] = await db
    .update(quotesTable)
    .set({
      status: action,
      respondedAt: new Date(),
      customerNote: customerNote ?? null,
    })
    .where(eq(quotesTable.token, token))
    .returning();

  // A declined quote means the design it was generated from isn't going forward — archive the
  // linked blueprint so it drops out of the main Blueprints list but stays reachable from the property.
  if (action === "declined" && updated.blueprintId) {
    await db.update(blueprintsTable)
      .set({ isArchived: true, archivedAt: new Date() })
      .where(and(eq(blueprintsTable.id, updated.blueprintId), eq(blueprintsTable.tenantId, updated.tenantId)));
  }

  // If approved, create a draft estimate (pending job)
  if (action === "approved" && quote.propertyId) {
    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, quote.propertyId));
    if (property) {
      await db.insert(jobsTable).values({
        tenantId: quote.tenantId,
        title: `Quote Estimate: ${quote.serviceName}`,
        description: `Approved instant quote. ${quote.totalAreaSqft ? `Area: ${quote.totalAreaSqft.toFixed(0)} sqft.` : ""} ${customerNote ? `Customer note: ${customerNote}` : ""}`.trim(),
        status: "scheduled",
        priority: "normal",
        customerId: property.customerId,
        propertyId: quote.propertyId,
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        totalAmount: quote.calculatedPrice,
      });
    }
  }

  res.json(formatQuote(updated));
});

export default router;
