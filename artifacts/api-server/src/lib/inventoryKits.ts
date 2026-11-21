import { priceWithMarkup, roundMoney } from "./pipeStock";

/**
 * Linked parts are existing inventory items used together at a ratio the user sets.
 * Using this much of the parent uses that much of each component, scaled.
 * 100 of fabric with 10 stakes means 50 uses 5 and 200 uses 20.
 * Quantities stay in each item's own unit. Pounds are not converted to gallons.
 */

export type RatioComponent = {
  inventoryItemId: number;
  quantity: number;
};

export type KitRatio = {
  parentQuantity: number;
  components: RatioComponent[];
  /** Buy cost for 1 unit of the parent. Null or omitted uses the sum of component costs. */
  costOverride?: number | null;
};

export type UseLineInput = {
  inventoryItemId: number;
  name: string;
  unit: string;
  onHand: number;
  sellPrice: number;
  /** Quantity from before cost lots, already outside current on-hand. */
  legacyQuantity: number;
  /** Quantity already deducted from on-hand for this job line. */
  tracked: number;
};

export type PlannedLine = {
  inventoryItemId: number;
  name: string;
  unit: string;
  quantity: number;
  sellPrice: number;
};

export type LinkedUsePlan =
  | { ok: true; combinedPrice: number; lines: PlannedLine[] }
  | { ok: false; message: string };

export function roundKitQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function formatKitAmount(value: number): string {
  const rounded = roundKitQuantity(value);
  if (!Number.isFinite(rounded)) return "0";
  return rounded.toFixed(6).replace(/\.?0+$/, "");
}

/** How much on-hand stock this desired quantity still needs. Negative means put some back. */
export function onHandNeeded(desired: number, legacyQuantity: number, tracked: number): number {
  return desired - Math.min(legacyQuantity, desired) - tracked;
}

export function scaledComponentQuantity(parentRatio: number, used: number, componentRatio: number): number {
  if (!(parentRatio > 0) || !(used > 0) || !(componentRatio > 0)) return 0;
  return roundKitQuantity(componentRatio * (used / parentRatio));
}

/**
 * Buy cost for 1 unit of the parent.
 * With no override this is the sum of each component's cost for the ratio, divided by the parent quantity.
 * 1 valve, 2 elbows, and 1 coupling is that many component costs. An override replaces the sum.
 */
export function combinedUnitCost(
  parentQuantity: number,
  components: readonly { quantity: number; unitCost: number }[],
  costOverride?: number | null,
): number {
  if (costOverride != null && Number.isFinite(costOverride)) return roundMoney(costOverride);
  if (!(parentQuantity > 0)) return 0;
  const batch = components.reduce((sum, component) => sum + component.unitCost * component.quantity, 0);
  return roundMoney(batch / parentQuantity);
}

/** Component quantities for this many units of the parent. The parent itself is not listed again. */
export function kitComponentTargets(
  kit: KitRatio | null,
  units: number,
  parentItemId?: number,
): { inventoryItemId: number; quantity: number }[] {
  if (!kit || !(units > 0)) return [];
  const seen = new Set<number>();
  if (parentItemId != null) seen.add(parentItemId);
  const targets: { inventoryItemId: number; quantity: number }[] = [];
  for (const component of kit.components) {
    if (seen.has(component.inventoryItemId)) continue;
    const quantity = scaledComponentQuantity(kit.parentQuantity, units, component.quantity);
    if (!(quantity > 0)) continue;
    seen.add(component.inventoryItemId);
    targets.push({ inventoryItemId: component.inventoryItemId, quantity });
  }
  return targets;
}

export type InventoryUseRef = {
  itemId: number;
  jobId?: number | null;
  blueprintId?: number | null;
  /** The one job this blueprint already belongs to, when there is exactly one. */
  linkedJobId?: number | null;
  chemicalApplicationId?: number | null;
  adjustmentId?: string | null;
};

