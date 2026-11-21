import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useListInventoryItems, getListInventoryItemsQueryKey, type InventoryItem } from "@workspace/api-client-react";
import { SearchableCombobox, type ComboOption } from "@/components/shared/SearchableCombobox";
import { searchKindLabel, type CatalogHit } from "@/lib/lineEntry";
import type { CatalogServiceLite } from "@/components/estimates/ServiceBundlePicker";

interface PlanRow {
  id: number;
  name: string;
  price: number;
  billingCycle: string;
  description: string | null;
  isActive?: boolean;
}

export interface PassThroughRow {
  id: number;
  description: string;
  unit: string | null;
  internalCost: number | null;
  unitPrice: number;
  markup: number;
}

interface ServiceRow extends CatalogServiceLite {
  description?: string | null;
  isActive?: boolean;
}

function isKit(item: InventoryItem): boolean {
  return !!item.linkedParts && item.linkedParts.components.length > 0;
}

export function LineCatalogSearch({
  testId,
  onSelect,
}: {
  testId: string;
  onSelect: (hit: CatalogHit, extras?: { service?: ServiceRow }) => void;
}) {
  const services = useQuery({
    queryKey: ["line-catalog-services"],
    queryFn: () => customFetch<ServiceRow[]>("/api/services?activeOnly=true"),
    staleTime: 60_000,
  });
  const plans = useQuery({
    queryKey: ["line-catalog-plans"],
    queryFn: () => customFetch<PlanRow[]>("/api/plan-templates"),
    staleTime: 60_000,
  });
  const saved = useQuery({
    queryKey: ["line-catalog"],
    queryFn: () => customFetch<PassThroughRow[]>("/api/line-catalog"),
    staleTime: 15_000,
  });
  const inventory = useListInventoryItems(undefined, { query: { queryKey: getListInventoryItemsQueryKey() } });
  const items = (inventory.data ?? []) as InventoryItem[];

  const { options, hits, serviceById } = useMemo(() => {
    const nextHits = new Map<string, CatalogHit>();
    const nextServices = new Map<number, ServiceRow>();
    const options: ComboOption[] = [];
    const add = (value: string, hit: CatalogHit, label: string, sub?: string) => {
      nextHits.set(value, hit);
      options.push({
        value,
        label,
        sub,
        hint: searchKindLabel(hit.kind),
        keywords: [searchKindLabel(hit.kind), label, sub ?? ""],
      });
    };
    for (const service of services.data ?? []) {
      nextServices.set(service.id, service);
      add(`service:${service.id}`, {
        kind: "service",
        id: service.id,
        name: service.name,
        description: service.description ?? null,
        unitPrice: service.basePrice,
      }, service.name, service.description?.trim() || undefined);
    }
    for (const item of items) {
      if (isKit(item)) {
        add(`kit:${item.id}`, {
          kind: "kit",
          id: item.id,
          name: item.name,
          unitPrice: Number(item.unitPrice ?? 0),
          sku: item.sku ?? null,
        }, item.name, item.sku ? `SKU ${item.sku}` : undefined);
      } else {
        add(`part:${item.id}`, {
          kind: "part",
          id: item.id,
          name: item.name,
          unitPrice: Number(item.unitPrice ?? 0),
          sku: item.sku ?? null,
        }, item.name, item.sku ? `SKU ${item.sku}` : undefined);
      }
    }
    for (const plan of (plans.data ?? []).filter(plan => plan.isActive !== false)) {
      add(`plan:${plan.id}`, {
        kind: "plan",
        id: plan.id,
        name: plan.name,
        description: plan.description,
        unitPrice: Number(plan.price ?? 0),
        billingCycle: plan.billingCycle,
      }, plan.name, plan.billingCycle);
    }
    for (const row of saved.data ?? []) {
      add(`pass:${row.id}`, {
        kind: "pass",
        id: row.id,
        description: row.description,
        unit: row.unit,
        internalCost: row.internalCost,
        unitPrice: Number(row.unitPrice ?? 0),
        markup: Number(row.markup ?? 0),
      }, row.description, row.unit ? `${row.markup}% on ${row.unit}` : `${row.markup}% markup`);
    }
    return { options, hits: nextHits, serviceById: nextServices };
  }, [services.data, plans.data, saved.data, items]);

  return (
    <SearchableCombobox
      className="flex-1 min-w-[220px]"
      testId={`${testId}-search`}
      options={options}
      value={null}
      leadingOption={{
        value: "custom:new",
        label: "One-off custom line",
        hint: "Pass-through",
        keywords: ["Custom", "Pass-through", "pass through"],
      }}
      displayLabel={<span className="text-muted-foreground">Search services, parts, plans, pass-through, kits</span>}
      onChange={value => {
        if (value === "custom:new") {
          onSelect({ kind: "custom-new" });
          return;
        }
        const hit = hits.get(value);
        if (!hit) return;
        onSelect(hit, hit.kind === "service" ? { service: serviceById.get(hit.id) } : undefined);
      }}
      placeholder="Search services, parts, plans, pass-through, kits"
      searchPlaceholder="Type to search all of them"
      emptyText="Nothing matches. Use a one-off custom line if it is not a service, part, plan, or kit."
      ariaLabel="Search line catalog"
      title="Search services, parts, plans, saved pass-through items, and kits"
    />
  );
}
