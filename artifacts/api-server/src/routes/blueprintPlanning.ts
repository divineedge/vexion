import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  blueprintCatalogAvailabilityTable,
  blueprintCatalogLinksTable,
  blueprintPassthroughDefaultsTable,
  blueprintPlanVersionsTable,
  blueprintPlanningSettingsTable,
  blueprintsTable,
  customersTable,
  db,
  estimatesTable,
  inventoryItemsTable,
  inventoryPartLinkComponentsTable,
  inventoryPartLinksTable,
  propertiesTable,
  servicesTable,
} from "@workspace/db";
import { getTenantId } from "../lib/tenantHelper";
import { stockOwnerId } from "../lib/inventoryDuplicate";
import { lineExtendedPrice, prepareLineItems } from "../lib/customLineItems";
import {
  ROLE_LABELS,
  buildPlan,
  linesTotal,
  nextVersionStatuses,
  orderListFromLines,
  type CatalogLinkInput,
  type CustomerLine,
  type PlanFeature,
  type PlanningSettingsInput,
} from "../lib/blueprintPlanning";
import { planningLockState, rejectIfBlueprintLocked } from "../lib/blueprintPlanningLock";

const router: IRouter = Router();
const ROLE_KEYS = new Set(Object.keys(ROLE_LABELS));
const SOURCE_KINDS = new Set(["inventory", "kit", "service", "passthrough"]);
const JOB_TYPES = new Set(["sprinkler", "gravel", "bark", "general"]);
const FEATURE_KINDS = new Set(["outline", "work_area", "water_hookup", "driveway", "house", "tree", "rock", "gravel", "bark", "curb"]);

function pathId(value: string | string[] | undefined): number | null {
  const parsed = parseInt(Array.isArray(value) ? value[0] : value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function settingsView(row: typeof blueprintPlanningSettingsTable.$inferSelect | undefined): PlanningSettingsInput {
  const exclusions = Array.isArray(row?.zoneExclusions) ? row.zoneExclusions : [];
  return {
    sprinklerMinSpacingFt: row?.sprinklerMinSpacingFt ?? null,
    sprinklerMaxSpacingFt: row?.sprinklerMaxSpacingFt ?? null,
    tonsPerYard: row?.tonsPerYard ?? null,
    yardsPerTruckLoad: row?.yardsPerTruckLoad ?? null,
    bufferPercent: row?.bufferPercent ?? 10,
    zoneExclusions: exclusions.flatMap(entry => {
      if (!entry || typeof entry !== "object") return [];
      const pair = entry as { a?: unknown; b?: unknown };
      if (typeof pair.a !== "string" || typeof pair.b !== "string") return [];
      return [{ a: pair.a, b: pair.b }];
    }),
  };
}

async function readSettings(tenantId: number): Promise<PlanningSettingsInput> {
  const [row] = await db.select().from(blueprintPlanningSettingsTable).where(eq(blueprintPlanningSettingsTable.tenantId, tenantId));
  return settingsView(row);
}

function sellPrice(item: { markedUpPrice: number; unitPrice: number; pricePerFoot: number | null; unit: string }): number {
  if (item.pricePerFoot != null && item.pricePerFoot > 0 && (item.unit === "ft" || item.unit === "feet" || item.unit === "foot")) return item.pricePerFoot;
  if (item.markedUpPrice > 0) return item.markedUpPrice;
  return item.unitPrice ?? 0;
}

function parseFeatures(raw: unknown): PlanFeature[] | null {
  if (!Array.isArray(raw) || raw.length > 200) return null;
  const features: PlanFeature[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const feature = entry as Record<string, unknown>;
    if (typeof feature.id !== "string" || !FEATURE_KINDS.has(String(feature.kind))) return null;
    if (feature.disposition !== "existing" && feature.disposition !== "bid") return null;
    if (!Array.isArray(feature.points) || feature.points.length > 400) return null;
    const points = [];
    for (const point of feature.points) {
      if (!point || typeof point !== "object") return null;
      const lat = finiteOrNull((point as { lat?: unknown }).lat);
      const lng = finiteOrNull((point as { lng?: unknown }).lng);
      if (lat == null || lng == null) return null;
      points.push({ lat, lng });
    }
    const areaKind = feature.areaKind === "lawn" || feature.areaKind === "gravel" || feature.areaKind === "bark" || feature.areaKind === "other"
      ? feature.areaKind : null;
    features.push({
      id: feature.id,
      kind: feature.kind as PlanFeature["kind"],
      disposition: feature.disposition,
      label: typeof feature.label === "string" ? feature.label.slice(0, 80) : undefined,
      points,
      thicknessInches: finiteOrNull(feature.thicknessInches),
      manualTruckLoads: finiteOrNull(feature.manualTruckLoads),
      areaKind,
    });
  }
  return features;
}

function parseInputs(body: unknown): { jobType: string; features: PlanFeature[] } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { jobType?: unknown; features?: unknown };
  const jobType = typeof record.jobType === "string" && JOB_TYPES.has(record.jobType) ? record.jobType : "sprinkler";
  const features = parseFeatures(record.features ?? []);
  if (!features) return null;
  return { jobType, features };
}

async function ownerQuantity(tenantId: number): Promise<Map<number, { quantity: number; unit: string; name: string; sell: number; pricePerFoot: number | null }>> {
  const items = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId));
  const byId = new Map(items.map(item => [item.id, item]));
  const quantities = new Map<number, { quantity: number; unit: string; name: string; sell: number; pricePerFoot: number | null }>();
  for (const item of items) {
    const owner = byId.get(stockOwnerId(item)) ?? item;
    quantities.set(item.id, {
      quantity: owner.quantity ?? 0,
      unit: item.unit,
      name: item.name,
      sell: sellPrice(item),
      pricePerFoot: item.pricePerFoot,
    });
  }
  return quantities;
}

