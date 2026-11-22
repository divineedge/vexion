/**
 * Blueprint planning math. Pure: it does not read stock or write deductions.
 * A calculated plan lists what to order. Measured uses and kit uses remain
 * the only stock deduction, so a blueprint tied to a job is not deducted twice.
 */

export type LatLng = { lat: number; lng: number };

export type PlanFeature = {
  id: string;
  kind: "outline" | "work_area" | "water_hookup" | "driveway" | "house" | "tree" | "rock" | "gravel" | "bark" | "curb";
  disposition: "existing" | "bid";
  label?: string;
  points: LatLng[];
  thicknessInches?: number | null;
  manualTruckLoads?: number | null;
  areaKind?: "lawn" | "gravel" | "bark" | "other" | null;
};

export type HeadTypeName = "sprinkler" | "drip";

export type CatalogLinkInput = {
  roleKey: string;
  sourceKind: "inventory" | "kit" | "service" | "passthrough";
  sourceId: number;
  name: string;
  unit: string;
  unitPrice: number;
  internalCost: number | null;
  onHand: number | null;
  customerLabel?: string | null;
  /** Sprinkler and drip emitters use different spacing. Null on a sprinkler role means sprinkler. */
  headType?: HeadTypeName | null;
  nozzle?: string | null;
  throwFt?: number | null;
  arcDegrees?: number | null;
  pattern?: string | null;
};

/** Company or blueprint spacing for a head type, or for one specific head. */
export type HeadRule = {
  headType: HeadTypeName;
  headKey: string | null;
  minSpacingFt: number | null;
  maxSpacingFt: number | null;
};

/** Null means this blueprint keeps the company rules. A partial list changes only those rules. */
export type BlueprintRuleOverride = {
  headRules?: HeadRule[];
  zoneExclusions?: { a: string; b: string }[];
} | null;

export type PlanningSettingsInput = {
  sprinklerMinSpacingFt: number | null;
  sprinklerMaxSpacingFt: number | null;
  tonsPerYard: number | null;
  yardsPerTruckLoad: number | null;
  bufferPercent: number;
  zoneExclusions: { a: string; b: string }[];
  headRules?: HeadRule[];
};

export type PlanComponent = {
  roleKey: string;
  sourceKind: string;
  sourceId: number;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  internalCost: number | null;
  onHand: number | null;
};

export type CustomerLine = {
  id: string;
  customerText: string;
  qty: number;
  unit: string | null;
  unitPrice: number;
  components: PlanComponent[];
};

export type OrderRow = {
  key: string;
  roleKey: string;
  name: string;
  unit: string;
  required: number;
  onHand: number | null;
  toOrder: number | null;
  linked: boolean;
  sourceKind: string;
  sourceId: number;
};

export type DrawnHead = {
  id: string;
  zone: number;
  headKey: string;
  name: string;
  headType: HeadTypeName;
  lat: number;
  lng: number;
  /** Short label from the nozzle, throw, arc, or pattern stored on the head. Null when the nozzle is not stored. */
  nozzle: string | null;
  /** Which of nozzle, throw, arc, or pattern is not stored on this head. */
  nozzleNote: string | null;
};

export type DrawnLine = {
  id: string;
  kind: "main" | "lateral" | "curb";
  zone: number | null;
  points: LatLng[];
};

export type MaterialResult = {
  kind: "gravel" | "bark";
  featureId: string;
  label: string;
  areaSqft: number;
  thicknessInches: number | null;
  yards: number | null;
  tons: number | null;
  truckLoads: number | null;
  manualTruckLoads: number | null;
  question: string | null;
};

export type BuiltPlan = {
  jobType: string;
  bufferPercent: number;
  heads: DrawnHead[];
  lines: DrawnLine[];
  curbFeet: number | null;
  materials: MaterialResult[];
  questions: string[];
  customerLines: CustomerLine[];
  orderList: OrderRow[];
  zoneCount: number;
};

export const ROLE_LABELS: Record<string, string> = {
  pipe: "Pipe",
  sprinkler: "Sprinklers",
  labor: "Labor",
  valve_kit: "Valve kits",
  manifold_kit: "Manifold kits",
  box: "Valve box",
  timer: "Sprinkler timer",
  elbow: "Elbow",
  tee: "Tee",
  gravel: "Gravel",
  bark: "Bark",
  curb: "Curb",
};

