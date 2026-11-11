import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Search, Plus, Briefcase, DollarSign, Clock, Edit, Trash2, TrendingUp, Grid3X3, X, Snowflake, Ruler } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import type { PriceRounding, PricingTier, TierCalculationMode } from '@/lib/pricingMatrix';
import { PaymentPolicyCard } from '@/components/billing/PaymentPolicyCard';

const mkKey = () => Math.random().toString(36).slice(2, 10);
type TierWithKey = PricingTier & { _key: string };

interface ZoneType {
  id: string;
  name: string;
  color: string;
  mode?: 'area' | 'linear' | 'both';
}

interface Service {
  id: number;
  tenantId: number;
  name: string;
  description: string | null;
  category: string | null;
  basePrice: number;
  estimatedDuration: number | null;
  p4pPercentage: number | null;
  isActive: boolean;
  pricingMode: string;
  pricingMatrix: PricingTier[] | null;
  linkedZoneTypeId: string | null;
  linearRate?: number | null;
  hourlyRate?: number | null;
  minimumBillableMinutes?: number | null;
  offSeasonStart: string | null;
  offSeasonEnd: string | null;
  fieldRequirements?: { requiresChemicalApplication?: boolean; showMaterialsOrParts?: boolean; invoiceDateBasis?: "completed" | "scheduled" } | null;
  createdAt: string;
  updatedAt: string;
}

type ServiceForm = {
  name: string;
  description: string;
  category: string;
  basePrice: string;
  estimatedDuration: string;
  p4pPercentage: string;
  isActive: boolean;
  pricingMode: 'flat' | 'per_sqft' | 'per_linear_ft' | 'area_and_linear' | 'matrix' | 'hourly';
  linearRate: string;
  hourlyRate: string;
  minimumBillableHours: string;
  matrixBasis: 'area' | 'linear' | 'both';
  matrixRounding: PriceRounding;
  pricingMatrix: TierWithKey[];
  linkedZoneTypeId: string;
  offSeasonEnabled: boolean;
  offSeasonStartMonth: string;
  offSeasonStartDay: string;
  offSeasonEndMonth: string;
  offSeasonEndDay: string;
  requiresChemicalApplication: boolean;
  invoiceDateBasis: "completed" | "scheduled";
  showMaterialsOrParts: boolean;
};

const EMPTY_FORM: ServiceForm = {
  name: '',
  description: '',
  category: '',
  basePrice: '',
  estimatedDuration: '',
  p4pPercentage: '',
  isActive: true,
  pricingMode: 'flat',
  linearRate: '',
  hourlyRate: '',
  minimumBillableHours: '',
  matrixBasis: 'area',
  matrixRounding: 'none',
  pricingMatrix: [],
  linkedZoneTypeId: '',
  offSeasonEnabled: false,
  offSeasonStartMonth: '11',
  offSeasonStartDay: '15',
  offSeasonEndMonth: '03',
  offSeasonEndDay: '14',
  requiresChemicalApplication: false,
  invoiceDateBasis: "completed",
  showMaterialsOrParts: false,
};

const EMPTY_TIER: TierWithKey = { minSqft: 0, maxSqft: null, price: 0, calculationMode: 'flat', _key: mkKey() };

