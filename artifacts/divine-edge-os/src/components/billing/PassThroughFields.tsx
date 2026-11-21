import { Input } from "@/components/ui/input";
import { passThroughPricePatch } from "@/lib/lineEntry";

export function PassThroughFields({
  testId,
  unit,
  internalCost,
  markup,
  unitPrice,
  onChange,
}: {
  testId: string;
  unit?: string | null;
  internalCost?: number | null;
  markup?: number;
  unitPrice: number;
  onChange: (patch: { unit?: string | null; internalCost?: number | null; markup?: number; unitPrice?: number; priceOverridden?: boolean }) => void;
}) {
  const current = { internalCost: internalCost ?? null, markup: markup ?? 0, unitPrice };
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">Markup is a percent of the internal cost. It sets the customer unit price. This charge is not a catalog service and does not deduct stock.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Unit</label>
          <Input data-testid={`${testId}-unit`} className="h-8 text-sm" title="Optional unit label" placeholder="Load, Day, Each" value={unit ?? ""} onChange={event => onChange({ unit: event.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Internal cost</label>
          <Input
            data-testid={`${testId}-cost`}
            className="h-8 text-sm"
            type="number"
            min={0}
            step={0.01}
            title="What this charge costs you"
            placeholder="Optional"
            value={internalCost ?? ""}
            onChange={event => onChange(passThroughPricePatch(current, { internalCost: event.target.value === "" ? null : parseFloat(event.target.value) }))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Markup %</label>
          <Input
            data-testid={`${testId}-markup`}
            className="h-8 text-sm"
            type="number"
            min={0}
            step={1}
            title="Percent added to the internal cost"
            value={markup ?? 0}
            onChange={event => onChange(passThroughPricePatch(current, { markup: parseFloat(event.target.value) || 0 }))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Customer unit price</label>
          <Input
            data-testid={`${testId}-price`}
            className="h-8 text-sm"
            type="number"
            min={0}
            step={0.01}
            title="Price the customer pays per unit"
            value={unitPrice}
            onChange={event => onChange(passThroughPricePatch(current, { unitPrice: parseFloat(event.target.value) || 0 }))}
          />
        </div>
      </div>
    </div>
  );
}
