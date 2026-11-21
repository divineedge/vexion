import { Plus, Trash2 } from 'lucide-react';
import type { InventoryItem } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatInventoryQuantity, scaledComponentQuantity } from '@/lib/inventoryPartForm';
import { InventoryItemCombobox } from './InventoryItemCombobox';

export type LinkRow = {
  key: string;
  inventoryItemId: number | null;
  quantity: string;
};

function nextKey(): string {
  return `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function LinkedPartsEditor({
  items,
  selfId,
  unit,
  linkQuantity,
  links,
  costOverride,
  onLinkQuantity,
  onLinks,
  onCostOverride,
}: {
  items: InventoryItem[];
  selfId: number | null;
  unit: string;
  linkQuantity: string;
  links: LinkRow[];
  costOverride: string;
  onLinkQuantity: (value: string) => void;
  onLinks: (links: LinkRow[]) => void;
  onCostOverride: (value: string) => void;
}) {
  const parent = Number(linkQuantity);
  const parentUnit = unit.trim() || 'units';
  let partCost = 0;
  let pricedParts = 0;
  for (const link of links) {
    const component = items.find(item => item.id === link.inventoryItemId);
    const componentQty = Number(link.quantity);
    if (!component || !(componentQty > 0) || component.costPrice == null) continue;
    partCost += component.costPrice * componentQty;
    pricedParts += 1;
  }
  const perUnitCost = parent > 0 && pricedParts > 0 ? partCost / parent : null;
  const preview = links.flatMap(link => {
    const component = items.find(item => item.id === link.inventoryItemId);
    const componentQty = Number(link.quantity);
    if (!component || !(parent > 0) || !(componentQty > 0)) return [];
    const half = scaledComponentQuantity(parent, parent / 2, componentQty);
    const full = scaledComponentQuantity(parent, parent, componentQty);
    const doubled = scaledComponentQuantity(parent, parent * 2, componentQty);
    return [`${formatInventoryQuantity(parent)} ${parentUnit} uses ${formatInventoryQuantity(full)} ${component.unit || 'units'} of ${component.name}. ${formatInventoryQuantity(parent / 2)} uses ${formatInventoryQuantity(half)}. ${formatInventoryQuantity(parent * 2)} uses ${formatInventoryQuantity(doubled)}.`];
  });

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="linked-parts-editor">
      <div>
        <p className="text-sm font-medium">Linked parts</p>
        <p className="text-xs text-muted-foreground">
          Tie this part to other inventory items. For a kit, enter 1 and the quantity of each part in one kit. Using it on a job, or consuming it, deducts each linked part by that quantity times the units used. The combined cost is the sum of those part costs unless you set an override.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">This much of this part</label>
        <Input
          type="number"
          min={0}
          step="any"
          title="Amount of this part in the ratio. 100 here with 10 of a linked part means 50 uses 5."
          placeholder="100"
          data-testid="input-link-quantity"
          value={linkQuantity}
          onChange={event => onLinkQuantity(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        {links.map((link, index) => (
          <div key={link.key} className="grid grid-cols-[1fr_6rem_auto] gap-2 items-center">
            <InventoryItemCombobox
              items={items}
              excludeIds={[
                ...(selfId != null ? [selfId] : []),
                ...links.flatMap(other => other.key !== link.key && other.inventoryItemId != null ? [other.inventoryItemId] : []),
              ]}
              value={link.inventoryItemId}
              onSelect={item => onLinks(links.map(row => row.key === link.key ? { ...row, inventoryItemId: item.id } : row))}
              placeholder="Linked part"
            />
            <Input
              type="number"
              min={0}
              step="any"
              title="Amount of the linked part used with the quantity above"
              placeholder="10"
              data-testid={`input-link-component-${index}`}
              value={link.quantity}
              onChange={event => onLinks(links.map(row => row.key === link.key ? { ...row, quantity: event.target.value } : row))}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title="Remove this linked part"
              onClick={() => onLinks(links.filter(row => row.key !== link.key))}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          data-testid="button-add-linked-part"
          onClick={() => onLinks([...links, { key: nextKey(), inventoryItemId: null, quantity: '' }])}
        >
          <Plus className="w-3.5 h-3.5" /> Add linked part
        </Button>
      </div>
      {preview.length > 0 && (
        <div className="space-y-1 text-xs text-muted-foreground" data-testid="text-link-preview">
          {preview.map(line => <p key={line}>{line}</p>)}
        </div>
      )}
      {perUnitCost != null && (
        <p className="text-xs text-muted-foreground" data-testid="text-combined-cost">
          Combined cost for 1 {parentUnit}: ${perUnitCost.toFixed(2)}. Leave the override blank to use that sum.
        </p>
      )}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Combined cost override</label>
        <Input
          type="number"
          min={0}
          step="0.01"
          title="Optional buy cost for 1 unit of this part. Blank uses the sum of the linked part costs."
          placeholder="Blank uses the sum"
          data-testid="input-link-cost-override"
          value={costOverride}
          onChange={event => onCostOverride(event.target.value)}
        />
      </div>
    </div>
  );
}
