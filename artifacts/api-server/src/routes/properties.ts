import { Router, type IRouter } from "express";
import { db, propertiesTable, customersTable, propertyOwnershipHistoryTable, activityLogTable } from "@workspace/db";
import { eq, and, ilike, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import {
  importUpload,
  handleExportRequest,
  handleImportPreview,
  handleImportCommit,
  requireString,
  optionalString,
  optionalNumber,
  type ImportExportEntityConfig,
} from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const propertiesImportExportConfig: ImportExportEntityConfig = {
  entityKey: "properties",
  fields: [
    { key: "customerEmail", header: "Customer Email", required: true, hint: "Looked up against existing customers" },
    { key: "address", header: "Address", required: true },
    { key: "city", header: "City" },
    { key: "state", header: "State" },
    { key: "zip", header: "Zip" },
    { key: "type", header: "Type" },
    { key: "size", header: "Size" },
    { key: "sizeUnit", header: "Size Unit", hint: "sqft or acres" },
    { key: "notes", header: "Notes" },
  ],
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "customerName", header: "Customer Name" },
    { key: "customerEmail", header: "Customer Email" },
    { key: "address", header: "Address" },
    { key: "city", header: "City" },
    { key: "state", header: "State" },
    { key: "zip", header: "Zip" },
    { key: "type", header: "Type" },
    { key: "size", header: "Size" },
    { key: "sizeUnit", header: "Size Unit" },
    { key: "notes", header: "Notes" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    let where = eq(propertiesTable.tenantId, tenantId) as ReturnType<typeof eq>;
    if (query.customerId) where = and(where, eq(propertiesTable.customerId, parseInt(query.customerId, 10))) as typeof where;
    if (query.q) where = and(where, ilike(propertiesTable.address, `%${query.q}%`)) as typeof where;

    const rows = await db
      .select({ property: propertiesTable, customerName: customersTable.name, customerEmail: customersTable.email })
      .from(propertiesTable)
      .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
      .where(where)
      .orderBy(propertiesTable.createdAt);

    return rows.map((r) => ({
      id: r.property.id,
      customerName: r.customerName ?? "",
      customerEmail: r.customerEmail ?? "",
      address: r.property.address,
      city: r.property.city ?? "",
      state: r.property.state ?? "",
      zip: r.property.zip ?? "",
      type: r.property.type ?? "",
      size: r.property.size ?? "",
      sizeUnit: r.property.sizeUnit ?? "",
      notes: r.property.notes ?? "",
      createdAt: r.property.createdAt.toISOString(),
    }));
  },
  parseRow: async (tenantId, raw) => {
    const errors: string[] = [];
    const customerEmail = requireString(raw.customerEmail, "Customer Email", errors);
    const address = requireString(raw.address, "Address", errors);
    if (errors.length > 0 || !customerEmail || !address) return { ok: false, errors };

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.tenantId, tenantId), sql`lower(${customersTable.email}) = lower(${customerEmail})`))
      .limit(1);
    if (!customer) return { ok: false, errors: [`No customer found with email "${customerEmail}"`] };

    const size = optionalNumber(raw.size, "Size", errors);
    if (errors.length > 0) return { ok: false, errors };

    return {
      ok: true,
      values: {
        customerId: customer.id,
        address,
        city: optionalString(raw.city) ?? null,
        state: optionalString(raw.state) ?? null,
        zip: optionalString(raw.zip) ?? null,
        type: optionalString(raw.type) ?? null,
        size: size ?? null,
        sizeUnit: optionalString(raw.sizeUnit) ?? "sqft",
        notes: optionalString(raw.notes) ?? null,
      },
    };
  },
  findExisting: async (tenantId, values) => {
    const [existing] = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(and(
        eq(propertiesTable.tenantId, tenantId),
        eq(propertiesTable.customerId, values.customerId as number),
        sql`lower(${propertiesTable.address}) = lower(${values.address as string})`,
      ))
      .limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    await db.insert(propertiesTable).values({ tenantId, ...values } as typeof propertiesTable.$inferInsert);
  },
  update: async (tenantId, id, values) => {
    await db.update(propertiesTable).set(values as Partial<typeof propertiesTable.$inferInsert>)
      .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  },
};

router.get("/properties/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), propertiesImportExportConfig);
});

router.post("/properties/import/preview", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), propertiesImportExportConfig);
});

router.post("/properties/import/commit", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), propertiesImportExportConfig);
});

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

  const { address, city, state, zip, lat, lng, notes, type, measurementPolygons, serviceableAreaSqft, size, sizeUnit } = req.body;
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
      ...(size !== undefined && { size }),
      ...(sizeUnit !== undefined && { sizeUnit }),
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
