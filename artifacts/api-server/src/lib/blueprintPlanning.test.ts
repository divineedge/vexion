import { describe, expect, it } from "vitest";
import {
  buildPlan,
  distanceFt,
  lockReason,
  nextVersionStatuses,
  orderListFromLines,
  polygonAreaSqFt,
  resolvePlanningRules,
  spacingFor,
  type CatalogLinkInput,
  type PlanFeature,
  type PlanningSettingsInput,
} from "./blueprintPlanning";

const center = { lat: 47.6, lng: -122.3 };

function square(sideFt: number): PlanFeature["points"] {
  const halfLat = (sideFt / 2) / (6371000 * 3.280839895 * Math.PI / 180);
  const halfLng = halfLat / Math.cos(center.lat * Math.PI / 180);
  return [
    { lat: center.lat - halfLat, lng: center.lng - halfLng },
    { lat: center.lat - halfLat, lng: center.lng + halfLng },
    { lat: center.lat + halfLat, lng: center.lng + halfLng },
    { lat: center.lat + halfLat, lng: center.lng - halfLng },
  ];
}

function link(role: string, id: number, extra: Partial<CatalogLinkInput> = {}): CatalogLinkInput {
  return {
    roleKey: role,
    sourceKind: "inventory",
    sourceId: id,
    name: role,
    unit: role === "pipe" ? "ft" : "each",
    unitPrice: 2,
    internalCost: 1,
    onHand: 0,
    ...extra,
  };
}

const settings: PlanningSettingsInput = {
  sprinklerMinSpacingFt: 15,
  sprinklerMaxSpacingFt: 40,
  tonsPerYard: null,
  yardsPerTruckLoad: null,
  bufferPercent: 10,
  zoneExclusions: [],
};

function sprinklerFeatures(): PlanFeature[] {
  return [
    { id: "outline", kind: "outline", disposition: "existing", points: square(200) },
    { id: "lawn", kind: "work_area", disposition: "existing", areaKind: "lawn", points: square(200) },
    { id: "hookup", kind: "water_hookup", disposition: "existing", points: [{ lat: center.lat - 0.002, lng: center.lng }] },
  ];
}

const required = ["pipe", "sprinkler", "labor", "valve_kit", "manifold_kit", "box", "timer"].map((role, index) => link(role, index + 1));

