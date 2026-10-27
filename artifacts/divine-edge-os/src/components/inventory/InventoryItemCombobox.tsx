import { useMemo } from 'react';
import { Boxes } from 'lucide-react';
import { useListInventoryItems, getListInventoryItemsQueryKey, type InventoryItem } from '@workspace/api-client-react';
import { SearchableCombobox, type ComboOption } from '@/components/shared/SearchableCombobox';

interface Props {
  onSelect: (item: InventoryItem) => void;
  value?: number | null;
  /** Pass an already-loaded list to avoid a second fetch */
  items?: InventoryItem[];
  excludeIds?: number[];
  className?: string;
  placeholder?: string;
  /** Show cost price when the API returned it (role-gated server side) */
  showCost?: boolean;
  disabled?: boolean;
}

/** Searchable parts picker. Matches name, SKU, category and supplier. Shows stock; cost only when returned. */
export function InventoryItemCombobox({ onSelect, value, items, excludeIds, className, placeholder = 'Add part from inventory...', showCost = true, disabled }: Props) {
  const { data: fetched } = useListInventoryItems(undefined, {
    query: { enabled: !items, queryKey: getListInventoryItemsQueryKey() },
  });
  const list = (items ?? (fetched as InventoryItem[] | undefined) ?? []);
  const options = useMemo<ComboOption[]>(() => list
    .filter(i => !excludeIds?.includes(i.id))
    .map(i => ({
      value: String(i.id),
      label: i.name,
      keywords: [i.sku, i.category ?? '', i.supplierName ?? ''].filter(Boolean),
      sub: [i.sku && `SKU ${i.sku}`, `${i.quantity} ${i.unit ?? ''} in stock`.trim(), i.isLowStock ? 'low' : '']
        .filter(Boolean).join(' · '),
      hint: <>
        ${Number(i.unitPrice ?? 0).toFixed(2)}
        {showCost && i.costPrice != null && <span className="block text-[10px]">cost ${Number(i.costPrice).toFixed(2)}</span>}
      </>,
    })), [list, excludeIds, showCost]);
  return (
    <SearchableCombobox
      className={className}
      options={options}
      value={value != null ? String(value) : null}
      onChange={v => { const it = list.find(i => String(i.id) === v); if (it) onSelect(it); }}
      triggerIcon={<Boxes className="w-3 h-3 text-muted-foreground" />}
      placeholder={placeholder}
      searchPlaceholder="Search name, SKU, part number..."
      emptyText={list.length ? 'No parts match that search.' : 'No inventory items yet.'}
      ariaLabel="Inventory part"
      disabled={disabled}
    />
  );
}
