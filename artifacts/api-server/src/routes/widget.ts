/**
 * Public widget routes — no tenant auth required.
 * Used by the embeddable quote widget on customer websites.
 */
import { Router, type IRouter } from "express";
import { db, quotesTable, propertiesTable, customersTable, tenantsTable, servicesTable } from "@workspace/db";
import { eq, and, ilike } from "drizzle-orm";
import crypto from "crypto";

const router: IRouter = Router();

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * POST /widget/quote-request
 * Public endpoint — no auth.
 * Body: { address, city?, state?, zip?, name, email, phone?, serviceId?, serviceName?, tenantSlug? }
 * Creates or finds a "widget lead" customer + property under the first matching tenant,
 * then inserts a pending quote and returns the token.
 */
router.post("/widget/quote-request", async (req, res): Promise<void> => {
  const { address, city, state, zip, name, email, phone, serviceId, serviceName, tenantId: bodyTenantId } = req.body;

  if (!address || !name || !email) {
    res.status(400).json({ error: "address, name, and email are required" });
    return;
  }

  // Determine tenant — use explicitly provided tenantId if given, else use the first tenant (single-tenant demo mode)
  let tenantId: number;
  if (bodyTenantId) {
    tenantId = parseInt(bodyTenantId, 10);
  } else {
    const [tenant] = await db.select({ id: tenantsTable.id }).from(tenantsTable).limit(1);
    if (!tenant) { res.status(503).json({ error: "No tenant configured" }); return; }
    tenantId = tenant.id;
  }

  // Find or create a "widget lead" customer matching this email
  let customerId: number;
  const [existingCustomer] = await db
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(and(
      eq(customersTable.tenantId, tenantId),
      ilike(customersTable.email, email.trim()),
    ))
    .limit(1);

  if (existingCustomer) {
    customerId = existingCustomer.id;
  } else {
    const [newCustomer] = await db.insert(customersTable).values({
      tenantId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() ?? "",
      referralSource: "widget",
    }).returning({ id: customersTable.id });
    customerId = newCustomer.id;
  }

  // Find or create a property matching this address for the customer
  let propertyId: number;
  const [existingProperty] = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(and(
      eq(propertiesTable.tenantId, tenantId),
      eq(propertiesTable.customerId, customerId),
      ilike(propertiesTable.address, address.trim()),
    ))
    .limit(1);

  if (existingProperty) {
    propertyId = existingProperty.id;
  } else {
    const [newProperty] = await db.insert(propertiesTable).values({
      tenantId,
      customerId,
      address: address.trim(),
      city: city?.trim() ?? null,
      state: state?.trim() ?? null,
      zip: zip?.trim() ?? null,
    }).returning({ id: propertiesTable.id });
    propertyId = newProperty.id;
  }

  // Resolve service details
  let resolvedServiceName = serviceName ?? "Service Request";
  let calculatedPrice = 0;
  let resolvedServiceId: number | null = null;

  if (serviceId) {
    const [service] = await db
      .select()
      .from(servicesTable)
      .where(and(eq(servicesTable.id, parseInt(serviceId, 10)), eq(servicesTable.tenantId, tenantId)));
    if (service) {
      resolvedServiceId = service.id;
      resolvedServiceName = service.name;
      calculatedPrice = service.basePrice;
    }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [quote] = await db.insert(quotesTable).values({
    tenantId,
    propertyId,
    token: generateToken(),
    serviceId: resolvedServiceId,
    serviceName: resolvedServiceName,
    selectedZoneLabels: [],
    totalAreaSqft: null,
    calculatedPrice,
    priceType: "flat",
    status: "pending",
    expiresAt,
  }).returning();

  res.status(201).json({
    token: quote.token,
    quoteId: quote.id,
    propertyId,
    customerId,
    price: calculatedPrice,
    serviceName: resolvedServiceName,
  });
});

/**
 * GET /widget/services?tenantId=...
 * Public — returns services for the widget's service picker.
 */
router.get("/widget/services", async (req, res): Promise<void> => {
  let tenantId: number;
  if (req.query.tenantId) {
    tenantId = parseInt(req.query.tenantId as string, 10);
  } else {
    const [tenant] = await db.select({ id: tenantsTable.id }).from(tenantsTable).limit(1);
    if (!tenant) { res.json([]); return; }
    tenantId = tenant.id;
  }

  const services = await db
    .select()
    .from(servicesTable)
    .where(and(eq(servicesTable.tenantId, tenantId), eq(servicesTable.isActive, true)));

  res.json(services.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    basePrice: s.basePrice,
    category: s.category,
  })));
});

export default router;