async function kitBuildable(tenantId: number, parentId: number, quantities: Map<number, { quantity: number }>): Promise<number> {
  const [kit] = await db.select().from(inventoryPartLinksTable)
    .where(and(eq(inventoryPartLinksTable.tenantId, tenantId), eq(inventoryPartLinksTable.parentItemId, parentId)));
  if (!kit) return quantities.get(parentId)?.quantity ?? 0;
  const components = await db.select().from(inventoryPartLinkComponentsTable).where(eq(inventoryPartLinkComponentsTable.linkId, kit.id));
  if (components.length === 0) return quantities.get(parentId)?.quantity ?? 0;
  const parentQuantity = kit.parentQuantity > 0 ? kit.parentQuantity : 1;
  let buildable = Infinity;
  for (const component of components) {
    const perKit = component.quantity / parentQuantity;
    if (!(perKit > 0)) continue;
    buildable = Math.min(buildable, Math.floor((quantities.get(component.inventoryItemId)?.quantity ?? 0) / perKit));
  }
  return Number.isFinite(buildable) ? buildable : 0;
}

async function plannerLinks(tenantId: number): Promise<CatalogLinkInput[]> {
  const [rows, quantities, services, passthroughs, availability, items] = await Promise.all([
    db.select().from(blueprintCatalogLinksTable).where(and(eq(blueprintCatalogLinksTable.tenantId, tenantId), eq(blueprintCatalogLinksTable.active, true))),
    ownerQuantity(tenantId),
    db.select().from(servicesTable).where(eq(servicesTable.tenantId, tenantId)),
    db.select().from(blueprintPassthroughDefaultsTable).where(eq(blueprintPassthroughDefaultsTable.tenantId, tenantId)),
    db.select().from(blueprintCatalogAvailabilityTable).where(eq(blueprintCatalogAvailabilityTable.tenantId, tenantId)),
    db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId)),
  ]);
  const available = new Set(availability.filter(row => row.available).map(row => `${row.sourceKind}:${row.sourceId}`));
  const itemById = new Map(items.map(item => [item.id, item]));
  const serviceById = new Map(services.map(service => [service.id, service]));
  const passById = new Map(passthroughs.map(row => [row.id, row]));
  const links: CatalogLinkInput[] = [];
  for (const row of rows) {
    if (row.sourceKind === "inventory" || row.sourceKind === "kit") {
      const item = itemById.get(row.sourceId);
      if (!item || (row.sourceKind === "inventory" ? !item.availableForBlueprint : !available.has(`kit:${row.sourceId}`))) continue;
      const stock = quantities.get(item.id);
      links.push({
        roleKey: row.roleKey,
        sourceKind: row.sourceKind as CatalogLinkInput["sourceKind"],
        sourceId: row.sourceId,
        name: item.name,
        unit: stock?.unit || item.unit,
        unitPrice: stock?.sell ?? sellPrice(item),
        internalCost: item.unitPrice,
        onHand: row.sourceKind === "kit" ? await kitBuildable(tenantId, item.id, quantities) : stock?.quantity ?? 0,
        customerLabel: row.customerLabel,
      });
    } else if (row.sourceKind === "service") {
      const service = serviceById.get(row.sourceId);
      if (!service || !available.has(`service:${row.sourceId}`)) continue;
      links.push({
        roleKey: row.roleKey,
        sourceKind: "service",
        sourceId: service.id,
        name: service.name,
        unit: service.pricingMode === "hourly" ? "hour" : "each",
        unitPrice: service.pricingMode === "hourly" ? (service.hourlyRate ?? service.basePrice) : service.basePrice,
        internalCost: null,
        onHand: null,
        customerLabel: row.customerLabel,
      });
    } else if (row.sourceKind === "passthrough") {
      const charge = passById.get(row.sourceId);
      if (!charge?.availableForBlueprint) continue;
      links.push({
        roleKey: row.roleKey,
        sourceKind: "passthrough",
        sourceId: charge.id,
        name: charge.name,
        unit: charge.unit || "each",
        unitPrice: charge.unitPrice,
        internalCost: charge.internalCost,
        onHand: null,
        customerLabel: row.customerLabel,
      });
    }
  }
  return links;
}