function TierRow({
  tier,
  index,
  isLast,
  basis,
  onChange,
  onRemove,
}: {
  tier: TierWithKey;
  index: number;
  isLast: boolean;
  basis: 'area' | 'linear' | 'both';
  onChange: (t: TierWithKey) => void;
  onRemove: () => void;
}) {
  const unitLabel = basis === 'linear' ? 'ft' : 'sq ft';
  const mode: TierCalculationMode = tier.calculationMode === 'per_unit_above_base' ? 'per_unit_above_base' : 'flat';

  const [minStr, setMinStr] = React.useState(index === 0 && tier.minSqft === 0 ? '0' : String(tier.minSqft || ''));
  const [maxStr, setMaxStr] = React.useState(tier.maxSqft != null ? String(tier.maxSqft) : '');
  const [priceStr, setPriceStr] = React.useState(tier.price ? String(tier.price) : '');
  const [unitStr, setUnitStr] = React.useState(tier.unitRate != null ? String(tier.unitRate) : tier.perSqftRate != null ? String(tier.perSqftRate) : '');
  const [perLinearStr, setPerLinearStr] = React.useState(tier.perLinearFtRate != null ? String(tier.perLinearFtRate) : '');
  const [minsStr, setMinsStr] = React.useState(tier.estimatedMinutes != null ? String(tier.estimatedMinutes) : '');
  const commit = (patch: Partial<PricingTier>) => onChange({ ...tier, ...patch } as TierWithKey);

  return (
    <div className="rounded-md border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Tier {index + 1}</p>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove} title="Remove this tier">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">From</label>
        <Input
          type="text"
          inputMode="decimal"
          title={basis === 'linear' ? 'Minimum perimeter in feet for this pricing tier' : 'Minimum property area for this pricing tier'}
          value={minStr}
          onChange={e => {
            setMinStr(e.target.value);
            const n = parseFloat(e.target.value);
            if (!isNaN(n)) commit({ minSqft: n });
          }}
          onBlur={() => {
            const n = parseFloat(minStr);
            const val = isNaN(n) ? 0 : n;
            setMinStr(String(val));
            commit({ minSqft: val });
          }}
          className="w-28 text-sm"
        />
        <span className="text-xs text-muted-foreground">{unitLabel}</span>
        {isLast ? (
          <span className="text-xs text-muted-foreground">Open-ended — anything above this minimum</span>
        ) : (
          <>
            <label className="text-xs text-muted-foreground">Up to</label>
            <Input
              type="text"
              inputMode="decimal"
              title="Maximum for this tier. The last tier covers anything above it."
              placeholder="Maximum"
              value={maxStr}
              onChange={e => {
                setMaxStr(e.target.value);
                const n = parseFloat(e.target.value);
                if (!isNaN(n)) commit({ maxSqft: n });
              }}
              onBlur={() => {
                const n = parseFloat(maxStr);
                if (isNaN(n)) { setMaxStr(''); }
                else { setMaxStr(String(n)); commit({ maxSqft: n }); }
              }}
              className="w-28 text-sm"
            />
            <span className="text-xs text-muted-foreground">{unitLabel}</span>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={mode} onValueChange={value => commit({ calculationMode: value === 'per_unit_above_base' ? 'per_unit_above_base' : 'flat' })}>
          <SelectTrigger className="w-64" title="How this tier calculates its price"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="flat">Base price (flat rate)</SelectItem>
            <SelectItem value="per_unit_above_base">Price per unit above base</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            type="text"
            inputMode="decimal"
            title={mode === 'flat' ? 'Fixed dollar amount for this entire range' : 'Base price covering up to this tier minimum'}
            placeholder="0.00"
            value={priceStr}
            onChange={e => {
              setPriceStr(e.target.value);
              const n = parseFloat(e.target.value);
              if (!isNaN(n)) commit({ price: n });
            }}
            onBlur={() => {
              const n = parseFloat(priceStr);
              if (isNaN(n) || priceStr === '') { setPriceStr(''); commit({ price: 0 }); }
              else { setPriceStr(String(n)); commit({ price: n }); }
            }}
            className="w-28 text-sm"
          />
        </div>
        {mode === 'per_unit_above_base' && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">+ $</span>
            <Input
              type="text"
              inputMode="decimal"
              title={`Rate charged for each ${unitLabel} above the tier minimum`}
              placeholder="0.00"
              value={unitStr}
              onChange={e => {
                setUnitStr(e.target.value);
                const n = parseFloat(e.target.value);
                if (!isNaN(n)) commit({ unitRate: n, perSqftRate: n });
              }}
              onBlur={() => {
                const n = parseFloat(unitStr);
                if (isNaN(n) || unitStr === '') { setUnitStr(''); commit({ unitRate: 0, perSqftRate: 0 }); }
                else { setUnitStr(String(n)); commit({ unitRate: n, perSqftRate: n }); }
              }}
              className="w-24 text-sm"
            />
            <span className="text-xs text-muted-foreground">per {unitLabel} above the minimum</span>
          </div>
        )}
      </div>
      {basis === 'both' && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">+ $</span>
          <Input
            type="text"
            inputMode="decimal"
            title="Amount charged for each linear foot in this tier"
            placeholder="0.00"
            value={perLinearStr}
            onChange={e => {
              setPerLinearStr(e.target.value);
              const n = parseFloat(e.target.value);
              if (!isNaN(n)) commit({ perLinearFtRate: n });
            }}
            onBlur={() => {
              const n = parseFloat(perLinearStr);
              if (isNaN(n) || perLinearStr === '') { setPerLinearStr(''); commit({ perLinearFtRate: undefined }); }
              else { setPerLinearStr(String(n)); commit({ perLinearFtRate: n }); }
            }}
            className="w-24 text-sm"
          />
          <span className="text-xs text-muted-foreground">per linear ft</span>
        </div>
      )}
      <div className="flex items-center gap-1">
        <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
        <Input
          type="text"
          inputMode="numeric"
          placeholder="minutes"
          title="Estimated duration in minutes for this range"
          value={minsStr}
          onChange={e => {
            setMinsStr(e.target.value);
            if (e.target.value === '') { commit({ estimatedMinutes: undefined }); return; }
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) commit({ estimatedMinutes: n });
          }}
          onBlur={() => {
            if (minsStr === '') { commit({ estimatedMinutes: undefined }); return; }
            const n = parseInt(minsStr, 10);
            if (isNaN(n)) { setMinsStr(''); commit({ estimatedMinutes: undefined }); }
            else { setMinsStr(String(n)); commit({ estimatedMinutes: n }); }
          }}
          className="w-24 text-sm"
        />
        <span className="text-xs text-muted-foreground">est. minutes</span>
      </div>
    </div>
  );
}

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

function daysForMonth(month: string): string[] {
  const counts: Record<string, number> = {
    '01': 31, '02': 29, '03': 31, '04': 30, '05': 31, '06': 30,
    '07': 31, '08': 31, '09': 30, '10': 31, '11': 30, '12': 31,
  };
  const n = counts[month] ?? 31;
  return Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, '0'));
}

