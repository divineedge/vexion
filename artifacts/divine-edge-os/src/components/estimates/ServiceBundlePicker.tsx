import { Layers, Plus, X } from 'lucide-react';
import { SearchableCombobox, type ComboOption } from '@/components/shared/SearchableCombobox';

export interface BundledService { serviceId: number; serviceName: string; unitPrice: number }

export interface BundleFields {
  serviceId?: number;
  serviceName?: string;
  secondaryServiceId?: number;
  secondaryServiceName?: string;
  bundledServices?: BundledService[];
  description: string;
  unitPrice: number;
}

export interface CatalogServiceLite { id: number; name: string; basePrice: number; category: string | null; sku?: string | null }

/** Read-side migration: legacy secondary service becomes first extra; dedupe; never include primary. */
export function normalizeBundle<T extends Partial<BundleFields>>(item: T, catalog?: CatalogServiceLite[] | null): T {
  const raw: BundledService[] = Array.isArray(item.bundledServices) ? [...item.bundledServices] : [];
  if (item.secondaryServiceId && !raw.some(b => b.serviceId === item.secondaryServiceId)) {
    const cat = catalog?.find(s => s.id === item.secondaryServiceId);
    raw.unshift({
      serviceId: item.secondaryServiceId,
      serviceName: item.secondaryServiceName ?? cat?.name ?? 'Service',
      unitPrice: cat?.basePrice ?? 0,
    });
  }
  const seen = new Set<number>();
  const extras = raw.filter(b => {
    if (!b || typeof b.serviceId !== 'number' || b.serviceId === item.serviceId || seen.has(b.serviceId)) return false;
    seen.add(b.serviceId);
    return true;
  }).map(b => ({ serviceId: b.serviceId, serviceName: b.serviceName, unitPrice: Number(b.unitPrice) || 0 }));
  return {
    ...item,
    bundledServices: item.serviceId ? extras : [],
    secondaryServiceId: item.serviceId ? extras[0]?.serviceId : undefined,
    secondaryServiceName: item.serviceId ? extras[0]?.serviceName : undefined,
  };
}

/** Payload fields for the API (null-safe). */
export function bundlePayload(item: Partial<BundleFields>) {
  const n = normalizeBundle(item);
  return {
    secondaryServiceId: n.secondaryServiceId ?? null,
    secondaryServiceName: n.secondaryServiceName ?? null,
    bundledServices: n.bundledServices ?? [],
  };
}

function combinedName(primary: string | undefined, extras: BundledService[]) {
  return [primary ?? '', ...extras.map(e => e.serviceName)].filter(Boolean).join(' + ');
}

interface Props {
  item: BundleFields;
  catalog: CatalogServiceLite[] | null | undefined;
  onChange: (patch: Partial<BundleFields>) => void;
  compact?: boolean;
}

/**
 * Primary service + any number of bundled extras on one line.
 * Price math only runs on explicit selection changes. The primary's frozen price is derived
 * as current unitPrice minus current extras, so manual overrides survive add/remove.
 */
export function ServiceBundlePicker({ item, catalog, onChange, compact }: Props) {
  const n = normalizeBundle(item, catalog);
  const extras = n.bundledServices ?? [];
  const services = catalog ?? [];
  const extrasSum = (xs: BundledService[]) => xs.reduce((s, x) => s + x.unitPrice, 0);
  const prevDesc = combinedName(n.serviceName, extras);
  const descFor = (primary: string | undefined, xs: BundledService[]) =>
    !item.description || item.description === prevDesc ? combinedName(primary, xs) : item.description;

  const opt = (s: CatalogServiceLite): ComboOption => ({
    value: String(s.id), label: s.name,
    keywords: [s.category ?? '', s.sku ?? ''].filter(Boolean),
    sub: s.category ?? undefined, hint: `$${s.basePrice.toFixed(2)}`,
  });

  function setPrimary(v: string) {
    if (v === '__custom__') {
      onChange({ serviceId: undefined, serviceName: undefined, secondaryServiceId: undefined, secondaryServiceName: undefined, bundledServices: [] });
      return;
    }
    const svc = services.find(s => String(s.id) === v);
    if (!svc || svc.id === n.serviceId) return;
    const xs = extras.filter(e => e.serviceId !== svc.id);
    onChange({
      serviceId: svc.id, serviceName: svc.name,
      bundledServices: xs, secondaryServiceId: xs[0]?.serviceId, secondaryServiceName: xs[0]?.serviceName,
      description: descFor(svc.name, xs),
      unitPrice: Math.round((svc.basePrice + extrasSum(xs)) * 100) / 100,
    });
  }
  function setExtras(xs: BundledService[]) {
    const primaryFrozen = (Number(item.unitPrice) || 0) - extrasSum(extras);
    onChange({
      bundledServices: xs, secondaryServiceId: xs[0]?.serviceId, secondaryServiceName: xs[0]?.serviceName,
      description: descFor(n.serviceName, xs),
      unitPrice: Math.round((primaryFrozen + extrasSum(xs)) * 100) / 100,
    });
  }
  const addExtra = (v: string) => {
    const svc = services.find(s => String(s.id) === v);
    if (!svc || svc.id === n.serviceId || extras.some(e => e.serviceId === svc.id)) return;
    setExtras([...extras, { serviceId: svc.id, serviceName: svc.name, unitPrice: svc.basePrice }]);
  };
  const available = services.filter(s => s.id !== n.serviceId && !extras.some(e => e.serviceId === s.id));

  return (
    <div className="flex flex-col gap-2 flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <SearchableCombobox
          className={compact ? 'flex-1 min-w-[140px]' : 'flex-1 min-w-[160px]'}
          options={services.map(opt)}
          leadingOption={{ value: '__custom__', label: 'Custom line item' }}
          value={n.serviceId ? String(n.serviceId) : '__custom__'}
          displayLabel={n.serviceId && !services.some(s => s.id === n.serviceId) ? n.serviceName : undefined}
          onChange={setPrimary}
          placeholder="Custom / pick service..."
          searchPlaceholder="Search services..."
          emptyText="No services match."
          ariaLabel="Primary service"
          title="Pick a service from the catalog"
        />
        {n.serviceId && (
          <SearchableCombobox
            className="w-44"
            options={available.map(opt)}
            value={null}
            onChange={addExtra}
            triggerIcon={<Plus className="w-3 h-3 text-indigo-500" />}
            displayLabel={<span className="text-muted-foreground">Bundle service</span>}
            searchPlaceholder="Search services to bundle..."
            emptyText={available.length ? 'No services match.' : 'Every service is already on this line.'}
            ariaLabel="Add bundled service"
            title="Bundle another service into this line"
          />
        )}
      </div>
      {extras.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Bundled services">
          <Layers className="w-3 h-3 text-indigo-500" aria-hidden />
          {extras.map(e => (
            <span key={e.serviceId} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
              {e.serviceName}
              <span className="tabular-nums text-indigo-500">${e.unitPrice.toFixed(2)}</span>
              <button
                type="button"
                className="rounded-full hover:bg-indigo-100 p-0.5"
                aria-label={`Remove ${e.serviceName} from bundle`}
                onClick={() => setExtras(extras.filter(x => x.serviceId !== e.serviceId))}
              ><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