function versionJson(row: typeof blueprintPlanVersionsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

async function loadBlueprint(tenantId: number, id: number) {
  const [blueprint] = await db.select().from(blueprintsTable).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  return blueprint ?? null;
}

function estimateLines(lines: CustomerLine[]) {
  return lines.filter(line => line.qty > 0 && line.unitPrice >= 0 && line.customerText.trim()).map(line => {
    const service = line.components.length === 1 ? line.components[0] : null;
    if (service?.sourceKind === "service") {
      return {
        id: line.id,
        kind: "service",
        serviceId: service.sourceId,
        description: line.customerText,
        qty: line.qty,
        unitPrice: line.unitPrice,
        markup: 0,
        discount: 0,
        isOptional: false,
        acceptedByCustomer: false,
        components: line.components,
      };
    }
    return {
      id: line.id,
      kind: "custom",
      description: line.customerText,
      qty: line.qty,
      quantity: line.qty,
      unitPrice: line.unitPrice,
      unit: line.unit,
      internalCost: service?.sourceKind === "passthrough" ? service.internalCost : null,
      serviceId: null,
      inventoryItemId: null,
      markup: 0,
      discount: 0,
      isOptional: false,
      acceptedByCustomer: false,
      components: line.components,
    };
  });
}

router.get("/blueprint-planning/catalog", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const [settings, items, kits, services, passthroughs, availability, links] = await Promise.all([
    readSettings(tenantId),
    db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.tenantId, tenantId)),
    db.select().from(inventoryPartLinksTable).where(eq(inventoryPartLinksTable.tenantId, tenantId)),
    db.select().from(servicesTable).where(eq(servicesTable.tenantId, tenantId)),
    db.select().from(blueprintPassthroughDefaultsTable).where(eq(blueprintPassthroughDefaultsTable.tenantId, tenantId)),
    db.select().from(blueprintCatalogAvailabilityTable).where(eq(blueprintCatalogAvailabilityTable.tenantId, tenantId)),
    db.select().from(blueprintCatalogLinksTable).where(eq(blueprintCatalogLinksTable.tenantId, tenantId)),
  ]);
  const available = new Map(availability.map(row => [`${row.sourceKind}:${row.sourceId}`, row.available]));
  const kitParents = new Set(kits.map(kit => kit.parentItemId));
  const nameFor = (sourceKind: string, sourceId: number) => {
    if (sourceKind === "inventory" || sourceKind === "kit") return items.find(item => item.id === sourceId)?.name ?? `${sourceKind} ${sourceId}`;
    if (sourceKind === "service") return services.find(service => service.id === sourceId)?.name ?? `Service ${sourceId}`;
    return passthroughs.find(row => row.id === sourceId)?.name ?? `Charge ${sourceId}`;
  };
  res.json({
    settings,
    roles: ROLE_LABELS,
    requiredRoles: { sprinkler: ["pipe", "sprinkler", "labor", "valve_kit", "manifold_kit", "box", "timer"], gravel: ["gravel"], bark: ["bark"], general: [] },
    links: links.filter(link => link.active).map(link => ({ ...link, name: nameFor(link.sourceKind, link.sourceId), headKey: `${link.sourceKind}:${link.sourceId}` })),
    inventory: items.map(item => ({ id: item.id, name: item.name, sku: item.sku, unit: item.unit, quantity: item.quantity, category: item.category, available: item.availableForBlueprint })),
    kits: items.filter(item => kitParents.has(item.id)).map(item => ({ id: item.id, name: item.name, sku: item.sku, unit: item.unit, available: available.get(`kit:${item.id}`) === true })),
    services: services.map(service => ({ id: service.id, name: service.name, category: service.category, pricingMode: service.pricingMode, basePrice: service.basePrice, hourlyRate: service.hourlyRate, available: available.get(`service:${service.id}`) === true })),
    passthroughs: passthroughs.map(row => ({ id: row.id, name: row.name, unit: row.unit, unitPrice: row.unitPrice, internalCost: row.internalCost, available: row.availableForBlueprint })),
  });
});

