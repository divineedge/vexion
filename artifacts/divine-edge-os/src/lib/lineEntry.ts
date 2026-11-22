/** Shared estimate and invoice line shapes. Markup on a pass-through is a percent of internal cost. */

export interface LineComponent {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unit: string | null;
  /** Part sell price used to suggest the one customer total. Not a separate charge. */
  unitPrice?: number;
}

/** Inventory part rolled into a customer line. Stock is not deducted from the estimate or invoice. */
export interface BundledPart {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
}

/** Saved or one-off pass-through charge rolled into a customer line. */
export interface BundledCharge {
  catalogId: number | null;
  description: string;
  quantity: number;
  unit: string | null;
  internalCost: number | null;
  markup: number;
  unitPrice: number;
}

/** Dollars added to the line's unit price by bundled parts and pass-through charges. */
export function bundledAddOnTotal(
  parts: { quantity: number; unitPrice: number }[] | null | undefined,
  charges: { quantity: number; unitPrice: number }[] | null | undefined,
): number {
  const partSum = (parts ?? []).reduce((sum, part) => sum + part.quantity * part.unitPrice, 0);
  const chargeSum = (charges ?? []).reduce((sum, charge) => sum + charge.quantity * charge.unitPrice, 0);
  return Math.round((partSum + chargeSum) * 100) / 100;
}

/** Keep the primary price and replace the bundled dollars. */
export function unitPriceWithAddOns(currentUnitPrice: number, previousAddOns: number, nextAddOns: number): number {
  return Math.round(((Number(currentUnitPrice) || 0) - previousAddOns + nextAddOns) * 100) / 100;
}

export type CatalogHit =
  | { kind: "custom-new" }
  | { kind: "pass"; id: number; description: string; unit: string | null; internalCost: number | null; unitPrice: number; markup: number }
  | { kind: "service"; id: number; name: string; description: string | null; unitPrice: number }
  | { kind: "part"; id: number; name: string; unitPrice: number; sku: string | null }
  | { kind: "plan"; id: number; name: string; description: string | null; unitPrice: number; billingCycle: string }
  | { kind: "kit"; id: number; name: string; unitPrice: number; sku: string | null };

export function searchKindLabel(kind: CatalogHit["kind"]): string {
  if (kind === "custom-new" || kind === "pass") return "Pass-through";
  if (kind === "service") return "Service";
  if (kind === "part") return "Part";
  if (kind === "plan") return "Plan";
  return "Kit";
}

/** Customer unit price from internal cost plus markup percent. */
export function customerPriceFromMarkup(internalCost: number, markupPct: number): number {
  return Math.round(internalCost * (1 + (Number(markupPct) || 0) / 100) * 100) / 100;
}

/** Editing internal cost or markup rewrites the customer unit price. Typing the price keeps that amount. */
export function passThroughPricePatch(
  current: { internalCost?: number | null; markup?: number; unitPrice: number },
  patch: { unit?: string | null; internalCost?: number | null; markup?: number; unitPrice?: number },
): { unit?: string | null; internalCost?: number | null; markup?: number; unitPrice?: number; priceOverridden?: boolean } {
  const next = { ...current, ...patch };
  if (("internalCost" in patch || "markup" in patch) && next.internalCost != null && Number.isFinite(Number(next.internalCost))) {
    return {
      ...patch,
      unitPrice: customerPriceFromMarkup(Number(next.internalCost), Number(next.markup ?? 0)),
      priceOverridden: false,
    };
  }
  if ("unitPrice" in patch) return { ...patch, priceOverridden: true };
  return patch;
}

const clearedCatalog = {
  serviceId: undefined as number | undefined,
  serviceName: undefined as string | undefined,
  secondaryServiceId: undefined as number | undefined,
  secondaryServiceName: undefined as string | undefined,
  bundledServices: [] as unknown[],
  inventoryItemId: null as number | null,
  sku: null as string | null,
  planTemplateId: undefined as number | undefined,
  planTemplateName: undefined as string | undefined,
  planBillingCycle: undefined as string | undefined,
  catalogId: null as number | null,
  unit: null as string | null,
  internalCost: null as number | null,
};