export const REQUIRED_ROLES: Record<string, string[]> = {
  sprinkler: ["pipe", "sprinkler", "labor", "valve_kit", "manifold_kit", "box", "timer"],
  gravel: ["gravel"],
  bark: ["bark"],
  general: [],
};

const EARTH_RADIUS_M = 6371000;
const SQM_TO_SQFT = 10.76391041671;
const M_TO_FT = 3.280839895;

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceFt(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * M_TO_FT;
}

export function pathLengthFt(points: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += distanceFt(points[i], points[i + 1]);
  return total;
}

export function polygonAreaSqFt(vertices: LatLng[]): number {
  if (vertices.length < 3) return 0;
  const centerLat = vertices.reduce((sum, vertex) => sum + vertex.lat, 0) / vertices.length;
  const cosLat = Math.cos(toRad(centerLat));
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const xi = vertices[i].lng * cosLat * EARTH_RADIUS_M * (Math.PI / 180);
    const yi = vertices[i].lat * EARTH_RADIUS_M * (Math.PI / 180);
    const xj = vertices[j].lng * cosLat * EARTH_RADIUS_M * (Math.PI / 180);
    const yj = vertices[j].lat * EARTH_RADIUS_M * (Math.PI / 180);
    area += xi * yj - xj * yi;
  }
  return (Math.abs(area) / 2) * SQM_TO_SQFT;
}