router.put("/blueprint-planning/settings", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const buffer = finiteOrNull(req.body?.bufferPercent);
  const exclusions = Array.isArray(req.body?.zoneExclusions) ? req.body.zoneExclusions.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const pair = entry as { a?: unknown; b?: unknown };
    if (typeof pair.a !== "string" || typeof pair.b !== "string" || pair.a === pair.b) return [];
    return [{ a: pair.a.slice(0, 80), b: pair.b.slice(0, 80) }];
  }).slice(0, 100) : [];
  const values = {
    tenantId,
    sprinklerMinSpacingFt: finiteOrNull(req.body?.sprinklerMinSpacingFt),
    sprinklerMaxSpacingFt: finiteOrNull(req.body?.sprinklerMaxSpacingFt),
    tonsPerYard: finiteOrNull(req.body?.tonsPerYard),
    yardsPerTruckLoad: finiteOrNull(req.body?.yardsPerTruckLoad),
    bufferPercent: buffer == null ? 10 : Math.min(100, Math.max(0, buffer)),
    zoneExclusions: exclusions,
    updatedAt: new Date(),
  };
  await db.insert(blueprintPlanningSettingsTable).values(values).onConflictDoUpdate({
    target: blueprintPlanningSettingsTable.tenantId,
    set: {
      sprinklerMinSpacingFt: values.sprinklerMinSpacingFt,
      sprinklerMaxSpacingFt: values.sprinklerMaxSpacingFt,
      tonsPerYard: values.tonsPerYard,
      yardsPerTruckLoad: values.yardsPerTruckLoad,
      bufferPercent: values.bufferPercent,
      zoneExclusions: values.zoneExclusions,
      updatedAt: new Date(),
    },
  });
  res.json(await readSettings(tenantId));
});