/** Fields written when a search result is chosen. Description stays editable afterward. */
export function linePatchFromHit(hit: CatalogHit): Record<string, unknown> {
  if (hit.kind === "custom-new") {
    return { ...clearedCatalog, kind: "custom", description: "", unitPrice: 0, markup: 0, priceOverridden: false, category: "other" };
  }
  if (hit.kind === "pass") {
    return {
      ...clearedCatalog,
      kind: "custom",
      catalogId: hit.id,
      description: hit.description,
      unit: hit.unit,
      internalCost: hit.internalCost,
      unitPrice: hit.unitPrice,
      markup: hit.markup,
      priceOverridden: true,
      category: "other",
    };
  }
  if (hit.kind === "service") {
    return {
      ...clearedCatalog,
      kind: "service",
      serviceId: hit.id,
      serviceName: hit.name,
      description: hit.description?.trim() || hit.name,
      unitPrice: hit.unitPrice,
      markup: 0,
      priceOverridden: false,
      category: "labor",
    };
  }
  if (hit.kind === "part") {
    return {
      ...clearedCatalog,
      kind: "part",
      inventoryItemId: hit.id,
      sku: hit.sku,
      description: hit.name,
      unitPrice: hit.unitPrice,
      priceOverridden: true,
      category: "parts",
    };
  }
  if (hit.kind === "plan") {
    const detail = hit.description?.trim();
    return {
      ...clearedCatalog,
      kind: "plan",
      planTemplateId: hit.id,
      planTemplateName: hit.name,
      planBillingCycle: hit.billingCycle,
      description: detail ? `${hit.name} — ${detail}` : hit.name,
      unitPrice: hit.unitPrice,
      priceOverridden: true,
      category: "labor",
    };
  }
  return {
    ...clearedCatalog,
    kind: "kit",
    inventoryItemId: hit.id,
    sku: hit.sku,
    description: hit.name,
    unitPrice: hit.unitPrice,
    priceOverridden: true,
    category: "parts",
  };
}

/** One customer total for several parts. Line quantity stays the customer quantity. */
export function unitPriceForParts(lineQty: number, parts: { quantity: number; unitPrice: number }[]): number {
  const partsTotal = parts.reduce((sum, part) => sum + part.quantity * part.unitPrice, 0);
  const qty = lineQty > 0 ? lineQty : 1;
  return Math.round((partsTotal / qty) * 100) / 100;
}

export function customerTotalForParts(lineQty: number, parts: { quantity: number; unitPrice: number }[]): number {
  return Math.round(unitPriceForParts(lineQty, parts) * (lineQty > 0 ? lineQty : 1) * 100) / 100;
}

type PayloadLine = {
  id?: string;
  description: string;
  qty?: number;
  quantity?: number;
  unitPrice: number;
  markup?: number;
  discount?: number;
  isOptional?: boolean;
  optionalPitchLine?: string;
  groupId?: string;
  category?: string;
  priceOverridden?: boolean;
  kind?: string | null;
  serviceId?: number | null;
  serviceName?: string | null;
  secondaryServiceId?: number | null;
  secondaryServiceName?: string | null;
  bundledServices?: unknown[];
  inventoryItemId?: number | null;
  sku?: string | null;
  unit?: string | null;
  internalCost?: number | null;
  catalogId?: number | null;
  planTemplateId?: number | null;
  planTemplateName?: string | null;
  planBillingCycle?: string | null;
  components?: LineComponent[] | null;
  bundledParts?: BundledPart[] | null;
  bundledCharges?: BundledCharge[] | null;
  jobId?: number | null;
  propertyId?: number | null;
  costPrice?: number | null;
};

function storedKind(line: PayloadLine): "custom" | "part" | "plan" | "kit" | "service" {
  if (line.kind === "custom" || line.kind === "part" || line.kind === "plan" || line.kind === "kit" || line.kind === "service") return line.kind;
  if (line.planTemplateId) return "plan";
  if (line.inventoryItemId) return "part";
  if (Array.isArray(line.components) && line.components.some(component => component && component.inventoryItemId > 0 && component.quantity > 0)) return "part";
  return "service";
}

function cleanBundledParts(line: PayloadLine): BundledPart[] | undefined {
  if (!Array.isArray(line.bundledParts)) return undefined;
  return line.bundledParts
    .filter(part => part && part.inventoryItemId > 0 && part.quantity > 0)
    .map(part => ({
      inventoryItemId: part.inventoryItemId,
      name: part.name?.trim() || "Part",
      quantity: part.quantity,
      unit: part.unit?.trim() || null,
      unitPrice: Number(part.unitPrice) || 0,
    }));
}

function cleanBundledCharges(line: PayloadLine): BundledCharge[] | undefined {
  if (!Array.isArray(line.bundledCharges)) return undefined;
  return line.bundledCharges
    .filter(charge => charge && (charge.description ?? "").trim() && charge.quantity > 0)
    .map(charge => ({
      catalogId: charge.catalogId ?? null,
      description: charge.description.trim(),
      quantity: charge.quantity,
      unit: charge.unit?.trim() || null,
      internalCost: charge.internalCost == null || Number.isNaN(Number(charge.internalCost)) ? null : Number(charge.internalCost),
      markup: Number(charge.markup) || 0,
      unitPrice: Number(charge.unitPrice) || 0,
    }));
}

