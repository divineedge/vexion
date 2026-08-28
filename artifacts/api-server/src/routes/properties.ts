import { Router, type IRouter } from "express";
import { db, propertiesTable, customersTable, propertyOwnershipHistoryTable, activityLogTable, jobsTable, estimatesTable } from "@workspace/db";
import { eq, and, ilike, sql, desc, isNull } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import {
  importUpload,
  handleExportRequest,
  handleImportPreview,
  handleImportCommit,
  requireString,
  optionalString,
  optionalNumber,
  registerImportExportConfig,
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
    const [row] = await db.insert(propertiesTable).values({ tenantId, ...values } as typeof propertiesTable.$inferInsert).returning({ id: propertiesTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    await db.update(propertiesTable).set(values as Partial<typeof propertiesTable.$inferInsert>)
      .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  },
  getById: async (tenantId, id) => {
    const [row] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId))).limit(1);
    if (!row) return null;
    const { id: _id, tenantId: _t, createdAt: _c, ...rest } = row;
    return rest;
  },
  deleteById: async (tenantId, id) => {
    await db.delete(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  },
  getDependents: async (tenantId, id) => {
    const [jobRow] = await db.select({ count: sql<number>`count(*)` }).from(jobsTable).where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.propertyId, id)));
    const [estRow] = await db.select({ count: sql<number>`count(*)` }).from(estimatesTable).where(and(eq(estimatesTable.tenantId, tenantId), eq(estimatesTable.propertyId, id)));
    const jobCount = Number(jobRow?.count ?? 0);
    const estCount = Number(estRow?.count ?? 0);
    const parts: string[] = [];
    if (jobCount > 0) parts.push(`${jobCount} job${jobCount === 1 ? "" : "s"}`);
    if (estCount > 0) parts.push(`${estCount} estimate${estCount === 1 ? "" : "s"}`);
    return parts.length > 0 ? `still has ${parts.join(", ")} — delete those first, then undo this import again` : null;
  },
};
registerImportExportConfig(propertiesImportExportConfig);

router.get("/properties/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), propertiesImportExportConfig);
});

router.post("/properties/import/preview", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), propertiesImportExportConfig);
});

router.post("/properties/import/commit", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), propertiesImportExportConfig);
});

// ---------------------------------------------------------------------------
// Geocoding helper
// ---------------------------------------------------------------------------

interface GeocodeResult {
  lat: number;
  lng: number;
}