router.put("/blueprint-planning/availability", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const sourceKind = String(req.body?.sourceKind ?? "");
  const sourceId = pathId(String(req.body?.sourceId ?? ""));
  const available = req.body?.available === true;
  if (!SOURCE_KINDS.has(sourceKind) || !sourceId) { res.status(400).json({ error: "sourceKind and sourceId are required" }); return; }
  if (sourceKind === "inventory") {
    const [updated] = await db.update(inventoryItemsTable).set({ availableForBlueprint: available })
      .where(and(eq(inventoryItemsTable.id, sourceId), eq(inventoryItemsTable.tenantId, tenantId))).returning({ id: inventoryItemsTable.id });
    if (!updated) { res.status(404).json({ error: "Inventory item not found" }); return; }
  } else if (sourceKind === "passthrough") {
    const [updated] = await db.update(blueprintPassthroughDefaultsTable).set({ availableForBlueprint: available })
      .where(and(eq(blueprintPassthroughDefaultsTable.id, sourceId), eq(blueprintPassthroughDefaultsTable.tenantId, tenantId))).returning({ id: blueprintPassthroughDefaultsTable.id });
    if (!updated) { res.status(404).json({ error: "Pass-through charge not found" }); return; }
  } else {
    await db.insert(blueprintCatalogAvailabilityTable).values({ tenantId, sourceKind, sourceId, available })
      .onConflictDoUpdate({
        target: [blueprintCatalogAvailabilityTable.tenantId, blueprintCatalogAvailabilityTable.sourceKind, blueprintCatalogAvailabilityTable.sourceId],
        set: { available, updatedAt: new Date() },
      });
  }
  if (!available) {
    await db.delete(blueprintCatalogLinksTable).where(and(
      eq(blueprintCatalogLinksTable.tenantId, tenantId),
      eq(blueprintCatalogLinksTable.sourceKind, sourceKind),
      eq(blueprintCatalogLinksTable.sourceId, sourceId),
    ));
  }
  res.json({ sourceKind, sourceId, available });
});

router.put("/blueprint-planning/links", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  if (!Array.isArray(req.body?.links)) { res.status(400).json({ error: "links array is required" }); return; }
  const links: { tenantId: number; roleKey: string; sourceKind: string; sourceId: number; customerLabel: string | null; active: boolean }[] = [];
  for (const entry of req.body.links) {
    const roleKey = String(entry?.roleKey ?? "");
    const sourceKind = String(entry?.sourceKind ?? "");
    const sourceId = pathId(String(entry?.sourceId ?? ""));
    if (!ROLE_KEYS.has(roleKey) || !SOURCE_KINDS.has(sourceKind) || !sourceId) {
      res.status(400).json({ error: "Each link needs a role, a catalog type, and an id" });
      return;
    }
    links.push({
      tenantId,
      roleKey,
      sourceKind,
      sourceId,
      customerLabel: typeof entry?.customerLabel === "string" && entry.customerLabel.trim() ? entry.customerLabel.trim().slice(0, 120) : null,
      active: true,
    });
  }
  await db.transaction(async tx => {
    await tx.delete(blueprintCatalogLinksTable).where(eq(blueprintCatalogLinksTable.tenantId, tenantId));
    if (links.length > 0) await tx.insert(blueprintCatalogLinksTable).values(links);
  });
  res.json({ links });
});

router.post("/blueprint-planning/passthroughs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }
  const [row] = await db.insert(blueprintPassthroughDefaultsTable).values({
    tenantId,
    name: name.slice(0, 120),
    unit: typeof req.body?.unit === "string" && req.body.unit.trim() ? req.body.unit.trim().slice(0, 40) : null,
    unitPrice: Math.max(0, finiteOrNull(req.body?.unitPrice) ?? 0),
    internalCost: finiteOrNull(req.body?.internalCost),
    availableForBlueprint: req.body?.available === true,
  }).returning();
  res.status(201).json(row);
});

