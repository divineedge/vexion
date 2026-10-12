import { paymentGuardedJobInsert } from "../lib/paymentPolicy";
import { Router, type IRouter } from "express";
import { db, quotesTable, propertiesTable, customersTable, servicesTable, jobsTable, blueprintsTable, tenantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";
import { resolveServicePrice, type PricingTier } from "../lib/pricingMatrix";
import crypto from "crypto";

const router: IRouter = Router();
export const publicQuotesRouter: IRouter = Router();

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

export interface QuoteMeasurementPolygon {
  label?: string;
  zoneTypeId?: string | null;
  areaSqft?: number | null;
  lengthFt?: number | null;
  mode?: "area" | "linear";
  enabled?: boolean;
}

export interface QuoteMeasurementZoneType {
  id: string;
  name: string;
  mode?: "area" | "linear";
}

export function resolveQuoteMeasurements(
  polygons: QuoteMeasurementPolygon[],
  zoneTypes: QuoteMeasurementZoneType[],
  selectedZoneLabels: unknown,
  linkedZoneTypeId?: string | null,
): { areaSqft: number; lengthFt: number; mode: "area" | "linear" } {
  const selectedLabels = new Set(
    Array.isArray(selectedZoneLabels)
      ? selectedZoneLabels.filter((label): label is string => typeof label === "string")
      : [],
  );
  const zoneTypeById = new Map(zoneTypes.map(zoneType => [zoneType.id, zoneType]));
  const zoneTypeByName = new Map(zoneTypes.map(zoneType => [zoneType.name, zoneType]));
  const linkedZoneType = linkedZoneTypeId ? zoneTypeById.get(linkedZoneTypeId) : undefined;

  let areaSqft = 0;
  let lengthFt = 0;
  for (const polygon of polygons) {
    if (polygon.enabled === false || !polygon.label || !selectedLabels.has(polygon.label)) continue;

    const configuredZoneType = (polygon.zoneTypeId ? zoneTypeById.get(polygon.zoneTypeId) : undefined)
      ?? zoneTypeByName.get(polygon.label);
    if (linkedZoneTypeId && configuredZoneType?.id !== linkedZoneTypeId && polygon.zoneTypeId !== linkedZoneTypeId) {
      continue;
    }

    const mode = polygon.mode ?? configuredZoneType?.mode ?? "area";
    if (mode === "linear") {
      lengthFt += polygon.lengthFt ?? 0;
    } else {
      areaSqft += polygon.areaSqft ?? 0;
    }
  }

  return {
    areaSqft,
    lengthFt,
    mode: linkedZoneType?.mode ?? "area",
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
  let resolvedPriceType = ["flat", "per_sqft", "per_linear_ft", "matrix"].includes(priceType)
    ? priceType
    : "flat";
  let resolvedAreaSqft = totalAreaSqft ? parseFloat(totalAreaSqft) : 0;

  if (serviceId) {
    const [service] = await db
      .select()
      .from(servicesTable)
      .where(and(eq(servicesTable.id, parseInt(serviceId, 10)), eq(servicesTable.tenantId, tenantId)));

    if (service) {
      serviceName = service.name;
      serviceDescription = service.description ?? null;
      resolvedPriceType = ["flat", "per_sqft", "per_linear_ft", "matrix"].includes(service.pricingMode)
        ? service.pricingMode
        : "flat";

      const [tenant] = await db
        .select({ measurementZoneTypes: tenantsTable.measurementZoneTypes })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantId));
      const zoneTypes = ((tenant?.measurementZoneTypes as unknown[]) ?? []) as QuoteMeasurementZoneType[];
      const measurements = resolveQuoteMeasurements(
        ((property.property.measurementPolygons as unknown[]) ?? []) as QuoteMeasurementPolygon[],
        zoneTypes,
        selectedZoneLabels,
        service.linkedZoneTypeId,
      );
      resolvedAreaSqft = measurements.areaSqft;

      // Server always resolves the authoritative price from service configuration.
      // Client-supplied calculatedPrice is intentionally ignored for service-backed quotes
      // to prevent price manipulation.
      const matrixQuantity = measurements.mode === "linear"
        ? measurements.lengthFt
        : measurements.areaSqft;
      calculatedPrice = resolveServicePrice(
        resolvedPriceType,
        service.basePrice,
        service.pricingMatrix as PricingTier[] | null,
        resolvedPriceType === "matrix" ? matrixQuantity : measurements.areaSqft,
        measurements.lengthFt,
      );
    }
  } else {
    // No serviceId — custom quote; client supplies price and name
    if (req.body.calculatedPrice !== undefined) {
      calculatedPrice = parseFloat(req.body.calculatedPrice);
    }
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
    totalAreaSqft: resolvedAreaSqft || null,
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
publicQuotesRouter.get("/quotes/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [row] = await db
    .select({
      quote: quotesTable,
      property: propertiesTable,
      customerName: customersTable.name,
      blueprintLastEstimate: blueprintsTable.lastEstimate,
    })
    .from(quotesTable)
    .leftJoin(propertiesTable, eq(quotesTable.propertyId, propertiesTable.id))
    .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
    .leftJoin(blueprintsTable, eq(quotesTable.blueprintId, blueprintsTable.id))
    .where(eq(quotesTable.token, token));

  if (!row) { res.status(404).json({ error: "Quote not found" }); return; }

  const q = row.quote;
  const now = new Date();
  const expired = q.expiresAt && q.expiresAt < now;

  // Include the persisted materials breakdown from the linked blueprint (if any).
  // Customers see name, quantity, unit, and total — cost price details are excluded.
  type EstimatePart = { inventoryItemId: number; name: string; quantity: number; unitPrice: number; total: number; unit?: string; source?: string };
  const rawEstimate = row.blueprintLastEstimate as { parts?: EstimatePart[]; subtotal?: number; overageAmount?: number; total?: number; computedAt?: string } | null;
  const blueprintMaterials = rawEstimate?.parts?.length
    ? {
        parts: rawEstimate.parts.map(p => ({
          name: p.name,
          quantity: p.quantity,
          unit: p.unit ?? "each",
          total: p.total,
        })),
        subtotal: rawEstimate.subtotal ?? 0,
        overageAmount: rawEstimate.overageAmount ?? 0,
        total: rawEstimate.total ?? 0,
        computedAt: rawEstimate.computedAt ?? null,
      }
    : null;

  // Build a blueprint-specific zone summary when the quote is linked to a blueprint and has
  // selected zone labels. Cross-reference the labels against the property's measurement polygons
  // to surface per-zone measurements, so customers can verify they match their property.
  type MeasurementPolygon = {
    id: string;
    label: string;
    areaSqft: number;
    lengthFt?: number | null;
    mode?: "area" | "linear";
    enabled: boolean;
    color: string;
  };
  const polygons = (row.property?.measurementPolygons as MeasurementPolygon[] | null) ?? [];
  const zoneLabels = (q.selectedZoneLabels as string[]) ?? [];
  const blueprintZones = q.blueprintId && zoneLabels.length > 0
    ? {
        zones: zoneLabels.map(label => {
          const poly = polygons.find(p => p.label === label);
          return {
            label,
            areaSqft: poly?.areaSqft ?? null,
            lengthFt: poly?.lengthFt ?? null,
            mode: poly?.mode ?? null,
            color: poly?.color ?? null,
          };
        }),
        totalAreaSqft: q.totalAreaSqft ?? null,
      }
    : null;

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
    blueprintMaterials,
    blueprintZones,
  });
});

// POST /quotes/:token/respond — public: approve or decline
publicQuotesRouter.post("/quotes/:token/respond", async (req, res): Promise<void> => {
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
      await paymentGuardedJobInsert(db).values({
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