/** Keys for one physical use. A job and the blueprint linked to it match the same keys. */
export function inventoryUseKeys(input: InventoryUseRef): { canonicalKey: string; matchKeys: string[] } {
  const itemId = input.itemId;
  const jobId = input.jobId != null && input.jobId > 0
    ? input.jobId
    : input.linkedJobId != null && input.linkedJobId > 0
      ? input.linkedJobId
      : null;
  const match = new Set<string>();
  if (jobId != null) match.add(`job:${jobId}:item:${itemId}`);
  if (input.blueprintId != null && input.blueprintId > 0) match.add(`blueprint:${input.blueprintId}:item:${itemId}`);
  if (input.chemicalApplicationId != null && input.chemicalApplicationId > 0) {
    match.add(`chemical:${input.chemicalApplicationId}:item:${itemId}`);
  }
  if (input.adjustmentId) match.add(`adjust:${input.adjustmentId}:item:${itemId}`);

  let canonicalKey: string;
  if (jobId != null) canonicalKey = `job:${jobId}:item:${itemId}`;
  else if (input.blueprintId != null && input.blueprintId > 0) canonicalKey = `blueprint:${input.blueprintId}:item:${itemId}`;
  else if (input.chemicalApplicationId != null && input.chemicalApplicationId > 0) canonicalKey = `chemical:${input.chemicalApplicationId}:item:${itemId}`;
  else if (input.adjustmentId) canonicalKey = `adjust:${input.adjustmentId}:item:${itemId}`;
  else canonicalKey = `item:${itemId}`;
  match.add(canonicalKey);
  return { canonicalKey, matchKeys: [...match] };
}

/** The same use recorded more than once keeps the larger quantity already stored, not the sum. */
export function selectRecordedUse<T extends { useKey: string; units: number }>(
  records: readonly T[],
  matchKeys: readonly string[],
): T | null {
  const keys = new Set(matchKeys);
  const matches = records.filter(record => keys.has(record.useKey));
  if (matches.length === 0) return null;
  return matches.reduce((best, record) => record.units > best.units ? record : best);
}

/** One job line. The total is the sum of each component's sell price for the quantity used. */
export function kitJobLine(quantity: number, combinedPrice: number): { quantity: number; unitPrice: number; total: number } {
  const total = roundMoney(combinedPrice);
  return {
    quantity,
    total,
    unitPrice: quantity > 0 ? total / quantity : 0,
  };
}

function unitLabel(unit: string): string {
  const text = unit.trim();
  return text || "units";
}

/**
 * Plan one use of a part, including linked components.
 * Each inventory item is listed once. A short component is named and nothing is skipped.
 * Lines with quantity 0 are previous uses that need their stock put back.
 */