router.patch("/blueprint-planning/passthroughs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Partial<typeof blueprintPassthroughDefaultsTable.$inferInsert> = {};
  if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim().slice(0, 120);
  if (req.body?.unit !== undefined) updates.unit = typeof req.body.unit === "string" && req.body.unit.trim() ? req.body.unit.trim().slice(0, 40) : null;
  if (req.body?.unitPrice !== undefined) updates.unitPrice = Math.max(0, finiteOrNull(req.body.unitPrice) ?? 0);
  if (req.body?.internalCost !== undefined) updates.internalCost = finiteOrNull(req.body.internalCost);
  if (req.body?.available !== undefined) updates.availableForBlueprint = req.body.available === true;
  const [row] = await db.update(blueprintPassthroughDefaultsTable).set(updates)
    .where(and(eq(blueprintPassthroughDefaultsTable.id, id), eq(blueprintPassthroughDefaultsTable.tenantId, tenantId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.get("/blueprint-planning/customers/:customerId/blueprints", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const customerId = pathId(req.params.customerId);
  if (!customerId) { res.status(400).json({ error: "Invalid customer" }); return; }
  const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId)));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select({
    id: blueprintsTable.id,
    name: blueprintsTable.name,
    mode: blueprintsTable.mode,
    propertyId: blueprintsTable.propertyId,
    address: propertiesTable.address,
    planningLocked: blueprintsTable.planningLocked,
    planningLockedReason: blueprintsTable.planningLockedReason,
    chosenPlanVersionId: blueprintsTable.chosenPlanVersionId,
    updatedAt: blueprintsTable.updatedAt,
  }).from(blueprintsTable)
    .leftJoin(propertiesTable, eq(blueprintsTable.propertyId, propertiesTable.id))
    .where(and(eq(blueprintsTable.tenantId, tenantId), eq(propertiesTable.customerId, customerId)))
    .orderBy(desc(blueprintsTable.updatedAt));
  res.json(rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })));
});

router.get("/blueprint-planning/blueprints/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const blueprint = await loadBlueprint(tenantId, id);
  if (!blueprint) { res.status(404).json({ error: "Not found" }); return; }
  const lock = await planningLockState(tenantId, id);
  const property = blueprint.propertyId
    ? (await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, blueprint.propertyId), eq(propertiesTable.tenantId, tenantId))))[0] ?? null
    : null;
  const versions = await db.select().from(blueprintPlanVersionsTable)
    .where(and(eq(blueprintPlanVersionsTable.tenantId, tenantId), eq(blueprintPlanVersionsTable.blueprintId, id)))
    .orderBy(desc(blueprintPlanVersionsTable.createdAt));
  res.json({
    blueprint: {
      id: blueprint.id,
      name: blueprint.name,
      mode: blueprint.mode,
      propertyId: blueprint.propertyId,
      jobId: blueprint.jobId,
      planningInputs: blueprint.planningInputs ?? {},
      chosenPlanVersionId: blueprint.chosenPlanVersionId,
      planningLocked: lock?.locked ?? false,
      planningLockedReason: lock?.reason ?? null,
    },
    property: property ? {
      id: property.id,
      customerId: property.customerId,
      address: property.address,
      lat: property.lat,
      lng: property.lng,
      geofenceRadius: property.geofenceRadius,
    } : null,
    settings: await readSettings(tenantId),
    versions: versions.filter(version => version.status !== "archived").map(versionJson),
    archivedVersions: versions.filter(version => version.status === "archived").map(versionJson),
  });
});

router.put("/blueprint-planning/blueprints/:id/inputs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await rejectIfBlueprintLocked(res, tenantId, id)) return;
  const inputs = parseInputs(req.body);
  if (!inputs) { res.status(400).json({ error: "Drawing could not be read" }); return; }
  const [updated] = await db.update(blueprintsTable).set({ planningInputs: inputs })
    .where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId))).returning({ id: blueprintsTable.id });
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(inputs);
});