export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat;
    const xi = polygon[i].lng;
    const yj = polygon[j].lat;
    const xj = polygon[j].lng;
    const intersect = (yi > point.lat) !== (yj > point.lat)
      && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function centroid(points: LatLng[]): LatLng {
  const sum = points.reduce((acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

function feetToLat(feet: number): number {
  return feet / (EARTH_RADIUS_M * M_TO_FT * Math.PI / 180);
}

function feetToLng(feet: number, lat: number): number {
  return feet / (EARTH_RADIUS_M * M_TO_FT * Math.cos(toRad(lat)) * Math.PI / 180);
}

export function bufferedCount(raw: number, bufferPercent: number): number {
  if (!(raw > 0)) return 0;
  const percent = Number.isFinite(bufferPercent) ? bufferPercent : 0;
  return Math.ceil(raw * (1 + percent / 100) - 1e-9);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function headKey(link: Pick<CatalogLinkInput, "sourceKind" | "sourceId">): string {
  return `${link.sourceKind}:${link.sourceId}`;
}

export function linkHeadType(link: Pick<CatalogLinkInput, "roleKey" | "headType">): HeadTypeName {
  if (link.headType === "drip" || link.roleKey === "drip") return "drip";
  return "sprinkler";
}

function cleanHeadRule(rule: HeadRule): HeadRule | null {
  if (rule.headType !== "sprinkler" && rule.headType !== "drip") return null;
  const min = rule.minSpacingFt == null ? null : Number(rule.minSpacingFt);
  const max = rule.maxSpacingFt == null ? null : Number(rule.maxSpacingFt);
  if (min != null && !Number.isFinite(min)) return null;
  if (max != null && !Number.isFinite(max)) return null;
  return {
    headType: rule.headType,
    headKey: rule.headKey ? String(rule.headKey).slice(0, 80) : null,
    minSpacingFt: min,
    maxSpacingFt: max,
  };
}

export function companyHeadRules(settings: PlanningSettingsInput): HeadRule[] {
  const stored = (settings.headRules ?? []).flatMap(rule => {
    const cleaned = cleanHeadRule(rule);
    return cleaned ? [cleaned] : [];
  });
  const hasSprinklerType = stored.some(rule => rule.headType === "sprinkler" && !rule.headKey && rule.minSpacingFt != null && rule.maxSpacingFt != null);
  if (!hasSprinklerType && settings.sprinklerMinSpacingFt != null && settings.sprinklerMaxSpacingFt != null) {
    stored.unshift({
      headType: "sprinkler",
      headKey: null,
      minSpacingFt: settings.sprinklerMinSpacingFt,
      maxSpacingFt: settings.sprinklerMaxSpacingFt,
    });
  }
  return stored;
}

/** Company rules apply until a blueprint stores a change. An override replaces only the matching rule. */
export function resolvePlanningRules(company: PlanningSettingsInput, override: BlueprintRuleOverride): PlanningSettingsInput {
  const merged = companyHeadRules(company).map(rule => ({ ...rule }));
  for (const raw of override?.headRules ?? []) {
    const rule = cleanHeadRule(raw);
    if (!rule || rule.minSpacingFt == null || rule.maxSpacingFt == null) continue;
    const index = merged.findIndex(item => item.headType === rule.headType && (item.headKey ?? null) === (rule.headKey ?? null));
    if (index >= 0) merged[index] = rule;
    else merged.push(rule);
  }
  const sprinkler = merged.find(rule => rule.headType === "sprinkler" && !rule.headKey);
  return {
    ...company,
    headRules: merged,
    sprinklerMinSpacingFt: sprinkler?.minSpacingFt ?? company.sprinklerMinSpacingFt,
    sprinklerMaxSpacingFt: sprinkler?.maxSpacingFt ?? company.sprinklerMaxSpacingFt,
    zoneExclusions: override?.zoneExclusions ?? company.zoneExclusions,
  };
}

export function spacingFor(settings: PlanningSettingsInput, headType: HeadTypeName, key: string | null): { minSpacingFt: number; maxSpacingFt: number } | null {
  const rules = companyHeadRules(settings);
  const specific = key ? rules.find(rule => rule.headType === headType && rule.headKey === key && rule.minSpacingFt != null && rule.maxSpacingFt != null) : undefined;
  const typed = rules.find(rule => rule.headType === headType && !rule.headKey && rule.minSpacingFt != null && rule.maxSpacingFt != null);
  const chosen = specific ?? typed;
  if (!chosen || chosen.minSpacingFt == null || chosen.maxSpacingFt == null) return null;
  return { minSpacingFt: chosen.minSpacingFt, maxSpacingFt: chosen.maxSpacingFt };
}

/** A short nozzle label from details stored on the head. Nothing here is calculated. */
export function suggestNozzle(specs: { nozzle?: string | null; throwFt?: number | null; arcDegrees?: number | null; pattern?: string | null }): { nozzle: string | null; missing: string | null } {
  const missing: string[] = [];
  const nozzle = specs.nozzle?.trim() || "";
  if (!nozzle) missing.push("nozzle");
  if (!(typeof specs.throwFt === "number" && Number.isFinite(specs.throwFt) && specs.throwFt > 0)) missing.push("throw");
  if (!(typeof specs.arcDegrees === "number" && Number.isFinite(specs.arcDegrees) && specs.arcDegrees > 0)) missing.push("arc");
  if (!specs.pattern?.trim()) missing.push("pattern");
  if (!nozzle) return { nozzle: null, missing: missing.length ? `Missing ${missing.join(", ")}` : null };
  const bits = [nozzle];
  if (!missing.includes("throw")) bits.push(`${specs.throwFt} ft`);
  if (!missing.includes("arc")) bits.push(`${specs.arcDegrees}°`);
  if (!missing.includes("pattern")) bits.push(specs.pattern!.trim());
  return { nozzle: bits.join(" · "), missing: missing.length ? `Missing ${missing.join(", ")}` : null };
}

function conflicts(a: string, b: string, exclusions: { a: string; b: string }[]): boolean {
  if (a === b) return false;
  return exclusions.some(pair => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a));
}

export function placeSprinklers(polygon: LatLng[], minFt: number, maxFt: number): LatLng[] {
  if (!(minFt > 0) || !(maxFt > 0) || minFt > maxFt || polygon.length < 3) return [];
  const lats = polygon.map(point => point.lat);
  const lngs = polygon.map(point => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const stepLat = feetToLat(maxFt);
  const stepLng = feetToLng(maxFt, midLat);
  const kept: LatLng[] = [];
  for (let lat = minLat + stepLat / 2; lat < maxLat; lat += stepLat) {
    for (let lng = minLng + stepLng / 2; lng < maxLng; lng += stepLng) {
      const point = { lat, lng };
      if (!pointInPolygon(point, polygon)) continue;
      if (kept.some(other => distanceFt(other, point) < minFt - 0.05)) continue;
      kept.push(point);
    }
  }
  if (kept.length === 0) {
    const center = centroid(polygon);
    if (pointInPolygon(center, polygon)) kept.push(center);
  }
  return kept;
}

export function assignZones(headKeys: string[], exclusions: { a: string; b: string }[]): number[] {
  const zones: string[][] = [];
  return headKeys.map(key => {
    let zone = zones.findIndex(keys => keys.every(existing => !conflicts(existing, key, exclusions)));
    if (zone < 0) {
      zone = zones.length;
      zones.push([]);
    }
    if (!zones[zone].includes(key)) zones[zone].push(key);
    return zone;
  });
}

function assignHeadKeys(points: LatLng[], sprinklers: CatalogLinkInput[], exclusions: { a: string; b: string }[]): string[] {
  const keys = sprinklers.map(headKey);
  if (keys.length === 0) return points.map(() => "");
  const separated = keys.filter(key => keys.some(other => conflicts(key, other, exclusions)));
  if (separated.length < 2) return points.map(() => keys[0]);
  const order = points.map((point, index) => ({ point, index })).sort((a, b) => a.point.lng - b.point.lng || a.point.lat - b.point.lat);
  const assigned = points.map(() => keys[0]);
  order.forEach((entry, index) => {
    const bucket = Math.min(separated.length - 1, Math.floor((index * separated.length) / order.length));
    assigned[entry.index] = separated[bucket];
  });
  return assigned;
}

function turnDegrees(a: LatLng, b: LatLng, c: LatLng): number {
  const v1 = { x: b.lng - a.lng, y: b.lat - a.lat };
  const v2 = { x: c.lng - b.lng, y: c.lat - b.lat };
  const magnitude = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (magnitude === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / magnitude));
  return (Math.acos(cos) * 180) / Math.PI;
}

function manifoldElbows(main: LatLng[], lateral: LatLng[]): number {
  if (main.length < 2 || lateral.length < 2) return 0;
  return turnDegrees(main[main.length - 2], lateral[0], lateral[1]) > 20 ? 1 : 0;
}

function elbowCount(path: LatLng[]): number {
  let elbows = 0;
  for (let i = 1; i < path.length - 1; i++) {
    if (turnDegrees(path[i - 1], path[i], path[i + 1]) > 20) elbows += 1;
  }
  return elbows;
}

function nearestNeighbor(start: LatLng, points: LatLng[]): LatLng[] {
  const remaining = [...points];
  const path = [start];
  let current = start;
  while (remaining.length > 0) {
    let best = 0;
    let bestDistance = Infinity;
    remaining.forEach((point, index) => {
      const length = distanceFt(current, point);
      if (length < bestDistance) {
        bestDistance = length;
        best = index;
      }
    });
    current = remaining.splice(best, 1)[0];
    path.push(current);
  }
  return path;
}

function linksFor(links: CatalogLinkInput[], role: string): CatalogLinkInput[] {
  return links.filter(link => link.roleKey === role);
}

function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? "").trim().toLowerCase().replace(/\.$/, "");
}

function lengthUnit(unit: string | null | undefined): boolean {
  const value = normalizeUnit(unit);
  return value === "ft" || value === "feet" || value === "foot" || value === "linear ft" || value === "'" || value === "lf";
}

function sameUnit(a: string, b: string | null | undefined): boolean {
  const left = normalizeUnit(a);
  const right = normalizeUnit(b);
  if (!left || !right) return false;
  if (lengthUnit(left) && lengthUnit(right)) return true;
  return left === right;
}

export function orderListFromLines(lines: CustomerLine[]): OrderRow[] {
  return lines.flatMap(line => line.components.map(component => ({
    key: `${line.id}:${component.roleKey}:${component.sourceKind}:${component.sourceId}`,
    roleKey: component.roleKey,
    name: component.name,
    unit: component.unit,
    required: component.qty,
    onHand: component.onHand,
    toOrder: component.onHand == null ? null : Math.max(0, round2(component.qty - component.onHand)),
    linked: component.sourceKind !== "unlinked",
    sourceKind: component.sourceKind,
    sourceId: component.sourceId,
  })));
}

export function linesTotal(lines: CustomerLine[]): number {
  return round2(lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0));
}

