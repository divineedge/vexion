/** Financial report helpers: no catalog prices are substituted for historical purchase costs. */
type Dict = Record<string, unknown>;
export const record = (v: unknown): Dict => v && typeof v === "object" && !Array.isArray(v) ? v as Dict : {};
export const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export const finite = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
export const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function materialBreakdown(parts: unknown, plannedSupplies: unknown) {
  const missing = !Array.isArray(parts) || (parts.length === 0 && array(plannedSupplies).length > 0);
  const materials = array(parts).map(raw => {
    const p = record(raw), usage = record(p._stockUsage);
    const savedQuantity = finite(p.quantity);
    const quantity = Math.max(0, savedQuantity ?? 0);
    const snapshot = finite(usage.total);
    const unit = finite(p.costPrice);
    const total = snapshot !== null && snapshot >= 0 ? snapshot
      : unit !== null && unit >= 0 && savedQuantity !== null && savedQuantity >= 0 ? unit * quantity : null;
    return { name: String(p.name ?? "Supply"), quantity,
      unitCost: total !== null && quantity > 0 ? total / quantity : null,
      cost: total === null ? null : money(total),
      source: snapshot !== null ? "Frozen stock usage" : total !== null ? "Saved purchase cost" : "Purchase cost not recorded" };
  });
  const materialCost = missing || materials.some(p => p.cost === null) ? null
    : money(materials.reduce((sum,p) => sum + p.cost!, 0));
  return { materials, materialCost };
}

/** Exactly the same enabled-zone and legacy name matching rules as job pricing. */
export function jobMeasurement(serviceValue: unknown, propertyValue: unknown, zonesValue: unknown) {
  const service = record(serviceValue), property = record(propertyValue);
  const pricingMode = String(service.pricingMode ?? "unspecified");
  const zones = array(zonesValue).map(record);
  const linked = typeof service.linkedZoneTypeId === "string" ? service.linkedZoneTypeId : null;
  const selected = zones.find(z => z.id === linked);
  const linear = pricingMode === "per_linear_ft" || (linked && selected?.mode === "linear");
  const unit = linear ? "linear_ft" as const : "sqft" as const;
  let found = false, quantity = 0;
  for (const raw of array(property.measurementPolygons)) {
    const p = record(raw);
    if (p.enabled === false) continue;
    const zone = zones.find(z => p.zoneTypeId ? z.id === p.zoneTypeId : z.name === p.label);
    if (linked && (p.zoneTypeId ?? zone?.id) !== linked) continue;
    const mode = p.mode ?? zone?.mode ?? "area";
    if (linear ? mode !== "linear" : mode === "linear") continue;
    const value = finite(linear ? p.lengthFt : p.areaSqft);
    if (value !== null && value > 0) { found = true; quantity += value; }
  }
  if (!linked && !linear && !found) {
    const aggregate = finite(property.serviceableAreaSqft);
    if (aggregate !== null && aggregate > 0) { found = true; quantity = aggregate; }
  }
  const measurement = found ? quantity : null;
  let matrixLabel = pricingMode === "matrix" ? "No matching tier" : "Not matrix priced";
  if (pricingMode === "matrix" && measurement !== null) {
    const tiers = array(service.pricingMatrix).map(record)
      .filter(t=>finite(t.minSqft)!==null && (t.maxSqft === null || finite(t.maxSqft)!==null))
      .sort((a,b)=>Number(a.minSqft)-Number(b.minSqft));
    const tier = tiers.find(t => measurement >= Number(t.minSqft) && (t.maxSqft === null || measurement <= Number(t.maxSqft)));
    if (tier) matrixLabel = `${Number(tier.minSqft).toLocaleString("en-US")}–${tier.maxSqft === null ? "above" : Number(tier.maxSqft).toLocaleString("en-US")} ${linear ? "linear ft" : "sq ft"}`;
  }
  return { measurement, measurementUnit: measurement === null ? null : unit, matrixLabel, pricingMode };
}

export function reportCostTotals(labor: number | null, materials: number | null, fuel: number, other: number, revenue: number, knownLabor=0, knownMaterials=0) {
  const knownCost = money((labor ?? knownLabor) + (materials ?? knownMaterials) + fuel + other);
  const totalCost = labor === null || materials === null ? null : knownCost;
  const profit = totalCost === null ? null : money(revenue-totalCost);
  return { knownCost, totalCost, profit,
    marginPct: profit === null || revenue <= 0 ? null : profit/revenue*100 };
}