router.post("/blueprint-planning/blueprints/:id/calculate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await rejectIfBlueprintLocked(res, tenantId, id)) return;
  const blueprint = await loadBlueprint(tenantId, id);
  if (!blueprint) { res.status(404).json({ error: "Not found" }); return; }
  const inputs = parseInputs(req.body?.inputs ?? blueprint.planningInputs);
  if (!inputs) { res.status(400).json({ error: "Drawing could not be read" }); return; }
  await db.update(blueprintsTable).set({ planningInputs: inputs }).where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  const result = buildPlan({ jobType: inputs.jobType, features: inputs.features, settings: await readSettings(tenantId), links: await plannerLinks(tenantId) });
  if (!result.ok) {
    res.status(422).json({ error: "Set up the blueprint links before calculating this plan.", missing: result.missing });
    return;
  }
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : "Full plan";
  const [version] = await db.insert(blueprintPlanVersionsTable).values({
    tenantId,
    blueprintId: id,
    name,
    status: "open",
    inputs,
    plan: result.plan,
    lines: result.plan.customerLines,
    orderList: result.plan.orderList,
    total: linesTotal(result.plan.customerLines),
  }).returning();
  res.status(201).json(versionJson(version));
});

router.post("/blueprint-planning/blueprints/:id/versions/:versionId/duplicate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  const versionId = pathId(req.params.versionId);
  if (!id || !versionId) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await rejectIfBlueprintLocked(res, tenantId, id)) return;
  const [existing] = await db.select().from(blueprintPlanVersionsTable).where(and(
    eq(blueprintPlanVersionsTable.id, versionId),
    eq(blueprintPlanVersionsTable.blueprintId, id),
    eq(blueprintPlanVersionsTable.tenantId, tenantId),
  ));
  if (!existing) { res.status(404).json({ error: "Version not found" }); return; }
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : `${existing.name} copy`;
  const [copy] = await db.insert(blueprintPlanVersionsTable).values({
    tenantId,
    blueprintId: id,
    name,
    status: "open",
    inputs: existing.inputs,
    plan: existing.plan,
    lines: existing.lines,
    orderList: existing.orderList,
    total: existing.total,
  }).returning();
  res.status(201).json(versionJson(copy));
});

router.patch("/blueprint-planning/blueprints/:id/versions/:versionId", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  const versionId = pathId(req.params.versionId);
  if (!id || !versionId) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await rejectIfBlueprintLocked(res, tenantId, id)) return;
  const [existing] = await db.select().from(blueprintPlanVersionsTable).where(and(
    eq(blueprintPlanVersionsTable.id, versionId),
    eq(blueprintPlanVersionsTable.blueprintId, id),
    eq(blueprintPlanVersionsTable.tenantId, tenantId),
  ));
  if (!existing) { res.status(404).json({ error: "Version not found" }); return; }
  if (existing.status === "archived") { res.status(409).json({ error: "Archived versions stay as they were. Choose one to make it the plan again." }); return; }
  const lines = Array.isArray(req.body?.lines) ? req.body.lines as CustomerLine[] : existing.lines as CustomerLine[];
  const cleaned = lines.filter(line => line && typeof line.customerText === "string" && line.customerText.trim() && Number(line.qty) > 0).map(line => ({
    ...line,
    customerText: line.customerText.trim().slice(0, 200),
    qty: Number(line.qty),
    unitPrice: Math.max(0, Number(line.unitPrice) || 0),
    components: Array.isArray(line.components) ? line.components : [],
  }));
  const orderList = orderListFromLines(cleaned);
  const total = linesTotal(cleaned);
  const [updated] = await db.update(blueprintPlanVersionsTable).set({
    name: typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : existing.name,
    lines: cleaned,
    orderList,
    total,
  }).where(eq(blueprintPlanVersionsTable.id, versionId)).returning();
  if (updated.estimateId) {
    const [estimate] = await db.select({ status: estimatesTable.status }).from(estimatesTable)
      .where(and(eq(estimatesTable.id, updated.estimateId), eq(estimatesTable.tenantId, tenantId)));
    if (estimate && estimate.status === "draft") {
      const prepared = prepareLineItems(estimateLines(cleaned), "estimate");
      const subtotal = prepared.reduce((sum, item) => sum + lineExtendedPrice(item), 0);
      await db.update(estimatesTable).set({ lineItems: prepared, subtotal, tax: 0, total: subtotal })
        .where(and(eq(estimatesTable.id, updated.estimateId), eq(estimatesTable.tenantId, tenantId)));
    }
  }
  res.json(versionJson(updated));
});