export function nextVersionStatuses<T extends { id: number; status: string }>(versions: T[], chosenId: number): T[] {
  return versions.map(version => {
    if (version.id === chosenId) return { ...version, status: "chosen" };
    if (version.status === "archived") return version;
    return { ...version, status: "archived" };
  });
}

export function lockReason(input: { estimateStatuses: string[]; jobStatuses: string[] }): string | null {
  if (input.estimateStatuses.some(status => status.trim().toLowerCase() === "approved")) return "Estimate accepted";
  if (input.jobStatuses.some(status => status.trim().toLowerCase() === "completed")) return "Job completed";
  return null;
}

function componentFrom(link: CatalogLinkInput | undefined, roleKey: string, fallbackName: string, qty: number, unit: string): PlanComponent {
  return {
    roleKey,
    sourceKind: link?.sourceKind ?? "unlinked",
    sourceId: link?.sourceId ?? 0,
    name: link?.customerLabel?.trim() || link?.name || fallbackName,
    qty,
    unit,
    unitPrice: link?.unitPrice ?? 0,
    internalCost: link?.internalCost ?? null,
    onHand: link && sameUnit(unit, link.unit) ? link.onHand : null,
  };
}

function singleLine(id: string, text: string, component: PlanComponent): CustomerLine {
  const extended = round2(component.qty * component.unitPrice);
  return {
    id,
    customerText: text,
    qty: component.qty > 0 && component.unit ? component.qty : 1,
    unit: component.unit,
    unitPrice: component.qty > 0 ? component.unitPrice : extended,
    components: [component],
  };
}

