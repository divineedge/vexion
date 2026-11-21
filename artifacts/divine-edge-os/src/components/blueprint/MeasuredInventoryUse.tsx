import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getListInventoryItemsQueryKey, type InventoryItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export type MeasuredUse = {
  id: number;
  blueprintId: number;
  inventoryItemId: number;
  name: string;
  sku: string;
  amount: number;
  unit: string;
  onHand: number;
  measure: string;
  remainingLabel: string;
  elementId: string | null;
};

type MeasureChoice = { value: string; label: string };

const AREA = new Set(["sqft", "sq ft", "square feet", "square foot"]);
const FEET = new Set(["ft", "foot", "feet", "linear ft", "linear feet", "pipe ft", "pipe feet"]);
const INCHES = new Set(["in", "inch", "inches"]);
const GALLONS = new Set(["gal", "gallon", "gallons"]);
const OUNCES = new Set(["oz", "ounce", "ounces", "fl oz", "floz", "fluid oz", "fluid ounce", "fluid ounces"]);
const LITERS = new Set(["l", "liter", "liters", "litre", "litres"]);
const POUNDS = new Set(["lb", "lbs", "pound", "pounds"]);

function normalize(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\./g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** Choices for a measured item. Piece-count items return null. */
export function measureChoices(item: { unit?: string | null; sizeName?: string | null } | null | undefined): MeasureChoice[] | null {
  const labels = [normalize(item?.sizeName), normalize(item?.unit)].filter(Boolean);
  const has = (set: Set<string>) => labels.some(label => set.has(label));
  if (has(AREA)) return [{ value: "sq ft", label: "sq ft" }];
  if (has(GALLONS) || has(OUNCES) || has(LITERS)) {
    return [{ value: "gal", label: "gallons" }, { value: "oz", label: "ounces" }];
  }
  if (has(POUNDS)) return [{ value: "lb", label: "pounds" }];
  if (has(FEET) || has(INCHES)) return [{ value: "ft", label: "feet" }, { value: "in", label: "inches" }];
  return null;
}

function errorText(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { error?: string } | null }).data;
    if (data?.error) return data.error;
  }
  return "Could not update inventory";
}

const queryKey = (blueprintId: number) => ["blueprint-inventory-uses", blueprintId];