async function geocodeAddress(address: string, city?: string | null, state?: string | null, zip?: string | null): Promise<GeocodeResult | null> {
  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");

  const googleMapsApiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (googleMapsApiKey) {
    try {
      const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${encodeURIComponent(googleMapsApiKey)}`;
      const response = await fetch(googleUrl);
      const payload = await response.json() as {
        status?: string;
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      };
      const location = payload.results?.[0]?.geometry?.location;
      if (
        payload.status === "OK"
        && typeof location?.lat === "number"
        && typeof location.lng === "number"
      ) {
        return { lat: location.lat, lng: location.lng };
      }
    } catch {
      // Fall through to Nominatim so geocoding still works if Google is unavailable.
    }
  }

  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(fullAddress)}`;
    const response = await fetch(nominatimUrl, {
      headers: { "User-Agent": "DivineEdgeOS/1.0" },
    });
    const results = await response.json() as Array<{ lat: string; lon: string }>;
    if (!results || results.length === 0) return null;

    const result = results[0];
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function isAutomaticSuggestedBoundary(zone: unknown): boolean {
  if (!zone || typeof zone !== "object") return false;
  const candidate = zone as { id?: unknown; label?: unknown };
  return candidate.id === "boundary" || candidate.label === "Suggested Boundary";
}

function withoutAutomaticSuggestedBoundary(zones: unknown): unknown[] {
  return Array.isArray(zones) ? zones.filter((zone) => !isAutomaticSuggestedBoundary(zone)) : [];
}

function formatProperty(p: typeof propertiesTable.$inferSelect, customerName?: string | null) {
  return {
    ...p,
    measurementPolygons: withoutAutomaticSuggestedBoundary(p.measurementPolygons),
    serviceableAreaSqft: p.serviceableAreaSqft ?? null,
    customerName: customerName ?? null,
    archivedAt: p.archivedAt?.toISOString() ?? null,
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
  const { customerId, q, includeArchived } = req.query as Record<string, string>;

  let baseWhere = includeArchived === "true"
    ? eq(propertiesTable.tenantId, tenantId)
    : and(eq(propertiesTable.tenantId, tenantId), isNull(propertiesTable.archivedAt));
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
  const { customerId, address, city, state, zip, lat, lng, notes, type, size, sizeUnit } = req.body;
  if (!customerId || !address) {
    res.status(400).json({ error: "customerId and address are required" });
    return;
  }

  // Auto-geocode when lat/lng not explicitly provided
  const latLngExplicitPost = lat !== undefined && lng !== undefined;
  let resolvedLat: number | null = lat ?? null;
  let resolvedLng: number | null = lng ?? null;
  let geocodeStatus: "ok" | "failed" | "skipped" = "skipped";

  if (latLngExplicitPost) {
    geocodeStatus = "skipped";
  } else {
    const geo = await geocodeAddress(address, city, state, zip);
    if (geo) {
      resolvedLat = geo.lat;
      resolvedLng = geo.lng;
      geocodeStatus = "ok";
    } else {
      geocodeStatus = "failed";
    }
  }

  const [property] = await db.insert(propertiesTable).values({
    tenantId,
    customerId: parseInt(customerId, 10),
    address,
    city: city ?? null,
    state: state ?? null,
    zip: zip ?? null,
    lat: resolvedLat,
    lng: resolvedLng,
    notes: notes ?? null,
    type: type ?? null,
    size: size != null ? parseFloat(size) : null,
    sizeUnit: sizeUnit ?? null,
  }).returning();

  res.status(201).json({ ...formatProperty(property), geocodeStatus });
});

router.get("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [[row], lastJobRows] = await Promise.all([
    db
      .select({ property: propertiesTable, customerName: customersTable.name, customerPhone: customersTable.phone, customerEmail: customersTable.email })
      .from(propertiesTable)
      .leftJoin(customersTable, eq(propertiesTable.customerId, customersTable.id))
      .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId))),
    db
      .select({ completedAt: jobsTable.completedAt })
      .from(jobsTable)
      .where(and(eq(jobsTable.propertyId, id), eq(jobsTable.tenantId, tenantId), eq(jobsTable.status, 'completed')))
      .orderBy(desc(jobsTable.completedAt))
      .limit(1),
  ]);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const lastServicedAt = lastJobRows[0]?.completedAt?.toISOString() ?? null;
  res.json({ ...formatProperty(row.property, row.customerName), lastServicedAt, customerPhone: row.customerPhone ?? null, customerEmail: row.customerEmail ?? null });
});