function bidAreas(features: PlanFeature[], kind: "gravel" | "bark"): PlanFeature[] {
  return features.filter(feature => feature.disposition === "bid" && (
    feature.kind === kind || (feature.kind === "work_area" && feature.areaKind === kind)
  ) && feature.points.length >= 3);
}

export function missingPlanSetup(jobType: string, settings: PlanningSettingsInput, links: CatalogLinkInput[], features: PlanFeature[]): string[] {
  const missing: string[] = [];
  for (const role of REQUIRED_ROLES[jobType] ?? []) {
    if (!links.some(link => link.roleKey === role)) missing.push(`Link ${ROLE_LABELS[role] ?? role} in blueprint planning settings`);
  }
  if (jobType === "sprinkler") {
    const emitters = links.filter(link => link.roleKey === "sprinkler" || link.roleKey === "drip" || link.headType === "sprinkler" || link.headType === "drip");
    const types = new Set(emitters.map(linkHeadType));
    if (!types.size || types.has("sprinkler")) {
      const spacing = spacingFor(settings, "sprinkler", null);
      if (!spacing) missing.push("Set how close sprinklers can be and how far apart they go");
      else if (spacing.minSpacingFt > spacing.maxSpacingFt) missing.push("The closest sprinkler spacing has to be less than or equal to the farthest");
    }
    if (types.has("drip")) {
      const spacing = spacingFor(settings, "drip", null);
      const uncovered = emitters.filter(link => linkHeadType(link) === "drip" && !spacingFor(settings, "drip", headKey(link)));
      if (uncovered.length) missing.push("Set how close drip emitters can be and how far apart they go");
      else if (spacing && spacing.minSpacingFt > spacing.maxSpacingFt) missing.push("The closest drip spacing has to be less than or equal to the farthest");
    }
    const lawn = features.some(feature => feature.kind === "work_area" && feature.areaKind === "lawn" && feature.points.length >= 3);
    const outline = features.some(feature => feature.kind === "outline" && feature.points.length >= 3);
    if (!lawn && !outline) missing.push("Mark the property outline or a lawn work area");
    if (!features.some(feature => feature.kind === "water_hookup" && feature.points.length >= 1)) missing.push("Mark the main water hookup");
  }
  if (jobType === "gravel" || jobType === "bark") {
    if (bidAreas(features, jobType).length === 0) missing.push(`Mark a ${jobType} area that is part of the bid`);
  }
  return missing;
}