export function MeasuredInventoryUse({
  blueprintId,
  items,
  elementId,
  linkedItemId,
}: {
  blueprintId: number;
  items: InventoryItem[] | undefined;
  elementId?: string | null;
  linkedItemId?: number | null;
}) {
  const queryClient = useQueryClient();
  const { data: uses = [] } = useQuery({
    queryKey: queryKey(blueprintId),
    queryFn: () => customFetch<MeasuredUse[]>(`/api/blueprints/${blueprintId}/inventory-uses`),
  });
  const measured = (items ?? []).filter(item => measureChoices(item));
  const [itemId, setItemId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = measured.find(item => String(item.id) === itemId) ?? (linkedItemId != null ? measured.find(item => item.id === linkedItemId) : undefined);
  const choices = measureChoices(selected);
  const placedUse = elementId ? uses.find(use => use.elementId === elementId) : undefined;
  const visibleUses = elementId ? (placedUse ? [placedUse] : []) : uses.filter(use => !use.elementId);

  useEffect(() => {
    if (!choices?.length) return;
    if (!choices.some(choice => choice.value === unit)) setUnit(choices[0].value);
  }, [choices, unit]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKey(blueprintId) });
    await queryClient.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
  };

  const submit = async (target: InventoryItem, useId: number | null, nextAmount: number, nextUnit: string, nextElementId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({ inventoryItemId: target.id, amount: nextAmount, unit: nextUnit, elementId: nextElementId });
      await customFetch<MeasuredUse>(useId == null ? `/api/blueprints/${blueprintId}/inventory-uses` : `/api/blueprints/${blueprintId}/inventory-uses/${useId}`, {
        method: useId == null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
      });
      setAmount("");
      setEditingId(null);
      await refresh();
      toast.success(useId == null ? "Inventory updated" : "Inventory use updated");
    } catch (err) {
      const message = errorText(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (useId: number) => {
    setBusy(true);
    setError(null);
    try {
      await customFetch(`/api/blueprints/${blueprintId}/inventory-uses/${useId}`, { method: "DELETE" });
      await refresh();
      toast.success("Inventory use removed");
    } catch (err) {
      const message = errorText(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = () => {
    const target = selected;
    const value = Number(amount);
    if (!target || !choices) { setError("Choose an item measured in square feet, gallons, ounces, pounds, feet, or inches."); return; }
    if (!Number.isFinite(value) || value <= 0) { setError("Enter an amount greater than 0."); return; }
    void submit(target, editingId ?? placedUse?.id ?? null, value, unit || choices[0].value, elementId ?? null);
  };

  if (elementId && !selected) return null;

  return (
    <div className={elementId ? "space-y-1" : "p-4 border-b space-y-3"} data-testid={elementId ? `placed-measured-use-${elementId}` : "blueprint-measured-use"}>
      {!elementId && (
        <div>
          <p className="text-sm font-medium">Use inventory</p>
          <p className="text-xs text-muted-foreground">Enter the amount in the item's measure. Stock goes down by that amount, and the remainder stays in that measure.</p>
        </div>
      )}
      <div className={elementId ? "space-y-1" : "space-y-2"}>
        {!elementId && (
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="blueprint-use-item">Item</Label>
            <select
              id="blueprint-use-item"
              data-testid="blueprint-use-item"
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={itemId}
              onChange={event => { setItemId(event.target.value); setEditingId(null); setError(null); }}
            >
              <option value="">Choose a measured item</option>
              {measured.map(item => (
                <option key={item.id} value={String(item.id)}>{item.name} · {item.quantity} {item.unit}</option>
              ))}
            </select>
          </div>
        )}
        {selected && choices && (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={elementId ? `placed-use-amount-${elementId}` : "blueprint-use-amount"}>
                {elementId ? `Use (${choices.find(choice => choice.value === unit)?.label ?? choices[0].label})` : "Amount"}
              </Label>
              <Input
                id={elementId ? `placed-use-amount-${elementId}` : "blueprint-use-amount"}
                data-testid={elementId ? `placed-use-amount-${elementId}` : "blueprint-use-amount"}
                type="number"
                min={0}
                step="any"
                className="h-8 w-24"
                value={amount}
                onChange={event => setAmount(event.target.value)}
              />
            </div>
            {choices.length > 1 && (
              <select
                data-testid={elementId ? `placed-use-unit-${elementId}` : "blueprint-use-unit"}
                aria-label="Measure"
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                value={unit || choices[0].value}
                onChange={event => setUnit(event.target.value)}
              >
                {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            )}
            <Button type="button" size="sm" className="h-8" data-testid={elementId ? `placed-use-submit-${elementId}` : "blueprint-use-submit"} disabled={busy} onClick={onSubmit}>
              {editingId || placedUse ? "Update" : "Use"}
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-destructive" data-testid={elementId ? `placed-use-error-${elementId}` : "blueprint-use-error"}>{error}</p>}
      </div>
      {visibleUses.length > 0 && (
        <ul className="space-y-2">
          {visibleUses.map(use => (
            <li key={use.id} className="rounded-md border px-2 py-1.5 text-xs" data-testid={`blueprint-use-${use.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{use.name}</p>
                  <p className="text-muted-foreground">{use.amount} {use.unit}</p>
                  <p data-testid={`blueprint-use-remaining-${use.id}`}>{use.remainingLabel} remaining</p>
                </div>
                <div className="flex gap-1">
                  {!elementId && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => {
                      setEditingId(use.id);
                      setItemId(String(use.inventoryItemId));
                      setAmount(String(use.amount));
                      setUnit(use.unit);
                    }}>Edit</Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2" data-testid={`blueprint-use-remove-${use.id}`} disabled={busy} onClick={() => void remove(use.id)}>Remove</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