router.post("/blueprint-planning/blueprints/:id/versions/:versionId/choose", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  const versionId = pathId(req.params.versionId);
  if (!id || !versionId) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await rejectIfBlueprintLocked(res, tenantId, id)) return;
  const versions = await db.select().from(blueprintPlanVersionsTable).where(and(
    eq(blueprintPlanVersionsTable.tenantId, tenantId),
    eq(blueprintPlanVersionsTable.blueprintId, id),
  ));
  if (!versions.some(version => version.id === versionId)) { res.status(404).json({ error: "Version not found" }); return; }
  const next = nextVersionStatuses(versions, versionId);
  const now = new Date();
  await db.transaction(async tx => {
    for (const version of next) {
      await tx.update(blueprintPlanVersionsTable).set({
        status: version.status,
        archivedAt: version.status === "archived" ? (version.archivedAt ?? now) : null,
      }).where(eq(blueprintPlanVersionsTable.id, version.id));
    }
    await tx.update(blueprintsTable).set({ chosenPlanVersionId: versionId, planningInputs: versions.find(version => version.id === versionId)?.inputs ?? {} })
      .where(and(eq(blueprintsTable.id, id), eq(blueprintsTable.tenantId, tenantId)));
  });
  const chosen = next.find(version => version.id === versionId);
  res.json({ chosenId: versionId, status: chosen?.status, archivedIds: next.filter(version => version.status === "archived").map(version => version.id) });
});

router.post("/blueprint-planning/blueprints/:id/versions/:versionId/estimate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = pathId(req.params.id);
  const versionId = pathId(req.params.versionId);
  if (!id || !versionId) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await rejectIfBlueprintLocked(res, tenantId, id)) return;
  const blueprint = await loadBlueprint(tenantId, id);
  const [version] = await db.select().from(blueprintPlanVersionsTable).where(and(
    eq(blueprintPlanVersionsTable.id, versionId),
    eq(blueprintPlanVersionsTable.blueprintId, id),
    eq(blueprintPlanVersionsTable.tenantId, tenantId),
  ));
  if (!blueprint || !version) { res.status(404).json({ error: "Not found" }); return; }
  if (version.status === "archived") { res.status(409).json({ error: "Choose this version before making its estimate." }); return; }
  const property = blueprint.propertyId
    ? (await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, blueprint.propertyId), eq(propertiesTable.tenantId, tenantId))))[0]
    : null;
  const prepared = prepareLineItems(estimateLines(version.lines as CustomerLine[]), "estimate");
  const subtotal = prepared.reduce((sum, item) => sum + lineExtendedPrice(item), 0);
  if (version.estimateId) {
    const [current] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, version.estimateId), eq(estimatesTable.tenantId, tenantId)));
    if (current?.status === "draft") {
      const [updated] = await db.update(estimatesTable).set({ lineItems: prepared, subtotal, tax: 0, total: subtotal, notes: `Blueprint ${blueprint.name} — ${version.name}` })
        .where(eq(estimatesTable.id, current.id)).returning();
      res.json({ id: updated.id, status: updated.status, total: updated.total, updated: true });
      return;
    }
  }
  const [created] = await db.insert(estimatesTable).values({
    tenantId,
    customerId: property?.customerId ?? null,
    propertyId: blueprint.propertyId,
    blueprintId: blueprint.id,
    status: "draft",
    lineItems: prepared,
    subtotal,
    tax: 0,
    total: subtotal,
    notes: `Blueprint ${blueprint.name} — ${version.name}`,
  }).returning();
  await db.update(blueprintPlanVersionsTable).set({ estimateId: created.id }).where(eq(blueprintPlanVersionsTable.id, version.id));
  res.status(201).json({ id: created.id, status: created.status, total: created.total, updated: false });
});

export default router;