function materialFor(feature: PlanFeature, kind: "gravel" | "bark", settings: PlanningSettingsInput): MaterialResult {
  const areaSqft = polygonAreaSqFt(feature.points);
  const label = feature.label?.trim() || kind;
  const thickness = feature.thicknessInches ?? null;
  const manual = feature.manualTruckLoads ?? null;
  if (thickness == null || !(thickness > 0)) {
    return {
      kind, featureId: feature.id, label, areaSqft, thicknessInches: thickness,
      yards: null, tons: null, truckLoads: manual, manualTruckLoads: manual,
      question: `Enter a thickness in inches for ${label}. Yards, tons, and truck loads stay blank until then.`,
    };
  }
  const yards = round2((areaSqft * (thickness / 12) / 27) * (1 + (settings.bufferPercent || 0) / 100));
  const tons = settings.tonsPerYard != null && settings.tonsPerYard > 0 ? round2(yards * settings.tonsPerYard) : null;
  let truckLoads: number | null = null;
  if (manual != null && manual >= 0) truckLoads = manual;
  else if (settings.yardsPerTruckLoad != null && settings.yardsPerTruckLoad > 0) truckLoads = Math.ceil(yards / settings.yardsPerTruckLoad - 1e-9);
  const question = tons == null && truckLoads == null
    ? `Set tons per yard or yards per truck load in blueprint planning settings to convert ${label}. Yards are calculated without assuming a density.`
    : null;
  return { kind, featureId: feature.id, label, areaSqft, thicknessInches: thickness, yards, tons, truckLoads, manualTruckLoads: manual, question };
}

function materialQty(material: MaterialResult, link: CatalogLinkInput | undefined): { qty: number; unit: string } | null {
  if (material.yards == null) return null;
  const unit = normalizeUnit(link?.unit);
  if (unit.includes("ton") && material.tons != null) return { qty: material.tons, unit: link?.unit || "ton" };
  if ((unit.includes("load") || unit.includes("truck")) && material.truckLoads != null) return { qty: material.truckLoads, unit: link?.unit || "load" };
  if (unit.includes("yard") || unit === "yd" || unit === "cu yd" || unit === "cubic yard") return { qty: material.yards, unit: link?.unit || "yard" };
  if (material.tons != null) return { qty: material.tons, unit: "ton" };
  if (material.truckLoads != null) return { qty: material.truckLoads, unit: "load" };
  return { qty: material.yards, unit: "yard" };
}