export function planLinkedUse(input: {
  usedQuantity: number;
  parent: UseLineInput;
  kit: KitRatio | null;
  components: UseLineInput[];
  /** Markup percent applied when a combined cost override replaces the sell-price sum. */
  markupPct?: number;
}): LinkedUsePlan {
  const usedQuantity = roundKitQuantity(input.usedQuantity);
  if (!Number.isFinite(usedQuantity) || usedQuantity < 0) {
    return { ok: false, message: "Enter a supply quantity of 0 or more." };
  }

  const desired = new Map<number, number>();
  desired.set(input.parent.inventoryItemId, usedQuantity);

  if (usedQuantity > 0 && input.kit && input.kit.components.length > 0) {
    if (!(input.kit.parentQuantity > 0)) {
      return { ok: false, message: "This part's linked ratio needs a quantity greater than 0." };
    }
    for (const component of input.kit.components) {
      if (desired.has(component.inventoryItemId)) continue;
      if (!(component.quantity > 0)) {
        return { ok: false, message: "Each linked part needs a quantity greater than 0." };
      }
      desired.set(
        component.inventoryItemId,
        scaledComponentQuantity(input.kit.parentQuantity, usedQuantity, component.quantity),
      );
    }
  }

  for (const row of input.components) {
    if (!desired.has(row.inventoryItemId)) desired.set(row.inventoryItemId, 0);
  }

  const order = [input.parent.inventoryItemId];
  for (const id of desired.keys()) {
    if (!order.includes(id)) order.push(id);
  }

  const lines: PlannedLine[] = [];
  const shorts: string[] = [];
  for (const id of order) {
    const quantity = desired.get(id) ?? 0;
    const row = id === input.parent.inventoryItemId
      ? input.parent
      : input.components.find(component => component.inventoryItemId === id);
    if (!row) {
      if (quantity > 0) shorts.push("Not enough stock for a linked part that is no longer in inventory.");
      continue;
    }
    const needed = onHandNeeded(quantity, row.legacyQuantity, row.tracked);
    if (needed > row.onHand + 1e-9) {
      const unit = unitLabel(row.unit);
      shorts.push(
        `Not enough stock for ${row.name}: need ${formatKitAmount(needed)} more ${unit}, have ${formatKitAmount(row.onHand)} ${unit} on hand.`,
      );
    }
    const keep = id === input.parent.inventoryItemId || quantity > 0 || row.tracked > 0 || row.legacyQuantity > 0;
    if (!keep) continue;
    lines.push({
      inventoryItemId: row.inventoryItemId,
      name: row.name,
      unit: row.unit,
      quantity,
      sellPrice: row.sellPrice,
    });
  }

  if (shorts.length > 0) return { ok: false, message: shorts.join(" ") };

  const summed = roundMoney(
    lines.reduce((sum, line) => sum + (line.quantity > 0 ? line.quantity * line.sellPrice : 0), 0),
  );
  const override = input.kit?.costOverride;
  const combinedPrice = override != null && usedQuantity > 0
    ? roundMoney(priceWithMarkup(override, input.markupPct ?? 0) * usedQuantity)
    : summed;
  return { ok: true, combinedPrice, lines };
}

export function parseCostOverride(value: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, value: null };
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: "Combined cost override must be a number, 0 or greater." };
  }
  return { ok: true, value: roundMoney(parsed) };
}

export function parseLinkedPartsBody(value: unknown):
  | { ok: true; value: { quantity: number; components: RatioComponent[]; costOverride: number | null } | null }
  | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Linked parts must list a ratio quantity and the parts it uses." };
  }
  const body = value as { quantity?: unknown; components?: unknown };
  const quantity = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: "Enter how much of this part the ratio uses. For example, 100." };
  }
  if (!Array.isArray(body.components) || body.components.length === 0) {
    return { ok: false, error: "Add the parts this one uses." };
  }
  if (body.components.length > 50) {
    return { ok: false, error: "A linked part list can include up to 50 parts." };
  }
  const components: RatioComponent[] = [];
  const seen = new Set<number>();
  for (const entry of body.components) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "Choose each linked part from inventory." };
    const rawId = (entry as { inventoryItemId?: unknown }).inventoryItemId;
    const rawQty = (entry as { quantity?: unknown }).quantity;
    const inventoryItemId = typeof rawId === "number" ? rawId : Number(rawId);
    const componentQuantity = typeof rawQty === "number" ? rawQty : Number(rawQty);
    if (!Number.isInteger(inventoryItemId) || inventoryItemId <= 0) {
      return { ok: false, error: "Choose each linked part from inventory." };
    }
    if (seen.has(inventoryItemId)) return { ok: false, error: "Each linked part can only be listed once." };
    if (!Number.isFinite(componentQuantity) || componentQuantity <= 0) {
      return { ok: false, error: "Enter a quantity greater than 0 for each linked part." };
    }
    seen.add(inventoryItemId);
    components.push({ inventoryItemId, quantity: roundKitQuantity(componentQuantity) });
  }
  const override = parseCostOverride((body as { costOverride?: unknown }).costOverride);
  if (!override.ok) return override;
  return { ok: true, value: { quantity: roundKitQuantity(quantity), components, costOverride: override.value } };
}