describe("blueprint planning", () => {
  it("refuses to calculate until the sprinkler roles, spacing, outline, and hookup are set", () => {
    const result = buildPlan({ jobType: "sprinkler", features: [], settings: { ...settings, sprinklerMinSpacingFt: null }, links: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing.join(" ")).toMatch(/Pipe/);
    expect(result.missing.join(" ")).toMatch(/how close/);
    expect(result.missing.join(" ")).toMatch(/outline/);
    expect(result.missing.join(" ")).toMatch(/hookup/);
  });

  it("places sprinklers on the spacing grid and keeps excluded heads in different zones", () => {
    const links = [
      ...required.filter(item => item.roleKey !== "sprinkler"),
      link("sprinkler", 11, { name: "Rotor", onHand: 100 }),
      link("sprinkler", 12, { name: "Spray", onHand: 0 }),
      link("elbow", 13, { name: "Elbow", onHand: 1000 }),
      link("tee", 14, { name: "Tee", onHand: 0 }),
    ];
    const result = buildPlan({
      jobType: "sprinkler",
      features: sprinklerFeatures(),
      settings: { ...settings, zoneExclusions: [{ a: "inventory:11", b: "inventory:12" }] },
      links,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { heads, orderList, customerLines } = result.plan;
    expect(heads.length).toBeGreaterThan(4);
    for (let i = 0; i < heads.length; i++) {
      for (let j = i + 1; j < heads.length; j++) {
        expect(distanceFt(heads[i], heads[j])).toBeGreaterThanOrEqual(14.5);
      }
    }
    const zones = new Map<number, Set<string>>();
    for (const head of heads) {
      const keys = zones.get(head.zone) ?? new Set<string>();
      keys.add(head.headKey);
      zones.set(head.zone, keys);
    }
    expect(zones.size).toBeGreaterThan(1);
    for (const keys of zones.values()) expect(keys.has("inventory:11") && keys.has("inventory:12")).toBe(false);
    expect(heads.some(head => head.headKey === "inventory:11")).toBe(true);
    expect(heads.some(head => head.headKey === "inventory:12")).toBe(true);
    const pipe = orderList.find(row => row.roleKey === "pipe");
    const elbow = orderList.find(row => row.roleKey === "elbow");
    const tee = orderList.find(row => row.roleKey === "tee");
    const rotor = orderList.find(row => row.name === "Rotor");
    expect(pipe?.required).toBeGreaterThan(0);
    expect(tee?.required).toBeGreaterThan(0);
    expect(elbow).toBeTruthy();
    expect(elbow?.toOrder).toBe(0);
    expect(rotor?.toOrder).toBe(0);
    expect(orderList.filter(row => row.toOrder === 0).length).toBeGreaterThan(0);
    const rolled = customerLines.find(line => line.id === "pipe_and_fittings");
    expect(rolled?.components.map(part => part.roleKey)).toEqual(expect.arrayContaining(["pipe", "elbow", "tee"]));
    expect(result.plan.lines.some(line => line.kind === "main")).toBe(true);
  });

  it("places drip emitters on their own spacing and suggests a nozzle only from stored details", () => {
    const links = [
      ...required.filter(item => item.roleKey !== "sprinkler"),
      link("sprinkler", 11, { name: "Spray", headType: "sprinkler", nozzle: "VAN", throwFt: 15, arcDegrees: 180, pattern: "matched" }),
      link("sprinkler", 12, { name: "Drip line", headType: "drip" }),
    ];
    const company: PlanningSettingsInput = {
      ...settings,
      headRules: [
        { headType: "sprinkler", headKey: null, minSpacingFt: 15, maxSpacingFt: 40 },
        { headType: "drip", headKey: null, minSpacingFt: 6, maxSpacingFt: 12 },
      ],
    };
    const result = buildPlan({ jobType: "sprinkler", features: sprinklerFeatures(), settings: company, links });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spray = result.plan.heads.filter(head => head.headKey === "inventory:11");
    const drip = result.plan.heads.filter(head => head.headKey === "inventory:12");
    expect(drip.length).toBeGreaterThan(spray.length);
    expect(spray[0]?.nozzle).toBe("VAN · 15 ft · 180° · matched");
    expect(drip[0]?.nozzle).toBeNull();
    expect(drip[0]?.nozzleNote).toMatch(/nozzle/);
    const override = resolvePlanningRules(company, { headRules: [{ headType: "sprinkler", headKey: null, minSpacingFt: 20, maxSpacingFt: 30 }] });
    expect(spacingFor(company, "sprinkler", null)?.maxSpacingFt).toBe(40);
    expect(spacingFor(override, "sprinkler", null)).toEqual({ minSpacingFt: 20, maxSpacingFt: 30 });
    expect(spacingFor(override, "drip", null)?.maxSpacingFt).toBe(12);
    expect(company.headRules?.[0]?.minSpacingFt).toBe(15);
  });

  it("calculates gravel yards and asks for density instead of inventing tons or loads", () => {
    const outline = square(100);
    const area = polygonAreaSqFt(outline);
    const result = buildPlan({
      jobType: "gravel",
      features: [{ id: "gravel", kind: "gravel", disposition: "bid", points: outline, thicknessInches: 3 }],
      settings,
      links: [link("gravel", 3, { unit: "yard", unitPrice: 40 })],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const material = result.plan.materials[0];
    const expectedYards = Math.round((area * (3 / 12) / 27) * 1.1 * 100) / 100;
    expect(material.yards).toBeCloseTo(expectedYards, 1);
    expect(material.tons).toBeNull();
    expect(material.truckLoads).toBeNull();
    expect(result.plan.questions.join(" ")).toMatch(/tons per yard or yards per truck load/);
  });

  it("uses tons per yard, truck size, or a manual load count when the user set them", () => {
    const feature: PlanFeature = { id: "bark", kind: "bark", disposition: "bid", points: square(80), thicknessInches: 2, manualTruckLoads: 4 };
    const withDensity = buildPlan({
      jobType: "bark",
      features: [{ ...feature, manualTruckLoads: null }],
      settings: { ...settings, tonsPerYard: 1.4, yardsPerTruckLoad: 10 },
      links: [link("bark", 4, { unit: "ton" })],
    });
    expect(withDensity.ok).toBe(true);
    if (!withDensity.ok) return;
    expect(withDensity.plan.materials[0].tons).toBeCloseTo((withDensity.plan.materials[0].yards ?? 0) * 1.4, 2);
    expect(withDensity.plan.materials[0].truckLoads).toBeGreaterThan(0);
    expect(withDensity.plan.questions).toEqual([]);
    const manual = buildPlan({
      jobType: "bark",
      features: [feature],
      settings,
      links: [link("bark", 4, { unit: "load" })],
    });
    expect(manual.ok).toBe(true);
    if (!manual.ok) return;
    expect(manual.plan.materials[0].truckLoads).toBe(4);
    expect(manual.plan.materials[0].tons).toBeNull();
    expect(manual.plan.customerLines[0].qty).toBe(4);
  });

  it("reports curb feet and keeps an unchosen version archived", () => {
    const result = buildPlan({
      jobType: "general",
      features: [{
        id: "curb",
        kind: "curb",
        disposition: "bid",
        points: [center, { lat: center.lat, lng: center.lng + (100 / (6371000 * 3.280839895 * Math.cos(center.lat * Math.PI / 180) * Math.PI / 180)) }],
      }],
      settings,
      links: [link("curb", 8, { unit: "ft" })],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.curbFeet).toBeGreaterThan(90);
    expect(result.plan.curbFeet).toBeLessThan(110);
    const versions = nextVersionStatuses([{ id: 1, status: "open" }, { id: 2, status: "open" }], 2);
    expect(versions.find(version => version.id === 2)?.status).toBe("chosen");
    expect(versions.find(version => version.id === 1)?.status).toBe("archived");
  });

  it("locks for an accepted estimate or a completed job and keeps fully stocked fittings on the order list", () => {
    expect(lockReason({ estimateStatuses: ["approved"], jobStatuses: ["scheduled"] })).toBe("Estimate accepted");
    expect(lockReason({ estimateStatuses: ["draft"], jobStatuses: ["completed"] })).toBe("Job completed");
    expect(lockReason({ estimateStatuses: ["sent"], jobStatuses: ["scheduled"] })).toBeNull();
    const rows = orderListFromLines([{
      id: "pipe_and_fittings",
      customerText: "Pipe and fittings",
      qty: 1,
      unit: null,
      unitPrice: 10,
      components: [
        { roleKey: "elbow", sourceKind: "inventory", sourceId: 1, name: "Elbow", qty: 4, unit: "each", unitPrice: 1, internalCost: null, onHand: 4 },
        { roleKey: "tee", sourceKind: "inventory", sourceId: 2, name: "Tee", qty: 2, unit: "each", unitPrice: 1, internalCost: null, onHand: 0 },
      ],
    }]);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.name === "Elbow")?.toOrder).toBe(0);
    expect(rows.find(row => row.name === "Tee")?.toOrder).toBe(2);
  });
});