export function buildPlan(input: {
  jobType: string;
  features: PlanFeature[];
  settings: PlanningSettingsInput;
  links: CatalogLinkInput[];
}): { ok: false; missing: string[] } | { ok: true; plan: BuiltPlan } {
  const jobType = input.jobType || "sprinkler";
  const missing = missingPlanSetup(jobType, input.settings, input.links, input.features);
  if (missing.length > 0) return { ok: false, missing };
  const buffer = Number.isFinite(input.settings.bufferPercent) ? input.settings.bufferPercent : 10;
  const settings = { ...input.settings, bufferPercent: buffer };
  const questions: string[] = [];
  const customerLines: CustomerLine[] = [];
  const drawnLines: DrawnLine[] = [];
  let heads: DrawnHead[] = [];
  let zoneCount = 0;

  if (jobType === "sprinkler") {
    const areas = input.features.filter(feature => feature.kind === "work_area" && feature.areaKind === "lawn" && feature.points.length >= 3);
    const polygons = areas.length > 0 ? areas : input.features.filter(feature => feature.kind === "outline" && feature.points.length >= 3);
    const sprinklers = input.links.filter(link => link.roleKey === "sprinkler" || link.roleKey === "drip" || link.headType === "sprinkler" || link.headType === "drip");
    const groups = new Map<string, CatalogLinkInput[]>();
    for (const link of sprinklers) {
      const spacing = spacingFor(settings, linkHeadType(link), headKey(link));
      const specific = spacingFor(settings, linkHeadType(link), headKey(link)) && (settings.headRules ?? []).some(rule => rule.headKey === headKey(link) && rule.headType === linkHeadType(link) && rule.minSpacingFt != null && rule.maxSpacingFt != null);
      const groupId = specific ? `head:${headKey(link)}` : `type:${linkHeadType(link)}`;
      groups.set(groupId, [...(groups.get(groupId) ?? []), link]);
    }
    const placedPoints: LatLng[] = [];
    const placedKeys: string[] = [];
    for (const group of groups.values()) {
      const sample = group[0];
      const spacing = spacingFor(settings, linkHeadType(sample), headKey(sample));
      if (!spacing) continue;
      const points = polygons.flatMap(area => placeSprinklers(area.points, spacing.minSpacingFt, spacing.maxSpacingFt));
      const keys = assignHeadKeys(points, group, settings.zoneExclusions);
      placedPoints.push(...points);
      placedKeys.push(...keys);
    }
    const zones = assignZones(placedKeys, settings.zoneExclusions);
    zoneCount = zones.length === 0 ? 0 : Math.max(...zones) + 1;
    heads = placedPoints.map((point, index) => {
      const key = placedKeys[index];
      const link = sprinklers.find(item => headKey(item) === key) ?? sprinklers[0];
      const suggestion = suggestNozzle(link ?? {});
      if (suggestion.missing && link && !questions.includes(`${link.name}: ${suggestion.missing}`)) questions.push(`${link.name}: ${suggestion.missing}`);
      return {
        id: `head_${index + 1}`,
        zone: zones[index] ?? 0,
        headKey: key,
        name: link?.name ?? "Sprinkler",
        headType: link ? linkHeadType(link) : "sprinkler",
        lat: point.lat,
        lng: point.lng,
        nozzle: suggestion.nozzle,
        nozzleNote: suggestion.missing,
      };
    });
    const hookup = input.features.find(feature => feature.kind === "water_hookup" && feature.points.length >= 1);
    const hookPoint = hookup?.points[0];
    const center = heads.length > 0 ? centroid(heads.map(head => ({ lat: head.lat, lng: head.lng }))) : hookPoint;
    if (hookPoint && center) {
      drawnLines.push({ id: "main", kind: "main", zone: null, points: [hookPoint, center] });
      for (let zone = 0; zone < zoneCount; zone++) {
        const zoneHeads = heads.filter(head => head.zone === zone).map(head => ({ lat: head.lat, lng: head.lng }));
        if (zoneHeads.length === 0) continue;
        drawnLines.push({ id: `lateral_${zone + 1}`, kind: "lateral", zone, points: nearestNeighbor(center, zoneHeads) });
      }
    }
    const main = drawnLines.find(line => line.kind === "main");
    const laterals = drawnLines.filter(line => line.kind === "lateral");
    const rawElbows = drawnLines.reduce((sum, line) => sum + elbowCount(line.points), 0)
      + laterals.reduce((sum, line) => sum + (main ? manifoldElbows(main.points, line.points) : 0), 0);
    const pipeFeet = bufferedCount(drawnLines.reduce((sum, line) => sum + pathLengthFt(line.points), 0), buffer);
    const elbows = bufferedCount(rawElbows, buffer);
    const tees = bufferedCount(zoneCount, buffer);
    const pipeLink = linksFor(input.links, "pipe")[0];
    const pipeUnit = pipeLink && lengthUnit(pipeLink.unit) ? pipeLink.unit : "ft";
    const pipe = componentFrom(pipeLink, "pipe", "Pipe", pipeFeet, pipeUnit);
    if (pipeLink && !lengthUnit(pipeLink.unit)) {
      questions.push(`${pipeLink.name} is stocked in ${pipeLink.unit}. The plan measures pipe in feet, so compare those units before ordering.`);
    }
    const elbow = componentFrom(linksFor(input.links, "elbow")[0], "elbow", "Elbow", elbows, "each");
    const tee = componentFrom(linksFor(input.links, "tee")[0], "tee", "Tee", tees, "each");
    const fittingParts = [pipe, elbow, tee];
    if (fittingParts.length > 0) {
      customerLines.push({
        id: "pipe_and_fittings",
        customerText: "Pipe and fittings",
        qty: 1,
        unit: null,
        unitPrice: round2(fittingParts.reduce((sum, part) => sum + part.qty * part.unitPrice, 0)),
        components: fittingParts,
      });
    }
    const byHead = new Map<string, number>();
    for (const head of heads) byHead.set(head.headKey, (byHead.get(head.headKey) ?? 0) + 1);
    const headComponents = [...byHead.entries()].map(([key, count]) => {
      const link = sprinklers.find(item => headKey(item) === key) ?? sprinklers[0];
      return componentFrom(link, "sprinkler", "Sprinkler", bufferedCount(count, buffer), link?.unit || "each");
    });
    if (headComponents.length > 0) {
      customerLines.push({
        id: "sprinklers",
        customerText: headComponents.length === 1 ? headComponents[0].name : "Sprinklers",
        qty: headComponents.length === 1 ? headComponents[0].qty : 1,
        unit: headComponents.length === 1 ? headComponents[0].unit : null,
        unitPrice: headComponents.length === 1 ? headComponents[0].unitPrice : round2(headComponents.reduce((sum, part) => sum + part.qty * part.unitPrice, 0)),
        components: headComponents,
      });
    }
    const zoneQty = bufferedCount(Math.max(zoneCount, 1), buffer);
    for (const [role, qty, text] of [
      ["valve_kit", zoneQty, "Valve kits"],
      ["box", zoneQty, "Valve boxes"],
      ["manifold_kit", bufferedCount(1, buffer), "Manifold kit"],
      ["timer", bufferedCount(1, buffer), "Sprinkler timer"],
      ["labor", 1, "Labor"],
    ] as const) {
      const link = linksFor(input.links, role)[0];
      if (!link) continue;
      const part = componentFrom(link, role, text, qty, link.unit || "each");
      customerLines.push(singleLine(role, link.customerLabel?.trim() || text, part));
    }
  }

  const curbFeatures = input.features.filter(feature => feature.kind === "curb" && feature.points.length >= 2);
  const curbFeetRaw = curbFeatures.reduce((sum, feature) => sum + pathLengthFt(feature.points), 0);
  const curbFeet = curbFeetRaw > 0 ? round2(curbFeetRaw) : null;
  curbFeatures.forEach((feature, index) => {
    drawnLines.push({ id: `curb_${index + 1}`, kind: "curb", zone: null, points: feature.points });
  });
  const bidCurb = curbFeatures.filter(feature => feature.disposition === "bid");
  if (bidCurb.length > 0) {
    const link = linksFor(input.links, "curb")[0];
    const feet = bufferedCount(bidCurb.reduce((sum, feature) => sum + pathLengthFt(feature.points), 0), buffer);
    if (link) {
      const part = componentFrom(link, "curb", "Curb", feet, lengthUnit(link.unit) ? link.unit : "ft");
      customerLines.push(singleLine("curb", link.customerLabel?.trim() || "Curb", part));
    } else {
      questions.push("Curb length is measured. Link a curb charge to put it on the estimate.");
    }
  }

  for (const kind of ["gravel", "bark"] as const) {
    const areas = bidAreas(input.features, kind);
    const link = linksFor(input.links, kind)[0];
    areas.forEach((feature, index) => {
      const material = materialFor(feature, kind, settings);
      if (material.question) questions.push(material.question);
      const qty = materialQty(material, link);
      if (qty && link) {
        const part = componentFrom(link, kind, material.label, qty.qty, qty.unit);
        customerLines.push(singleLine(`${kind}_${index + 1}`, link.customerLabel?.trim() || material.label, part));
      } else if (qty && !link) {
        questions.push(`Link a ${kind} item or pass-through to price ${material.label}.`);
      }
    });
  }

  const materials = collectMaterials(input.features, settings, questions);
  const orderList = orderListFromLines(customerLines);
  return {
    ok: true,
    plan: {
      jobType,
      bufferPercent: buffer,
      heads,
      lines: drawnLines,
      curbFeet,
      materials,
      questions: unique(questions),
      customerLines,
      orderList,
      zoneCount,
    },
  };
}

function collectMaterials(features: PlanFeature[], settings: PlanningSettingsInput, questions: string[]): MaterialResult[] {
  const materials: MaterialResult[] = [];
  for (const kind of ["gravel", "bark"] as const) {
    for (const feature of bidAreas(features, kind)) {
      const material = materialFor(feature, kind, settings);
      materials.push(material);
      if (material.question && !questions.includes(material.question)) questions.push(material.question);
    }
  }
  return materials;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
