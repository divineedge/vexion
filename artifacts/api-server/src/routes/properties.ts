import { Router, type IRouter } from "express";
import { db, propertiesTable, customersTable, propertyOwnershipHistoryTable, activityLogTable } from "@workspace/db";
import { eq, and, ilike, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatProperty(p: typeof propertiesTable.$inferSelect, customerName?: string | null) {
  return {
    ...p,
    measurementPolygons: (p.measurementPolygons as unknown[]) ?? [],
    serviceableAreaSqft: p.serviceableAreaSqft ?? null,
    customerName: customerName ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

// GET /properties/check — find existing properties matching an address (duplicate detection)
router.get("/properties/check", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { address } = req.query as Record<string, string>;

  if (!address || address.trim().length < 4) {
    res.json([]);
    return;
  }

  const rows = await db
    .select({
      property: propertiesTable,
      customerName: customersTable.name,
    })
    .from(propertiesTable)
    .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
    .where(and(
      eq(propertiesTable.tenantId, tenantId),
      ilike(propertiesTable.address, `%${address.trim()}%`),
    ))
    .orderBy(propertiesTable.createdAt);

  res.json(rows.map(r => ({
    ...formatProperty(r.property, r.customerName),
    customerId: r.property.customerId,
  })));
});

router.get("/properties", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, q } = req.query as Record<string, string>;

  let baseWhere = eq(propertiesTable.tenantId, tenantId);
  if (customerId) {
    const cid = parseInt(customerId, 10);
    baseWhere = and(baseWhere, eq(propertiesTable.customerId, cid)) as typeof baseWhere;
  }
  if (q) {
    baseWhere = and(baseWhere, ilike(propertiesTable.address, `%${q}%`)) as typeof baseWhere;
  }

  const rows = await db
    .select({
      property: propertiesTable,
      customerName: customersTable.name,
    })
    .from(propertiesTable)
    .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
    .where(baseWhere)
    .orderBy(propertiesTable.createdAt);

  res.json(rows.map(r => formatProperty(r.property, r.customerName)));
});

router.post("/properties", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, address, city, state, zip, lat, lng, notes, type } = req.body;
  if (!customerId || !address) {
    res.status(400).json({ error: "customerId and address are required" });
    return;
  }

  const [property] = await db.insert(propertiesTable).values({
    tenantId,
    customerId: parseInt(customerId, 10),
    address,
    city: city ?? null,
    state: state ?? null,
    zip: zip ?? null,
    lat: lat ?? null,
    lng: lng ?? null,
    notes: notes ?? null,
    type: type ?? null,
  }).returning();

  res.status(201).json(formatProperty(property));
});

router.get("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ property: propertiesTable, customerName: customersTable.name })
    .from(propertiesTable)
    .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatProperty(row.property, row.customerName));
});

router.patch("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { address, city, state, zip, lat, lng, notes, type, measurementPolygons, serviceableAreaSqft } = req.body;
  const [updated] = await db.update(propertiesTable)
    .set({
      ...(address && { address }),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(zip !== undefined && { zip }),
      ...(lat !== undefined && { lat }),
      ...(lng !== undefined && { lng }),
      ...(notes !== undefined && { notes }),
      ...(type !== undefined && { type }),
      ...(measurementPolygons !== undefined && { measurementPolygons }),
      ...(serviceableAreaSqft !== undefined && { serviceableAreaSqft }),
    })
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json(formatProperty(updated, row?.customerName));
});

// PATCH /properties/:id/measurements — save measurement polygons
router.patch("/properties/:id/measurements", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { measurementPolygons, serviceableAreaSqft } = req.body;
  const [updated] = await db.update(propertiesTable)
    .set({
      ...(measurementPolygons !== undefined && { measurementPolygons }),
      ...(serviceableAreaSqft !== undefined && { serviceableAreaSqft }),
    })
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json(formatProperty(updated, row?.customerName));
});