router.patch("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { address, city, state, zip, lat, lng, notes, type, measurementPolygons, serviceableAreaSqft, size, sizeUnit, tags, archivedAt } = req.body;

  if (archivedAt !== undefined) {
    const userId = getUserId(req);
    if (!(await isAdminRole(tenantId, userId))) {
      res.status(403).json({ error: "Restricted to owner/office/department manager roles" });
      return;
    }
    if (archivedAt !== null && (
      typeof archivedAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T/.test(archivedAt)
      || Number.isNaN(Date.parse(archivedAt))
    )) {
      res.status(400).json({ error: "archivedAt must be an ISO timestamp string or null" });
      return;
    }
  }

  // Auto-geocode when address fields change and lat/lng not explicitly provided
  const addressChanged = address !== undefined || city !== undefined || state !== undefined || zip !== undefined;
  const latLngExplicit = lat !== undefined || lng !== undefined;

  let resolvedLat: number | undefined = lat;
  let resolvedLng: number | undefined = lng;
  let resolvedPolygons: unknown[] | undefined = measurementPolygons;
  let geocodeStatus: "ok" | "failed" | "skipped" | undefined;

  if (latLngExplicit) {
    geocodeStatus = "skipped";
  } else if (addressChanged) {
    // Fetch current property to build full address string
    const [current] = await db.select().from(propertiesTable)
      .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }

    const effectiveAddress = address ?? current.address;
    const effectiveCity = city !== undefined ? city : current.city;
    const effectiveState = state !== undefined ? state : current.state;
    const effectiveZip = zip !== undefined ? zip : current.zip;

    const geo = await geocodeAddress(effectiveAddress, effectiveCity, effectiveState, effectiveZip);
    if (geo) {
      resolvedLat = geo.lat;
      resolvedLng = geo.lng;
      geocodeStatus = "ok";
    } else {
      geocodeStatus = "failed";
    }
  }

  const [updated] = await db.update(propertiesTable)
    .set({
      ...(address && { address }),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(zip !== undefined && { zip }),
      ...(resolvedLat !== undefined && { lat: resolvedLat }),
      ...(resolvedLng !== undefined && { lng: resolvedLng }),
      ...(notes !== undefined && { notes }),
      ...(type !== undefined && { type }),
      ...(resolvedPolygons !== undefined && { measurementPolygons: resolvedPolygons }),
      ...(serviceableAreaSqft !== undefined && { serviceableAreaSqft }),
      ...(size !== undefined && { size }),
      ...(sizeUnit !== undefined && { sizeUnit }),
      ...(tags !== undefined && { tags }),
      ...(archivedAt !== undefined && { archivedAt: archivedAt === null ? null : new Date(archivedAt) }),
    })
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable).where(eq(customersTable.id, updated.customerId));
  res.json({ ...formatProperty(updated, row?.customerName), ...(geocodeStatus ? { geocodeStatus } : {}) });
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

// GET /properties/:id/geocode — geocode address and return lat/lng
router.get("/properties/:id/geocode", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  if (!property) { res.status(404).json({ error: "Not found" }); return; }

  const geo = await geocodeAddress(property.address, property.city, property.state, property.zip);
  if (!geo) {
    res.status(404).json({ error: "Address not found" });
    return;
  }

  res.json({ lat: geo.lat, lng: geo.lng });
});

router.delete("/properties/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office/department manager roles" });
    return;
  }
  const [[{ jobCount }], [{ estimateCount }]] = await Promise.all([
    db.select({ jobCount: sql<number>`count(*)::int` }).from(jobsTable)
      .where(and(eq(jobsTable.tenantId, tenantId), eq(jobsTable.propertyId, id))),
    db.select({ estimateCount: sql<number>`count(*)::int` }).from(estimatesTable)
      .where(and(eq(estimatesTable.tenantId, tenantId), eq(estimatesTable.propertyId, id))),
  ]);
  if (jobCount > 0 || estimateCount > 0) {
    res.status(409).json({ error: "Cannot permanently delete property because related jobs or estimates still exist." });
    return;
  }
  try {
    await db.delete(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.tenantId, tenantId)));
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "23503") {
      res.status(409).json({ error: "Cannot permanently delete property because related records still exist." });
      return;
    }
    throw error;
  }
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

// POST /properties/backfill-geocodes — one-time admin endpoint to geocode all properties with null lat/lng
router.post("/properties/backfill-geocodes", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Fetch all properties for this tenant that are missing coordinates
  const properties = await db
    .select()
    .from(propertiesTable)
    .where(and(eq(propertiesTable.tenantId, tenantId), isNull(propertiesTable.lat)));

  let geocoded = 0;
  let skipped = 0;

  for (const property of properties) {
    // Nominatim rate-limit: 1 request/second per policy
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const geo = await geocodeAddress(property.address, property.city, property.state, property.zip);
    if (!geo) {
      skipped++;
      continue;
    }

    await db
      .update(propertiesTable)
      .set({
        lat: geo.lat,
        lng: geo.lng,
      })
      .where(and(eq(propertiesTable.id, property.id), eq(propertiesTable.tenantId, tenantId)));

    geocoded++;
  }

  res.json({ total: properties.length, geocoded, skipped });
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
