import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, Plus, X } from "lucide-react";
import { customFetch, useListInventoryItems, getListInventoryItemsQueryKey, type InventoryItem } from "@workspace/api-client-react";
import { SearchableCombobox, type ComboOption } from "@/components/shared/SearchableCombobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PassThroughFields } from "@/components/billing/PassThroughFields";
import type { PassThroughRow } from "@/components/billing/LineCatalogSearch";
import {
  bundledAddOnTotal,
  unitPriceWithAddOns,
  type BundledCharge,
  type BundledPart,
} from "@/lib/lineEntry";

function isKit(item: InventoryItem): boolean {
  return !!item.linkedParts && item.linkedParts.components.length > 0;
}

function namesOf(parts: BundledPart[] | null | undefined, charges: BundledCharge[] | null | undefined): string {
  return [...(parts ?? []).map(part => part.name), ...(charges ?? []).map(charge => charge.description)].filter(Boolean).join(" + ");
}

/**
 * Roll inventory parts and pass-through charges into the current line,
 * the same way a service line can bundle other services.
 * Each part and charge keeps its own quantity. The customer still sees one total.
 */
export function LineBundlePicker({
  testId,
  description,
  unitPrice,
  bundledParts,
  bundledCharges,
  onChange,
}: {
  testId: string;
  description: string;
  unitPrice: number;
  bundledParts?: BundledPart[] | null;
  bundledCharges?: BundledCharge[] | null;
  onChange: (patch: { bundledParts: BundledPart[]; bundledCharges: BundledCharge[]; unitPrice: number; description?: string; priceOverridden: boolean }) => void;
}) {
  const parts = bundledParts ?? [];
  const charges = bundledCharges ?? [];
  const inventory = useListInventoryItems(undefined, { query: { queryKey: getListInventoryItemsQueryKey() } });
  const saved = useQuery({
    queryKey: ["line-catalog"],
    queryFn: () => customFetch<PassThroughRow[]>("/api/line-catalog"),
    staleTime: 15_000,
  });
  const [oneOff, setOneOff] = useState(false);
  const [draftQty, setDraftQty] = useState("1");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftUnit, setDraftUnit] = useState("");
  const [draftCost, setDraftCost] = useState<number | null>(null);
  const [draftMarkup, setDraftMarkup] = useState(0);
  const [draftPrice, setDraftPrice] = useState(0);

  const stocked = ((inventory.data ?? []) as InventoryItem[]).filter(item => !isKit(item));
  const usedPartIds = new Set(parts.map(part => part.inventoryItemId));
  const options: ComboOption[] = [
    ...stocked.filter(item => !usedPartIds.has(item.id)).map(item => ({
      value: `part:${item.id}`,
      label: item.name,
      hint: "Part",
      sub: item.sku ? `SKU ${item.sku}` : undefined,
      keywords: ["Part", item.name, item.sku ?? ""],
    })),
    ...(saved.data ?? []).map(row => ({
      value: `pass:${row.id}`,
      label: row.description,
      hint: "Pass-through",
      sub: `${Number(row.markup) || 0}% markup`,
      keywords: ["Pass-through", row.description],
    })),
  ];

  function commit(nextParts: BundledPart[], nextCharges: BundledCharge[] = charges) {
    const safeParts = nextParts ?? [];
    const safeCharges = nextCharges ?? [];
    const previous = bundledAddOnTotal(parts, charges);
    const next = bundledAddOnTotal(safeParts, safeCharges);
    const prevLabel = namesOf(parts, charges);
    const nextLabel = namesOf(safeParts, safeCharges);
    const descriptionPatch = !description.trim() || description === prevLabel ? nextLabel : undefined;
    onChange({
      bundledParts: safeParts,
      bundledCharges: safeCharges,
      unitPrice: unitPriceWithAddOns(unitPrice, previous, next),
      ...(descriptionPatch !== undefined ? { description: descriptionPatch } : {}),
      priceOverridden: false,
    });
  }

  function addPart(item: InventoryItem, quantity: number) {
    commit([...parts, {
      inventoryItemId: item.id,
      name: item.name,
      quantity,
      unit: item.unit ?? null,
      unitPrice: Number(item.unitPrice ?? 0),
    }], charges);
  }

  function addCharge(charge: BundledCharge) {
    commit([...parts], [...charges, charge]);
  }

  function readQty(): number | null {
    const quantity = parseFloat(draftQty);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    return quantity;
  }

  return (
    <div className="flex flex-col gap-2 flex-1 min-w-[220px]" data-testid={`${testId}-bundle`}>
      <div className="flex items-center gap-2">
        <SearchableCombobox
          className="w-56"
          testId={`${testId}-bundle-search`}
          options={options}
          value={null}
          leadingOption={{
            value: "charge:new",
            label: "One-off pass-through",
            hint: "Pass-through",
            keywords: ["Custom", "Pass-through", "one-off"],
          }}
          displayLabel={<span className="text-muted-foreground">Bundle part or pass-through</span>}
          triggerIcon={<Plus className="w-3 h-3 text-indigo-500" />}
          onChange={value => {
            if (value === "charge:new") {
              setOneOff(true);
              setDraftDescription("");
              setDraftUnit("");
              setDraftCost(null);
              setDraftMarkup(0);
              setDraftPrice(0);
              setDraftQty("1");
              return;
            }
            const quantity = readQty() ?? 1;
            if (value.startsWith("part:")) {
              const item = stocked.find(row => `part:${row.id}` === value);
              if (!item) return;
              addPart(item, quantity);
              setDraftQty("1");
              return;
            }
            const row = (saved.data ?? []).find(entry => `pass:${entry.id}` === value);
            if (!row) return;
            addCharge({
              catalogId: row.id,
              description: row.description,
              quantity,
              unit: row.unit,
              internalCost: row.internalCost,
              markup: Number(row.markup) || 0,
              unitPrice: Number(row.unitPrice) || 0,
            });
            setDraftQty("1");
          }}
          placeholder="Bundle part or pass-through"
          searchPlaceholder="Search parts and pass-through charges"
          emptyText="Nothing matches. Use a one-off pass-through if it is not stocked."
          ariaLabel="Bundle a part or pass-through onto this line"
          title="Add an inventory part or a pass-through charge to this one line"
        />
        <Input
          className="h-8 w-16 text-sm"
          type="number"
          min={0.01}
          step={0.01}
          aria-label="Quantity to bundle"
          data-testid={`${testId}-bundle-qty`}
          value={draftQty}
          onChange={event => setDraftQty(event.target.value)}
        />
      </div>
      {oneOff && (
        <div className="rounded-md border p-2 space-y-2" data-testid={`${testId}-bundle-oneoff`}>
          <Input
            className="h-8 text-sm"
            placeholder="Dump truck load, equipment rental"
            aria-label="One-off pass-through description"
            value={draftDescription}
            onChange={event => setDraftDescription(event.target.value)}
          />
          <PassThroughFields
            testId={`${testId}-bundle-oneoff`}
            unit={draftUnit}
            internalCost={draftCost}
            markup={draftMarkup}
            unitPrice={draftPrice}
            onChange={patch => {
              if (patch.unit !== undefined) setDraftUnit(patch.unit ?? "");
              if (patch.internalCost !== undefined) setDraftCost(patch.internalCost ?? null);
              if (patch.markup !== undefined) setDraftMarkup(patch.markup);
              if (patch.unitPrice !== undefined) setDraftPrice(patch.unitPrice);
            }}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              data-testid={`${testId}-bundle-oneoff-add`}
              onClick={() => {
                const quantity = readQty();
                if (!draftDescription.trim() || quantity == null) return;
                addCharge({
                  catalogId: null,
                  description: draftDescription.trim(),
                  quantity,
                  unit: draftUnit.trim() || null,
                  internalCost: draftCost,
                  markup: draftMarkup,
                  unitPrice: draftPrice,
                });
                setOneOff(false);
                setDraftQty("1");
              }}
            >
              Add to this line
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOneOff(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {(parts.length > 0 || charges.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Bundled parts and pass-through charges">
          <Layers className="w-3 h-3 text-indigo-500" aria-hidden />
          {parts.map(part => (
            <span key={`part-${part.inventoryItemId}`} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700" data-testid={`${testId}-bundle-part`}>
              {part.name}
              <span className="text-indigo-500">Part</span>
              <Input
                className="h-6 w-14 text-[11px] px-1"
                type="number"
                min={0.01}
                step={0.01}
                aria-label={`Quantity for ${part.name}`}
                value={part.quantity}
                onChange={event => {
                  const quantity = parseFloat(event.target.value);
                  if (!Number.isFinite(quantity) || quantity <= 0) return;
                  commit(parts.map(row => row.inventoryItemId === part.inventoryItemId ? { ...row, quantity } : row), charges);
                }}
              />
              <span className="tabular-nums text-indigo-500">${(part.quantity * part.unitPrice).toFixed(2)}</span>
              <button type="button" className="rounded-full hover:bg-indigo-100 p-0.5" aria-label={`Remove ${part.name} from this line`} onClick={() => commit(parts.filter(row => row.inventoryItemId !== part.inventoryItemId), charges)}>
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          {charges.map((charge, index) => (
            <span key={`charge-${charge.catalogId ?? "new"}-${index}`} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700" data-testid={`${testId}-bundle-charge`}>
              {charge.description}
              <span className="text-indigo-500">Pass-through</span>
              <Input
                className="h-6 w-14 text-[11px] px-1"
                type="number"
                min={0.01}
                step={0.01}
                aria-label={`Quantity for ${charge.description}`}
                value={charge.quantity}
                onChange={event => {
                  const quantity = parseFloat(event.target.value);
                  if (!Number.isFinite(quantity) || quantity <= 0) return;
                  commit(parts, charges.map((row, rowIndex) => rowIndex === index ? { ...row, quantity } : row));
                }}
              />
              <span className="tabular-nums text-indigo-500">${(charge.quantity * charge.unitPrice).toFixed(2)}</span>
              <button type="button" className="rounded-full hover:bg-indigo-100 p-0.5" aria-label={`Remove ${charge.description} from this line`} onClick={() => commit(parts, charges.filter((_, rowIndex) => rowIndex !== index))}>
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