// GET /properties/:id/geocode — geocode address using Nominatim and return lat/lng
router.get("/properties/:id/geocode", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  if (!property) { res.status(404).json({ error: "Not found" }); return; }

  const fullAddress = [property.address, property.city, property.state, property.zip].filter(Boolean).join(", ");

  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(fullAddress)}`;
    const response = await fetch(nominatimUrl, {
      headers: { "User-Agent": "DivineEdgeOS/1.0" },
    });
    const results = await response.json() as Array<{ lat: string; lon: string; boundingbox: string[] }>;

    if (!results || results.length === 0) {
      res.status(404).json({ error: "Address not found" });
      return;
    }

    const result = results[0];
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const bb = result.boundingbox; // [minLat, maxLat, minLon, maxLon]

    // Build a rough parcel boundary polygon from the bounding box as a starting point
    let boundaryPolygon = null;
    if (bb && bb.length === 4) {
      const minLat = parseFloat(bb[0]);
      const maxLat = parseFloat(bb[1]);
      const minLng = parseFloat(bb[2]);
      const maxLng = parseFloat(bb[3]);
      boundaryPolygon = [
        [minLat, minLng],
        [minLat, maxLng],
        [maxLat, maxLng],
        [maxLat, minLng],
      ];
    }

    res.json({ lat, lng, boundaryPolygon });
  } catch (err) {
    res.status(502).json({ error: "Geocoding service unavailable" });
  }
});

router.delete("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

router.patch("/properties/:id/geofence", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const { lat, lng, radius } = req.body;

  const [updated] = await db.update(propertiesTable)
    .set({ geofenceLat: lat, geofenceLng: lng, ...(radius && { geofenceRadius: radius }) })
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json(formatProperty(updated, row?.customerName));
});

// Transfer property to a new customer
router.post("/properties/:id/transfer", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { newCustomerId, notes } = req.body;
  if (!newCustomerId) { res.status(400).json({ error: "newCustomerId is required" }); return; }

  const [property] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  const newCustId = parseInt(newCustomerId, 10);
  const [newCustomer] = await db.select().from(customersTable).where(and(eq(customersTable.id, newCustId), eq(customersTable.tenantId, tenantId)));
  if (!newCustomer) { res.status(404).json({ error: "New customer not found" }); return; }

  // All three writes are atomic in one transaction
  const result = await db.transaction(async (tx) => {
    await tx.insert(propertyOwnershipHistoryTable).values({
      tenantId,
      propertyId: id,
      previousCustomerId: property.customerId,
      newCustomerId: newCustId,
      transferredByUserId: userId,
      notes: notes ?? null,
    });

    const [updated] = await tx.update(propertiesTable)
      .set({ customerId: newCustId })
      .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)))
      .returning();

    await tx.insert(activityLogTable).values({
      tenantId, userId,
      type: "property_transferred",
      message: `Property "${updated.address}" transferred to ${newCustomer.name}`,
      entityId: id,
    });

    return updated;
  });

  res.json(formatProperty(result, newCustomer.name));
});

// Ownership history for a property
router.get("/properties/:id/ownership-history", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const rows = await db
    .select({
      history: propertyOwnershipHistoryTable,
      prevName: sql<string | null>`prev_cust.name`,
      newName: sql<string | null>`new_cust.name`,
    })
    .from(propertyOwnershipHistoryTable)
    .leftJoin(sql`customers prev_cust`, sql`prev_cust.id = ${propertyOwnershipHistoryTable.previousCustomerId}`)
    .leftJoin(sql`customers new_cust`, sql`new_cust.id = ${propertyOwnershipHistoryTable.newCustomerId}`)
    .where(and(eq(propertyOwnershipHistoryTable.tenantId, tenantId), eq(propertyOwnershipHistoryTable.propertyId, id)))
    .orderBy(desc(propertyOwnershipHistoryTable.transferredAt));

  res.json(rows.map(r => ({
    id: r.history.id,
    previousCustomerId: r.history.previousCustomerId,
    previousCustomerName: r.prevName ?? null,
    newCustomerId: r.history.newCustomerId,
    newCustomerName: r.newName ?? null,
    notes: r.history.notes,
    transferredAt: r.history.transferredAt.toISOString(),
  })));
});

export default router;
