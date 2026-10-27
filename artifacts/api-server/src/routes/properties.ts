import { withSoftwareCapacity,assertSoftwareCapacity } from "../lib/experienceCore";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, propertiesTable, customersTable, propertyOwnershipHistoryTable, activityLogTable, jobsTable, estimatesTable, tenantsTable, usersTable } from "@workspace/db";
import { eq, and, ilike, sql, desc, isNull } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { resolveStaffSession } from "./auth";
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

async function requireVerifiedStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.headers["x-portal-token"]) {
    res.status(403).json({ error: "This endpoint is not available to portal users" });
    return;
  }
  const session = await resolveStaffSession(req);
  if (!session) {
    res.status(401).json({ error: "Valid staff session required" });
    return;
  }
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(and(
    eq(usersTable.id, session.userId),
    eq(usersTable.tenantId, session.tenantId),
    eq(usersTable.isActive, true),
  )).limit(1);
  if (!user) {
    res.status(401).json({ error: "Staff account is inactive or not found" });
    return;
  }
  res.locals["staffTenantId"] = session.tenantId;
  next();
}

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const propertiesImportExportConfig: ImportExportEntityConfig = {
  entityKey: "properties",
  fields: [
    { key: "customerEmail", header: "Customer Email", required: true, hint: "Looked up against existing customers" },
    { key: "address", header: "Address", hint: "Physical address, or use the selected customer-address fallback" },
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
      .leftJoin(customersTable, and(
        eq(propertiesTable.customerId, customersTable.id),
        eq(customersTable.tenantId, tenantId),
      ))
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
    let address = optionalString(raw.address);
    if (errors.length > 0 || !customerEmail) return { ok: false, errors };

    const [customer] = await db
      .select({ id: customersTable.id, billingAddress:customersTable.billingAddress, billingCity:customersTable.billingCity,
        billingState:customersTable.billingState,billingZip:customersTable.billingZip,physicalAddress:customersTable.physicalAddress,
        physicalCity:customersTable.physicalCity,physicalState:customersTable.physicalState,physicalZip:customersTable.physicalZip })
      .from(customersTable)
      .where(and(eq(customersTable.tenantId, tenantId), sql`lower(${customersTable.email}) = lower(${customerEmail})`))
      .limit(1);
    if (!customer) return { ok: false, errors: [`No customer found with email "${customerEmail}"`] };
    let fromCustomer = false;
    if (!address && customer.physicalAddress) {address=customer.physicalAddress;fromCustomer=true;}
    if (!address && raw.__propertyAddressSource==="mailing_if_missing") {
      const [existingProperty]=await db.select({id:propertiesTable.id}).from(propertiesTable).where(and(eq(propertiesTable.tenantId,tenantId),eq(propertiesTable.customerId,customer.id))).limit(1);
      if (existingProperty) return {ok:false,errors:["Customer already has a property; supply its physical address instead of creating one from mailing details"]};
      address=customer.billingAddress??undefined;fromCustomer=true;
    }
    if (!address || /\bP\.?\s*O\.?\s*(?:BOX|B)\b/i.test(address)) return {ok:false,errors:["A physical service address is required. Mailing fallback must be selected explicitly and cannot use a PO box"]};

    const size = optionalNumber(raw.size, "Size", errors);
    if (errors.length > 0) return { ok: false, errors };

    return {
      ok: true,
      values: {
        customerId: customer.id,
        address,
        city: optionalString(raw.city) ?? (fromCustomer ? customer.physicalAddress ? customer.physicalCity : customer.billingCity : null),
        state: optionalString(raw.state) ?? (fromCustomer ? customer.physicalAddress ? customer.physicalState : customer.billingState : null),
        zip: optionalString(raw.zip) ?? (fromCustomer ? customer.physicalAddress ? customer.physicalZip : customer.billingZip : null),
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
    const [row] = await withSoftwareCapacity(tenantId,"properties",async tx=>tx.insert(propertiesTable).values({ tenantId, ...values } as typeof propertiesTable.$inferInsert).returning({ id: propertiesTable.id }));
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

export async function geocodeAddress(address: string, city?: string | null, state?: string | null, zip?: string | null): Promise<GeocodeResult | null> {
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

type AddressSuggestion = {
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number;
  lng: number;
  label: string;
  distanceMiles: number | null;
  source: "business" | "google" | "photon" | "nominatim";
};

const businessCenterCache = new Map<number, { address: string; center: GeocodeResult | null; expiresAt: number }>();
const BUSINESS_CENTER_CACHE_MS = 5 * 60 * 1000;

function distanceMiles(a: GeocodeResult, b: GeocodeResult): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function getBusinessCenter(tenantId: number): Promise<GeocodeResult | null> {
  const [tenant] = await db.select({
    businessAddress: tenantsTable.businessAddress,
    businessCity: tenantsTable.businessCity,
    businessState: tenantsTable.businessState,
    businessZip: tenantsTable.businessZip,
    businessLat: tenantsTable.businessLat,
    businessLng: tenantsTable.businessLng,
  })
    .from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const address = [
    tenant?.businessAddress,
    tenant?.businessCity,
    tenant?.businessState,
    tenant?.businessZip,
  ].filter(Boolean).join(", ").trim();
  if (!address) return null;
  if (tenant?.businessLat != null && tenant.businessLng != null) {
    const center = { lat: tenant.businessLat, lng: tenant.businessLng };
    businessCenterCache.set(tenantId, { address, center, expiresAt: Date.now() + BUSINESS_CENTER_CACHE_MS });
    return center;
  }
  const cached = businessCenterCache.get(tenantId);
  if (cached && cached.address === address && cached.expiresAt > Date.now()) return cached.center;
  const center = await geocodeAddress(address);
  businessCenterCache.set(tenantId, { address, center, expiresAt: Date.now() + BUSINESS_CENTER_CACHE_MS });
  return center;
}

function photonSuggestion(feature: { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown[] } }): AddressSuggestion | null {
  const coords = feature.geometry?.coordinates;
  const p = feature.properties ?? {};
  const lng = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || String(p.countrycode ?? "").toLowerCase() !== "us") return null;
  const street = [p.housenumber, p.street].filter((part): part is string => typeof part === "string" && Boolean(part)).join(" ");
  const address = street || (typeof p.name === "string" ? p.name : "");
  if (!address) return null;
  const city = typeof (p.city ?? p.locality ?? p.district) === "string" ? String(p.city ?? p.locality ?? p.district) : null;
  const state = typeof p.state === "string" ? p.state : null;
  const zip = typeof p.postcode === "string" ? p.postcode : null;
  const label = [address, city, state, zip].filter(Boolean).join(", ");
  return { address, city, state, zip, lat, lng, label, distanceMiles: null, source: "photon" };
}

function nominatimSuggestion(result: {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Record<string, string>;
}): AddressSuggestion | null {
  const lat = Number(result.lat);
  const lng = Number(result.lon);
  const p = result.address ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (p.country_code && p.country_code.toLowerCase() !== "us")) return null;
  const road = p.road ?? p.pedestrian ?? p.residential ?? "";
  const address = [p.house_number, road].filter(Boolean).join(" ") || p.building || p.amenity || "";
  if (!address) return null;
  const city = p.city ?? p.town ?? p.village ?? p.hamlet ?? p.municipality ?? null;
  const state = p.state ?? null;
  const zip = p.postcode ?? null;
  return {
    address,
    city,
    state,
    zip,
    lat,
    lng,
    label: result.display_name ?? [address, city, state, zip].filter(Boolean).join(", "),
    distanceMiles: null,
    source: "nominatim",
  };
}

// Auth is applied to this router by the API server's authenticated route mount.
router.get("/address-suggestions", requireVerifiedStaff, async (req, res): Promise<void> => {
  const tenantId = res.locals["staffTenantId"] as number;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) {
    res.status(400).json({ error: "q must be at least 2 characters" });
    return;
  }

  const center = await getBusinessCenter(tenantId);
  const googleKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
  const suggestions: AddressSuggestion[] = [];
  const businessAddress = businessCenterCache.get(tenantId)?.address;
  if (center && businessAddress && businessAddress.toLowerCase().includes(q.toLowerCase())) {
    const parts = businessAddress.split(",").map(part => part.trim());
    const stateZip = parts[2] ?? "";
    suggestions.push({
      address: parts[0] || businessAddress,
      city: parts[1] ?? null,
      state: stateZip.split(/\s+/)[0] || null,
      zip: stateZip.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? null,
      lat: center.lat,
      lng: center.lng,
      label: businessAddress,
      distanceMiles: 0,
      source: "business",
    });
  }

  let hasUsableGoogleResults = false;
  if (googleKey) {
    try {
      // Google's legacy autocomplete API caps location-radius bias at 50 km.
      // The old 200-mile strict-bound request was invalid/overly restrictive and
      // caused valid local predictions to disappear. Bias locally here, then
      // enforce the product's 200-mile service-area rule after coordinates resolve.
      const locationBias = center
        ? `&location=${center.lat},${center.lng}&radius=50000`
        : "";
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&components=country:us&types=address${locationBias}&key=${encodeURIComponent(googleKey)}`;
      const payload = await (await fetch(url)).json() as {
        status?: string;
        predictions?: Array<{ description?: string; place_id?: string }>;
      };
      if (payload.status === "OK") {
        for (const prediction of (payload.predictions ?? []).slice(0, 8)) {
          if (!prediction.description || !prediction.place_id) continue;
          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(prediction.place_id)}&fields=address_component,formatted_address,geometry&key=${encodeURIComponent(googleKey)}`;
          const detailsPayload = await (await fetch(detailsUrl)).json() as {
            status?: string;
            result?: {
              formatted_address?: string;
              address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
              geometry?: { location?: { lat?: number; lng?: number } };
            };
          };
          const result = detailsPayload.result;
          const lat = result?.geometry?.location?.lat;
          const lng = result?.geometry?.location?.lng;
          if (detailsPayload.status !== "OK" || !result || typeof lat !== "number" || typeof lng !== "number") continue;
          const comps = result.address_components ?? [];
          const get = (type: string) => comps.find(component => component.types.includes(type))?.long_name ?? "";
          const getShort = (type: string) => comps.find(component => component.types.includes(type))?.short_name ?? "";
          const street = [get("street_number"), get("route")].filter(Boolean).join(" ");
          if (!street) continue;
          suggestions.push({
            address: street,
            city: get("locality") || get("postal_town") || get("sublocality_level_1") || null,
            state: getShort("administrative_area_level_1") || null,
            zip: get("postal_code") || null,
            lat,
            lng,
            label: result.formatted_address ?? prediction.description,
            distanceMiles: null,
            source: "google",
          });
        }
        hasUsableGoogleResults = suggestions.some(item => item.source === "google");
      }
    } catch {
      // Photon below remains available if Google autocomplete is unavailable.
    }
  }

  if (!hasUsableGoogleResults) try {
    const photonBias = center ? `&lat=${center.lat}&lon=${center.lng}` : "";
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=20&lang=en${photonBias}`;
    const payload = await (await fetch(photonUrl, { headers: { "User-Agent": "DivineEdgeOS/1.0" } })).json() as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: unknown[] } }> };
    suggestions.push(...(payload.features ?? []).map(photonSuggestion).filter((item): item is AddressSuggestion => item !== null));
  } catch {
    // Return usable Google results rather than silently discarding them.
  }

  if (!hasUsableGoogleResults) try {
    const viewbox = center
      ? (() => {
          const latDelta = 200 / 69;
          const lngDelta = 200 / (69 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)));
          return `&viewbox=${center.lng - lngDelta},${center.lat + latDelta},${center.lng + lngDelta},${center.lat - latDelta}&bounded=1`;
        })()
      : "";
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=10&q=${encodeURIComponent(q)}${viewbox}`;
    const payload = await (await fetch(nominatimUrl, {
      headers: { "User-Agent": "DivineEdgeOS/1.0", "Accept-Language": "en" },
    })).json() as Array<{ lat?: string; lon?: string; display_name?: string; address?: Record<string, string> }>;
    suggestions.push(...payload.map(nominatimSuggestion).filter((item): item is AddressSuggestion => item !== null));
  } catch {
    // Existing providers may still have usable results.
  }

  const unique = new Map<string, AddressSuggestion>();
  for (const suggestion of suggestions) {
    const distance = center ? distanceMiles(center, suggestion) : null;
    if (distance !== null && distance > 200) continue;
    const normalized = { ...suggestion, distanceMiles: distance };
    unique.set(`${normalized.address}|${normalized.city ?? ""}|${normalized.state ?? ""}|${normalized.zip ?? ""}`.toLowerCase(), normalized);
  }
  const items = [...unique.values()]
    .sort((a, b) => {
      const sourcePriority = { business: 0, google: 1, photon: 2, nominatim: 3 };
      const sourceDifference = sourcePriority[a.source] - sourcePriority[b.source];
      if (sourceDifference !== 0) return sourceDifference;
      return (a.distanceMiles ?? Number.MAX_SAFE_INTEGER) - (b.distanceMiles ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, 10);
  res.json({ items, radiusApplied: center !== null, center });
});

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
    .leftJoin(customersTable, and(
      eq(propertiesTable.customerId, customersTable.id),
      eq(customersTable.tenantId, tenantId),
    ))
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
    .leftJoin(customersTable, and(
      eq(propertiesTable.customerId, customersTable.id),
      eq(customersTable.tenantId, tenantId),
    ))
    .where(baseWhere)
    .orderBy(
      desc(sql`(SELECT count(*) FROM jobs usage_jobs WHERE usage_jobs.property_id = ${propertiesTable.id} AND usage_jobs.tenant_id = ${tenantId} AND usage_jobs.archived_at IS NULL)`),
      desc(sql`(SELECT max(usage_jobs.scheduled_at) FROM jobs usage_jobs WHERE usage_jobs.property_id = ${propertiesTable.id} AND usage_jobs.tenant_id = ${tenantId} AND usage_jobs.archived_at IS NULL)`),
      propertiesTable.createdAt,
    );

  res.json(rows.map(r => formatProperty(r.property, r.customerName)));
});