function cleanComponents(line: PayloadLine): LineComponent[] | undefined {
  if (!Array.isArray(line.components)) return undefined;
  return line.components
    .filter(component => component && component.inventoryItemId > 0 && component.quantity > 0)
    .map(component => ({
      inventoryItemId: component.inventoryItemId,
      name: component.name?.trim() || "Part",
      quantity: component.quantity,
      unit: component.unit?.trim() || null,
    }));
}

export function estimateLinePayload(line: PayloadLine) {
  const kind = storedKind(line);
  const components = cleanComponents(line);
  const bundledParts = cleanBundledParts(line);
  const bundledCharges = cleanBundledCharges(line);
  const multi = !!components && components.length > 0;
  const qty = line.qty ?? line.quantity ?? 1;
  const shared = {
    id: line.id,
    description: (line.description ?? "").trim(),
    qty,
    quantity: qty,
    unitPrice: line.unitPrice,
    markup: line.markup ?? 0,
    discount: kind === "custom" ? 0 : (line.discount ?? 0),
    isOptional: !!line.isOptional,
    optionalPitchLine: line.optionalPitchLine || null,
    groupId: line.groupId || null,
    category: line.category ?? (kind === "part" || kind === "kit" ? "parts" : kind === "custom" ? "other" : "labor"),
    acceptedByCustomer: !line.isOptional,
    priceOverridden: line.priceOverridden === true,
    ...(components ? { components } : {}),
    ...(bundledParts ? { bundledParts } : {}),
    ...(bundledCharges ? { bundledCharges } : {}),
  };
  if (kind === "custom") {
    return {
      ...shared,
      kind: "custom" as const,
      catalogId: line.catalogId ?? null,
      unit: line.unit?.trim() || null,
      internalCost: line.internalCost == null || Number.isNaN(Number(line.internalCost)) ? null : Number(line.internalCost),
      serviceId: null,
      serviceName: null,
      inventoryItemId: null,
      sku: null,
      planTemplateId: null,
      planTemplateName: null,
      planBillingCycle: null,
      bundledServices: [],
      secondaryServiceId: null,
      secondaryServiceName: null,
    };
  }
  if (kind === "kit") {
    return {
      ...shared,
      kind: "kit" as const,
      inventoryItemId: line.inventoryItemId ?? null,
      sku: line.sku ?? null,
      serviceId: null,
      serviceName: null,
      planTemplateId: null,
      unit: null,
      internalCost: null,
      catalogId: null,
      bundledServices: [],
    };
  }
  if (kind === "plan") {
    return {
      ...shared,
      kind: "plan" as const,
      planTemplateId: line.planTemplateId ?? null,
      planTemplateName: line.planTemplateName ?? null,
      planBillingCycle: line.planBillingCycle ?? null,
      serviceId: null,
      inventoryItemId: null,
      unit: null,
      internalCost: null,
      catalogId: null,
      bundledServices: [],
    };
  }
  if (kind === "part") {
    return {
      ...shared,
      kind: "part" as const,
      inventoryItemId: multi ? null : (line.inventoryItemId ?? null),
      sku: multi ? null : (line.sku ?? null),
      serviceId: null,
      serviceName: null,
      planTemplateId: null,
      unit: null,
      internalCost: null,
      catalogId: null,
      bundledServices: [],
      category: line.category && line.category !== "labor" ? line.category : "parts",
    };
  }
  return {
    ...shared,
    kind: "service" as const,
    serviceId: line.serviceId ?? null,
    serviceName: line.serviceName ?? null,
    secondaryServiceId: line.secondaryServiceId ?? null,
    secondaryServiceName: line.secondaryServiceName ?? null,
    bundledServices: line.bundledServices ?? [],
    inventoryItemId: null,
    unit: null,
    internalCost: null,
    catalogId: null,
    planTemplateId: null,
    planTemplateName: null,
    planBillingCycle: null,
  };
}

export function invoiceLinePayload(line: PayloadLine & { quantity?: number }) {
  const quantity = line.quantity ?? line.qty ?? 1;
  const stored = estimateLinePayload({ ...line, qty: quantity, quantity });
  return {
    ...stored,
    quantity,
    total: Math.round(quantity * stored.unitPrice * 100) / 100,
    jobId: line.jobId ?? null,
    propertyId: line.propertyId ?? null,
    ...(line.costPrice != null && stored.kind === "part" ? { costPrice: line.costPrice } : {}),
  };
}

export function lineSaveError(lines: PayloadLine[]): string | null {
  if (lines.some(line => line.kind === "custom" && !(line.description ?? "").trim())) return "Custom line needs a description";
  if (lines.some(line => line.kind === "kit" && !line.inventoryItemId)) return "Pick an inventory kit";
  if (lines.some(line => line.kind === "part" && !line.inventoryItemId && !(line.components && line.components.length > 0) && (line.description ?? "").trim())) {
    return "Pick an inventory part, or choose Custom / Pass-through";
  }
  return null;
}