function formatMMDD(mmdd: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [mm, dd] = mmdd.split('-');
  return `${months[parseInt(mm, 10) - 1] ?? mm} ${parseInt(dd, 10)}`;
}

function MonthDayPicker({
  month, day, onMonthChange, onDayChange, label,
}: {
  month: string; day: string;
  onMonthChange: (v: string) => void; onDayChange: (v: string) => void;
  label: string;
}) {
  const days = daysForMonth(month);
  const safeDay = days.includes(day) ? day : days[days.length - 1] ?? '01';

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <Select value={month} onValueChange={v => { onMonthChange(v); }}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {MONTHS.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={safeDay} onValueChange={onDayChange}>
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {days.map(d => (
              <SelectItem key={d} value={d}>{parseInt(d, 10)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export default function ServicesPage() {
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const categoriesQuery = useQuery({ queryKey: ['service-categories'], queryFn: () => customFetch<{ categories: { id: number; name: string }[] }>('/api/settings/service-categories') });
  const [categoryName, setCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const saveCategory = useMutation({
    mutationFn: (body: { id?: number; name: string; remove?: boolean }) => body.remove
      ? customFetch(`/api/settings/service-categories/${body.id}`, { method: 'DELETE' })
      : body.id
        ? customFetch(`/api/settings/service-categories/${body.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: body.name }) })
        : customFetch('/api/settings/service-categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: body.name }) }),
    onSuccess: () => { setCategoryName(''); qc.invalidateQueries({ queryKey: ['service-categories'] }); toast.success('Service categories updated'); },
    onError: () => toast.error('Could not update that category'),
  });
  const createCategory = useMutation({
    mutationFn: (name: string) => customFetch<{ id: number; name: string }>('/api/service-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
    onSuccess: created => {
      qc.setQueryData(['service-categories'], (current: { categories?: { id: number; name: string }[] } | undefined) => {
        const categories = [...(current?.categories ?? []).filter(category => category.id !== Number(created.id) && category.name !== created.name), { id: Number(created.id), name: created.name }];
        categories.sort((a, b) => a.name.localeCompare(b.name));
        return { categories };
      });
      setForm(current => ({ ...current, category: created.name }));
      setNewCategoryName('');
      setShowNewCategory(false);
      toast.success('Category added');
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Could not add that category'),
  });
  const globalP4pRate = (settings as any)?.p4pMasterPercentage ?? 0;

  // P4P inline edit
  const [p4pEditing, setP4pEditing] = useState(false);
  const [p4pInput, setP4pInput] = useState('');
  const updateSettings = useMutation({
    mutationFn: (data: object) => customFetch('/api/settings', { method: 'PATCH', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); toast.success('P4P rate updated'); setP4pEditing(false); },
    onError: () => toast.error('Failed to save P4P rate'),
  });
  const zoneTypes: ZoneType[] = (settings as any)?.measurementZoneTypes ?? [];

  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ['services', debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      return customFetch<Service[]>(`/api/services?${params}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: object) =>
      customFetch<Service>('/api/services', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => {
      toast.success('Service created');
      qc.invalidateQueries({ queryKey: ['services'] });
      setSheetMode(null);
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to create service'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) =>
      customFetch<Service>(`/api/services/${id}`, { method: 'PATCH', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => {
      toast.success('Service updated');
      qc.invalidateQueries({ queryKey: ['services'] });
      setSheetMode(null);
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to update service'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/services/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Service deleted');
      qc.invalidateQueries({ queryKey: ['services'] });
      setSheetMode(null);
    },
    onError: () => toast.error('Failed to delete service'),
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setSelectedId(null);
    setSheetMode('create');
  };

  const openEdit = (s: Service) => {
    const hasOffSeason = !!(s.offSeasonStart && s.offSeasonEnd);
    const [startMonth = '11', startDay = '15'] = (s.offSeasonStart ?? '11-15').split('-');
    const [endMonth = '03', endDay = '14'] = (s.offSeasonEnd ?? '03-14').split('-');

    setForm({
      name: s.name,
      description: s.description ?? '',
      category: s.category ?? '',
      basePrice: String(s.basePrice),
      estimatedDuration: s.estimatedDuration != null ? String(s.estimatedDuration) : '',
      p4pPercentage: s.p4pPercentage != null ? String(s.p4pPercentage) : '',
      isActive: s.isActive,
      pricingMode: ['flat', 'per_sqft', 'per_linear_ft', 'area_and_linear', 'matrix', 'hourly'].includes(s.pricingMode)
        ? s.pricingMode as ServiceForm['pricingMode']
        : 'flat',
      linearRate: s.linearRate != null ? String(s.linearRate) : '',
      hourlyRate: s.hourlyRate != null ? String(s.hourlyRate) : s.pricingMode === 'hourly' ? String(s.basePrice) : '',
      minimumBillableHours: s.minimumBillableMinutes != null ? String(Math.round((s.minimumBillableMinutes / 60) * 100) / 100) : '',
      matrixBasis: (Array.isArray(s.pricingMatrix) && (s.pricingMatrix as PricingTier[])[0]?.basis) || 'area',
      matrixRounding: (Array.isArray(s.pricingMatrix) && (s.pricingMatrix as PricingTier[])[0]?.priceRounding) || 'none',
      pricingMatrix: Array.isArray(s.pricingMatrix) ? (s.pricingMatrix as PricingTier[]).map(t => ({ ...t, unitRate: t.unitRate ?? t.perSqftRate, _key: mkKey() })) : [],
      linkedZoneTypeId: s.linkedZoneTypeId ?? '',
      offSeasonEnabled: hasOffSeason,
      offSeasonStartMonth: startMonth,
      offSeasonStartDay: startDay,
      offSeasonEndMonth: endMonth,
      offSeasonEndDay: endDay,
      requiresChemicalApplication: s.fieldRequirements?.requiresChemicalApplication === true,
      invoiceDateBasis: s.fieldRequirements?.invoiceDateBasis ?? "completed",
      showMaterialsOrParts: s.fieldRequirements?.showMaterialsOrParts === true,
    });
    setSelectedId(s.id);
    setSheetMode('edit');
  };

  const handleSave = () => {
    if (!form.name) { toast.error('Service name is required'); return; }
    if (form.pricingMode === 'hourly' && (!(Number(form.hourlyRate) > 0))) {
      toast.error('Enter an hourly rate greater than zero');
      return;
    }
    if (form.pricingMode === 'matrix' && form.pricingMatrix.length === 0) {
      toast.error('Add at least one pricing tier, or switch to Flat rate');
      return;
    }
    if (form.pricingMode === 'matrix' && form.pricingMatrix.slice(0, -1).some(tier => tier.maxSqft == null || !(tier.maxSqft > tier.minSqft))) {
      toast.error('Enter a maximum above the minimum for every tier except the last');
      return;
    }

    const offSeasonStart = form.offSeasonEnabled
      ? `${form.offSeasonStartMonth}-${form.offSeasonStartDay}`
      : '';
    const offSeasonEnd = form.offSeasonEnabled
      ? `${form.offSeasonEndMonth}-${form.offSeasonEndDay}`
      : '';

    const payload: object = {
      name: form.name,
      description: form.description,
      category: form.category,
      basePrice: form.pricingMode === 'hourly' ? form.hourlyRate : form.basePrice,
      hourlyRate: form.pricingMode === 'hourly' ? form.hourlyRate : null,
      minimumBillableHours: form.pricingMode === 'hourly' ? form.minimumBillableHours : null,
      estimatedDuration: form.estimatedDuration,
      p4pPercentage: form.p4pPercentage,
      isActive: form.isActive,
      pricingMode: form.pricingMode,
      linearRate: form.linearRate,
      priceRounding: form.matrixRounding,
      pricingMatrix: form.pricingMode === 'matrix'
        ? form.pricingMatrix.map(({ _key, ...t }, index, all) => ({
            ...t,
            basis: form.matrixBasis,
            priceRounding: form.matrixRounding,
            calculationMode: t.calculationMode === 'per_unit_above_base' ? 'per_unit_above_base' : t.calculationMode === 'flat' ? 'flat' : undefined,
            unitRate: t.calculationMode === 'per_unit_above_base' ? (t.unitRate ?? t.perSqftRate ?? 0) : t.unitRate,
            maxSqft: index === all.length - 1 ? null : t.maxSqft,
          }))
        : null,
      linkedZoneTypeId: form.linkedZoneTypeId || null,
      offSeasonStart,
      offSeasonEnd,
      fieldRequirements: {
        invoiceDateBasis: form.invoiceDateBasis,
        requiresChemicalApplication: form.requiresChemicalApplication,
        showMaterialsOrParts: form.showMaterialsOrParts,
      },
    };

    if (sheetMode === 'create') {
      createMutation.mutate(payload);
    } else if (sheetMode === 'edit' && selectedId) {
      updateMutation.mutate({ id: selectedId, data: payload });
    }
  };

  // Matrix tier helpers
  const addTier = () => {
    setForm(f => {
      const tiers = f.pricingMatrix.map((tier, index) => {
        if (index !== f.pricingMatrix.length - 1 || tier.maxSqft != null) return tier;
        return { ...tier, maxSqft: tier.minSqft + 4999 };
      });
      const previous = tiers[tiers.length - 1];
      const newMin = previous ? (previous.maxSqft != null ? previous.maxSqft + 1 : previous.minSqft + 1) : 0;
      const newTier: TierWithKey = { minSqft: newMin, maxSqft: null, price: 0, calculationMode: 'flat', _key: mkKey() };
      return { ...f, pricingMatrix: [...tiers, newTier] };
    });
  };

  const updateTier = (i: number, t: TierWithKey) =>
    setForm(f => ({ ...f, pricingMatrix: f.pricingMatrix.map((r, idx) => idx === i ? t : r) as TierWithKey[] }));

  const removeTier = (i: number) =>
    setForm(f => ({ ...f, pricingMatrix: f.pricingMatrix.filter((_, idx) => idx !== i) as TierWithKey[] }));

  const activeCount = services?.filter(s => s.isActive).length ?? 0;
  const categories = [...new Set(services?.map(s => s.category).filter(Boolean) ?? [])];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Service Catalog</h1>
          <p className="text-muted-foreground mt-1">Define the services your company offers and their pricing.</p>
        </div>
        {canManageOffice && (
          <Button className="gap-2" title="Create a new service offered by this business" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Service
          </Button>
        )}
      </div>

      {canManageOffice && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="font-medium">Service categories</p>
              <p className="text-sm text-muted-foreground">Create the master categories used on services and in the category report. Examples: Mowing, Chemical Treatment, Irrigation, Landscaping.</p>
            </div>
            <div className="flex gap-2">
              <Input value={categoryName} placeholder="New category" onChange={event => setCategoryName(event.target.value)} />
              <Button onClick={() => categoryName.trim() && saveCategory.mutate({ name: categoryName.trim() })}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(categoriesQuery.data?.categories ?? []).map(category => (
                <div key={category.id} className="flex items-center gap-1 rounded-full border px-2 py-1 text-sm">
                  <span>{category.name}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => saveCategory.mutate({ id: category.id, name: category.name, remove: true })}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <p className="text-3xl font-bold">{activeCount}</p>
              <p className="text-sm text-muted-foreground">Active Services</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-3xl font-bold">{categories.length}</p>
              <p className="text-sm text-muted-foreground">Categories</p>
            </div>
          </CardContent>
        </Card>
        <Card className={canManageOffice ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''} onClick={() => { if (!canManageOffice || p4pEditing) return; setP4pInput(String(globalP4pRate)); setP4pEditing(true); }}>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              {p4pEditing ? (
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <input
                    autoFocus
                    type="number" min={0} max={100} step={0.5}
                    className="w-20 text-2xl font-bold bg-transparent border-b-2 border-primary outline-none"
                    value={p4pInput}
                    onChange={e => setP4pInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') updateSettings.mutate({ p4pMasterPercentage: parseFloat(p4pInput) || 0 });
                      if (e.key === 'Escape') setP4pEditing(false);
                    }}
                  />
                  <span className="text-xl font-bold text-muted-foreground">%</span>
                  <button className="text-xs text-primary font-medium ml-2" onClick={() => updateSettings.mutate({ p4pMasterPercentage: parseFloat(p4pInput) || 0 })}>Save</button>
                  <button className="text-xs text-muted-foreground" onClick={() => setP4pEditing(false)}>Cancel</button>
                </div>
              ) : (
                <p className="text-3xl font-bold">{globalP4pRate}%</p>
              )}
              <p className="text-sm text-muted-foreground">Global P4P Rate{canManageOffice && !p4pEditing && <span className="ml-1 text-xs opacity-60">· click to edit</span>}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                title="Search services by name, category, or description"
                placeholder="Search services..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Pricing</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">P4P Rate</TableHead>
                <TableHead>Off Season</TableHead>
                <TableHead className="text-center">Status</TableHead>
                {canManageOffice && <TableHead className="w-[60px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading services...</TableCell></TableRow>
              ) : (services ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No services yet</p>
                    <p className="text-sm mt-1">Add your first service to start building your catalog.</p>
                  </TableCell>
                </TableRow>
              ) : (
                (services ?? []).map(s => (
                  <TableRow key={s.id} className={`hover:bg-muted/50 ${!s.isActive ? 'opacity-60' : ''}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium" title={s.name}>{s.name}</span>
                        {s.pricingMode === 'matrix' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-violet-600 border-violet-300 bg-violet-50">
                            <Grid3X3 className="w-2.5 h-2.5" /> matrix
                          </Badge>
                        )}
                        {s.pricingMode === 'per_linear_ft' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-cyan-700 border-cyan-300 bg-cyan-50">
                            <Ruler className="w-2.5 h-2.5" /> linear ft
                          </Badge>
                        )}
                        {s.pricingMode === 'area_and_linear' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-emerald-700 border-emerald-300 bg-emerald-50">
                            <Ruler className="w-2.5 h-2.5" /> area + linear
                          </Badge>
                        )}
                      </div>
                      {s.description && <div className="text-xs text-muted-foreground truncate max-w-xs mt-0.5" title={s.description}>{s.description}</div>}
                    </TableCell>
                    <TableCell>
                      {s.category ? <Badge variant="outline" title={`Category: ${s.category}`}>{s.category}</Badge> : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {s.pricingMode === 'matrix' ? (
                        <span className="text-xs text-violet-600 font-medium" title={`Area-based matrix pricing — ${Array.isArray(s.pricingMatrix) ? s.pricingMatrix.length : 0} sqft tier(s)`}>
                          {Array.isArray(s.pricingMatrix) ? `${s.pricingMatrix.length} tier${s.pricingMatrix.length !== 1 ? 's' : ''}` : 'matrix'}
                        </span>
                      ) : s.pricingMode === 'per_linear_ft' ? (
                        <span title={`Rate: $${s.basePrice.toFixed(2)} per linear foot`}>${s.basePrice.toFixed(2)}/ft</span>
                      ) : s.pricingMode === 'area_and_linear' ? (
                        <span title={`$${s.basePrice.toFixed(2)} per square foot plus $${(s.linearRate ?? 0).toFixed(2)} per linear foot`}>${s.basePrice.toFixed(2)}/sqft + ${(s.linearRate ?? 0).toFixed(2)}/ft</span>
                      ) : s.pricingMode === 'hourly' ? (
                        <span title={`Hourly rate: $${(s.hourlyRate ?? s.basePrice).toFixed(2)}`}>${(s.hourlyRate ?? s.basePrice).toFixed(2)}/hr</span>
                      ) : s.pricingMode === 'per_sqft' ? (
                        <span title={`Rate: $${s.basePrice.toFixed(2)} per square foot`}>${s.basePrice.toFixed(2)}/sqft</span>
                      ) : (
                        <span title={`Base price: $${s.basePrice.toFixed(2)}`}>${s.basePrice.toFixed(2)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {s.estimatedDuration != null ? (
                        <span className="flex items-center justify-end gap-1" title={`Estimated duration: ${s.estimatedDuration} minutes`}>
                          <Clock className="w-3.5 h-3.5" />
                          {s.estimatedDuration >= 60
                            ? `${Math.floor(s.estimatedDuration / 60)}h ${s.estimatedDuration % 60 > 0 ? `${s.estimatedDuration % 60}m` : ''}`
                            : `${s.estimatedDuration}m`}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.p4pPercentage != null ? (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium" title={`Service-specific P4P rate: ${s.p4pPercentage}%`}>
                          {s.p4pPercentage}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground" title={`Using global P4P rate: ${globalP4pRate}%`}>Global ({globalP4pRate}%)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.offSeasonStart && s.offSeasonEnd ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">
                          <Snowflake className="w-3 h-3" />
                          {formatMMDD(s.offSeasonStart)} – {formatMMDD(s.offSeasonEnd)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={s.isActive ? 'default' : 'secondary'} title={s.isActive ? 'Service is active and available for scheduling' : 'Service is inactive and hidden from scheduling'} className={s.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : ''}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {canManageOffice && (
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit Sheet */}
      <Sheet open={sheetMode !== null} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-[75vw] overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>{sheetMode === 'create' ? 'Add Service' : 'Edit Service'}</SheetTitle>
            <SheetDescription>
              {sheetMode === 'create'
                ? 'Add a service to your catalog. Customers can be booked for any of these.'
                : 'Update the service details.'}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Service Name <span className="text-destructive">*</span></label>
              <Input
                title="Name of this service as it appears on jobs, estimates, and invoices"
                placeholder="e.g. Full Lawn Service"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Select value={form.category || 'none'} onValueChange={value => setForm(f => ({ ...f, category: value === 'none' ? '' : value }))}>
                <SelectTrigger><SelectValue placeholder="Choose a category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {(categoriesQuery.data?.categories ?? []).map(category => (
                    <SelectItem key={category.id} value={category.name}>{category.name}</SelectItem>
                  ))}
                  {form.category && !(categoriesQuery.data?.categories ?? []).some(category => category.name === form.category) && (
                    <SelectItem value={form.category}>{form.category}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {showNewCategory ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    placeholder="New category"
                    value={newCategoryName}
                    onChange={event => setNewCategoryName(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter' && newCategoryName.trim()) createCategory.mutate(newCategoryName.trim()); }}
                  />
                  <Button type="button" disabled={createCategory.isPending || !newCategoryName.trim()} onClick={() => createCategory.mutate(newCategoryName.trim())}>Save</Button>
                </div>
              ) : (
                <Button type="button" variant="outline" onClick={() => setShowNewCategory(true)}>Add New Category</Button>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                title="Description shown to customers on estimates and invoices"
                placeholder="What does this service include?"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <div>
                <p className="text-sm font-medium">Field App requirements</p>
                <p className="text-xs text-muted-foreground mt-1">Choose exactly what technicians must collect for this service.</p>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm font-medium">Require chemical application log</label>
                  <p className="text-xs text-muted-foreground">A job cannot be completed until an application is logged.</p>
                </div>
                <Switch checked={form.requiresChemicalApplication} onCheckedChange={checked => setForm(f => ({ ...f, requiresChemicalApplication: checked }))} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm font-medium">Show materials, parts & supplies</label>
                  <p className="text-xs text-muted-foreground">Show this collection section in the Field App.</p>
                </div>
                <Switch checked={form.showMaterialsOrParts} onCheckedChange={checked => setForm(f => ({ ...f, showMaterialsOrParts: checked }))} />
              </div>
              <div className="space-y-2">
                <label htmlFor="invoice-date-basis" className="text-sm font-medium">Service date on invoices</label>
                <select id="invoice-date-basis" className="w-full rounded-md border bg-background p-2 text-sm" value={form.invoiceDateBasis} onChange={e => setForm(f => ({ ...f, invoiceDateBasis: e.target.value as ServiceForm['invoiceDateBasis'] }))}>
                  <option value="completed">Actual completion date (recommended)</option>
                  <option value="scheduled">Scheduled date</option>
                </select>
                <p className="text-xs text-muted-foreground">Applies when new invoices are created. Existing invoices and their issue dates do not change. Chemical logs always use the actual application time.</p>
              </div>
            </div>

            <Separator />

            {/* Pricing section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Pricing</p>
                <div className="flex border rounded-lg overflow-hidden text-xs">
                  {(['flat', 'hourly', 'per_sqft', 'per_linear_ft', 'area_and_linear', 'matrix'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`px-3 py-1.5 transition ${form.pricingMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                      onClick={() => setForm(f => ({ ...f, pricingMode: m }))}
                    >
                      {m === 'flat'
                        ? 'Flat rate'
                        : m === 'hourly'
                          ? 'Hourly / time'
                          : m === 'per_sqft'
                          ? 'Per sqft'
                          : m === 'per_linear_ft'
                            ? 'Per linear ft'
                            : m === 'area_and_linear'
                              ? 'Area + linear'
                              : 'Measurement matrix'}
                    </button>
                  ))}
                </div>
              </div>

              {form.pricingMode === 'hourly' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Hourly rate ($/hr)</label>
                    <Input type="number" min={0} step="0.01" title="Amount charged for each hour of crew time clocked on the job" placeholder="75.00" value={form.hourlyRate} onChange={e => setForm(f => ({ ...f, hourlyRate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Minimum hours (optional)</label>
                    <Input type="number" min={0} step="0.25" title="Shortest time to bill once the crew has clocked in. Leave blank to bill the exact time." placeholder="1" value={form.minimumBillableHours} onChange={e => setForm(f => ({ ...f, minimumBillableHours: e.target.value }))} />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">The invoice uses the crew timers on the job. One hour and 45 minutes bills as 1.75 hours. You can change the hours or the price on the invoice before sending it.</p>
                </div>
              ) : form.pricingMode !== 'matrix' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      {form.pricingMode === 'flat'
                        ? 'Base Price ($)'
                        : form.pricingMode === 'per_linear_ft'
                          ? 'Rate per linear ft ($)'
                          : 'Rate per sqft ($)'}
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      title={form.pricingMode === 'flat'
                        ? 'Base price charged for this service'
                        : form.pricingMode === 'per_sqft'
                          ? 'Amount charged for each square foot'
                          : 'Amount charged for each linear foot'}
                      placeholder="0.00"
                      value={form.basePrice}
                      onChange={e => setForm(f => ({ ...f, basePrice: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Est. Duration (min)</label>
                    <Input
                      type="number"
                      min={0}
                      title="Estimated duration for this service in minutes"
                      placeholder="e.g. 60"
                      value={form.estimatedDuration}
                      onChange={e => setForm(f => ({ ...f, estimatedDuration: e.target.value }))}
                    />
                  </div>
                  </div>
                  {form.pricingMode === 'area_and_linear' && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Rate per linear ft ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        title="Amount charged for each linear foot, added to the square-foot charge"
                        placeholder="0.00"
                        value={form.linearRate}
                        onChange={e => setForm(f => ({ ...f, linearRate: e.target.value }))}
                      />
                    </div>
                  )}
                  {form.pricingMode !== 'flat' && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Zone type</label>
                      <Select
                        value={form.linkedZoneTypeId || '__none__'}
                        onValueChange={v => setForm(f => ({ ...f, linkedZoneTypeId: v === '__none__' ? '' : v }))}
                      >
                        <SelectTrigger title="Choose the measurement zone used to calculate this service price">
                          <SelectValue placeholder="Select a measurement zone…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Any selected measurement zones</SelectItem>
                          {zoneTypes
                            .filter(zt => form.pricingMode === 'per_linear_ft'
                              ? zt.mode === 'linear' || zt.mode === 'both'
                              : form.pricingMode === 'area_and_linear'
                                ? true
                                : zt.mode !== 'linear')
                            .map(zt => (
                              <SelectItem key={zt.id} value={zt.id}>
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: zt.color }} />
                                  {zt.name}
                                </div>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {form.pricingMode === 'per_linear_ft'
                          ? 'The rate is multiplied by the saved perimeter of this zone type.'
                          : form.pricingMode === 'area_and_linear'
                            ? 'Square feet and linear feet from this zone are priced separately and added together.'
                            : 'The rate is multiplied by the saved area of this zone type.'}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Price rounding</label>
                    <Select value={form.matrixRounding} onValueChange={value => setForm(f => ({ ...f, matrixRounding: value as PriceRounding }))}>
                      <SelectTrigger title="How calculated matrix prices are rounded"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No rounding</SelectItem>
                        <SelectItem value="nearest_1">Round to nearest $1</SelectItem>
                        <SelectItem value="nearest_5">Round to nearest $5</SelectItem>
                        <SelectItem value="nearest_10">Round to nearest $10</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Matrix measures</label>
                    <Select value={form.matrixBasis} onValueChange={value => setForm(f => ({ ...f, matrixBasis: value as ServiceForm['matrixBasis'] }))}>
                      <SelectTrigger title="Choose whether matrix tiers use area, linear footage, or both"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="area">Area (sq ft)</SelectItem>
                        <SelectItem value="linear">Linear footage</SelectItem>
                        <SelectItem value="both">Area and linear footage</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Matrix tiers */}
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    {form.pricingMatrix.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">No tiers yet. Add Tier 1, then as many more as you need. The last tier covers anything above its minimum.</p>
                    )}
                    {form.pricingMatrix.map((tier, i) => (
                      <TierRow
                        key={tier._key}
                        tier={tier}
                        index={i}
                        isLast={i === form.pricingMatrix.length - 1}
                        basis={form.matrixBasis}
                        onChange={t => updateTier(i, t)}
                        onRemove={() => removeTier(i)}
                      />
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 text-xs mt-1"
                      onClick={addTier}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {form.pricingMatrix.length === 0 ? 'Add Tier 1' : `Add Tier ${form.pricingMatrix.length + 1}`}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Every tier except the last needs a maximum. The last tier is open-ended and prices anything above its minimum. A flat tier charges one amount. Price per unit above base charges that amount through the minimum, then the unit rate for each additional square foot or linear foot.
                  </p>

                  {/* Zone type linkage */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Zone type (optional)</label>
                    <Select
                      value={form.linkedZoneTypeId || '__none__'}
                      onValueChange={v => setForm(f => ({ ...f, linkedZoneTypeId: v === '__none__' ? '' : v }))}
                    >
                      <SelectTrigger title="Tie this service to a specific zone type so the area is auto-selected from satellite measurements">
                        <SelectValue placeholder="Auto-select from satellite zones…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None — staff selects zone manually</SelectItem>
                        {zoneTypes.map(zt => (
                          <SelectItem key={zt.id} value={zt.id}>
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: zt.color }} />
                              {zt.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      When linked, the area of this zone type is used automatically to look up the price when quoting or dispatching for a property.
                    </p>
                  </div>

                  {/* Still allow duration when matrix */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Est. Duration (min)</label>
                    <Input
                      type="number"
                      min={0}
                      title="Estimated duration for this service in minutes"
                      placeholder="e.g. 60"
                      value={form.estimatedDuration}
                      onChange={e => setForm(f => ({ ...f, estimatedDuration: e.target.value }))}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">P4P Payout Rate (%)</label>
              <Input
                type="number"
                step="0.1"
                title="P4P payout percentage for this service specifically — overrides the global rate when set"
                placeholder={`Leave blank to use global (${globalP4pRate}%)`}
                value={form.p4pPercentage}
                onChange={e => setForm(f => ({ ...f, p4pPercentage: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Override the global P4P rate for this specific service. Leave blank to inherit the global rate.
              </p>
            </div>

            <Separator />

            {/* Off-season section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Snowflake className="w-4 h-4 text-blue-500" />
                    Off Season
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Recurring jobs and plan visits will skip dates inside this window.
                  </p>
                </div>
                <Switch
                  title={form.offSeasonEnabled ? 'Off-season pause is on — click to disable' : 'Enable an annual date window when jobs for this service are skipped'}
                  checked={form.offSeasonEnabled}
                  onCheckedChange={v => setForm(f => ({ ...f, offSeasonEnabled: v }))}
                />
              </div>

              {form.offSeasonEnabled && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                  <MonthDayPicker
                    label="Off season starts"
                    month={form.offSeasonStartMonth}
                    day={form.offSeasonStartDay}
                    onMonthChange={v => setForm(f => ({ ...f, offSeasonStartMonth: v }))}
                    onDayChange={v => setForm(f => ({ ...f, offSeasonStartDay: v }))}
                  />
                  <MonthDayPicker
                    label="Off season ends (last off day)"
                    month={form.offSeasonEndMonth}
                    day={form.offSeasonEndDay}
                    onMonthChange={v => setForm(f => ({ ...f, offSeasonEndMonth: v }))}
                    onDayChange={v => setForm(f => ({ ...f, offSeasonEndDay: v }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    The window repeats every year. It can wrap across year-end (e.g. Nov 15 → Mar 14).
                  </p>
                </div>
              )}
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive services are hidden from scheduling.</p>
              </div>
              <Switch
                title={form.isActive ? 'Service is active — click to deactivate (hides from scheduling)' : 'Service is inactive — click to re-activate'}
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
              />
            </div>

            {sheetMode === 'edit' && selectedId ? (
              <PaymentPolicyCard scope="service" id={selectedId} canEdit={!!canManageOffice} />
            ) : (
              <p className="text-xs text-muted-foreground">Save this service first to set deposit and prepayment requirements.</p>
            )}

            <Separator />

            {sheetMode === 'edit' && selectedId && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive w-full gap-2"
                onClick={() => deleteMutation.mutate(selectedId)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-4 h-4" /> Delete Service
              </Button>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setSheetMode(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : sheetMode === 'create' ? 'Create Service' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