router.post("/properties", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, address, city, state, zip, lat, lng, notes, type, size, sizeUnit } = req.body;
  if (!customerId || !address) {
    res.status(400).json({ error: "customerId and address are required" });
    return;
  }
  const parsedCustomerId = Number(customerId);
  if (!Number.isInteger(parsedCustomerId) || parsedCustomerId <= 0) {
    res.status(400).json({ error: "customerId must be a positive integer" });
    return;
  }
  const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
    .where(and(eq(customersTable.id, parsedCustomerId), eq(customersTable.tenantId, tenantId), isNull(customersTable.archivedAt)))
    .limit(1);
  if (!customer) {
    res.status(404).json({ error: "Active customer not found" });
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

  const [property] = await withSoftwareCapacity(tenantId,"properties",async tx=>tx.insert(propertiesTable).values({
    tenantId,
    customerId: parsedCustomerId,
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
  }).returning());

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
      .leftJoin(customersTable, and(
        eq(propertiesTable.customerId, customersTable.id),
        eq(customersTable.tenantId, tenantId),
      ))
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

  const [updated] = await db.transaction(async tx=>{
    if(archivedAt===null){
      const [existing]=await tx.select({archivedAt:propertiesTable.archivedAt}).from(propertiesTable).where(and(eq(propertiesTable.id,id),eq(propertiesTable.tenantId,tenantId))).for("update");
      if(existing?.archivedAt)await assertSoftwareCapacity(tx,tenantId,"properties");
    }
    return tx.update(propertiesTable)
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
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable)
    .where(and(eq(customersTable.id, updated.customerId), eq(customersTable.tenantId, tenantId)));
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
  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable)
    .where(and(eq(customersTable.id, updated.customerId), eq(customersTable.tenantId, tenantId)));
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

  const [row] = await db.select({ customerName: customersTable.name }).from(customersTable)
    .where(and(eq(customersTable.id, updated.customerId), eq(customersTable.tenantId, tenantId)));
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
