import { useState } from "react";
import { X } from "lucide-react";
import { InventoryItemCombobox } from "@/components/inventory/InventoryItemCombobox";
import { Input } from "@/components/ui/input";
import type { LineComponent } from "@/lib/lineEntry";
import { unitPriceForParts } from "@/lib/lineEntry";

export function AttachedPartsField({
  testId,
  lineQty,
  components,
  seed,
  priceOverridden,
  clearInventoryItem = true,
  onChange,
}: {
  testId: string;
  lineQty: number;
  components?: LineComponent[] | null;
  /** Current single part, moved into the list so it is not deducted twice. */
  seed?: LineComponent | null;
  priceOverridden?: boolean;
  /** Kit lines keep their inventory item id. Extra parts are stored separately. */
  clearInventoryItem?: boolean;
  onChange: (patch: { components?: LineComponent[] | null; unitPrice?: number; priceOverridden?: boolean; inventoryItemId?: number | null }) => void;
}) {
  const list = components ?? [];
  const enabled = Array.isArray(components);
  const [draftQty, setDraftQty] = useState("1");

  function commit(next: LineComponent[], keepPrice: boolean) {
    const priced = next.every(part => part.unitPrice != null);
    const patch: { components: LineComponent[]; unitPrice?: number; priceOverridden?: boolean; inventoryItemId?: number | null } = {
      components: next,
      ...(clearInventoryItem ? { inventoryItemId: null } : {}),
    };
    if (!keepPrice && !priceOverridden && priced && next.length > 0) {
      patch.unitPrice = unitPriceForParts(lineQty, next.map(part => ({ quantity: part.quantity, unitPrice: part.unitPrice ?? 0 })));
      patch.priceOverridden = false;
    }
    onChange(patch);
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2" data-testid={`${testId}-parts`}>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          data-testid={`${testId}-multi`}
          checked={enabled}
          onChange={event => {
            if (!event.target.checked) onChange({ components: null });
            else commit(list.length > 0 ? list : seed ? [seed] : [], true);
          }}
        />
        add multiple items to this line
      </label>
      {enabled && (
        <>
          <p className="text-[10px] text-muted-foreground">The customer sees this one description and one total. Each part and quantity is saved on the line so a later job use can deduct it once, not twice.</p>
          <div className="flex items-center gap-2">
            <InventoryItemCombobox
              className="flex-1"
              excludeIds={list.map(part => part.inventoryItemId)}
              placeholder="Add an inventory part"
              onSelect={part => {
                const quantity = parseFloat(draftQty);
                if (!Number.isFinite(quantity) || quantity <= 0) return;
                commit([...list, {
                  inventoryItemId: part.id,
                  name: part.name,
                  quantity,
                  unit: part.unit ?? null,
                  unitPrice: Number(part.unitPrice ?? 0),
                }], false);
                setDraftQty("1");
              }}
            />
            <Input className="h-8 w-16 text-sm" type="number" min={0.01} step={0.01} aria-label="Quantity to attach" value={draftQty} onChange={event => setDraftQty(event.target.value)} />
          </div>
          {list.length > 0 && (
            <ul className="space-y-1">
              {list.map(part => (
                <li key={part.inventoryItemId} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate">{part.name}</span>
                  <Input
                    className="h-7 w-16 text-xs"
                    type="number"
                    min={0.01}
                    step={0.01}
                    aria-label={`Quantity for ${part.name}`}
                    value={part.quantity}
                    onChange={event => {
                      const quantity = parseFloat(event.target.value);
                      if (!Number.isFinite(quantity) || quantity <= 0) return;
                      commit(list.map(row => row.inventoryItemId === part.inventoryItemId ? { ...row, quantity } : row), false);
                    }}
                  />
                  <span className="text-muted-foreground w-10 truncate">{part.unit || ""}</span>
                  <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${part.name}`} onClick={() => commit(list.filter(row => row.inventoryItemId !== part.inventoryItemId), false)}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
