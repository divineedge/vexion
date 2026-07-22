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
import { Search, Plus, Briefcase, DollarSign, Clock, Edit, Trash2, TrendingUp, Grid3X3, X, ChevronRight } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import type { PricingTier } from '@/lib/pricingMatrix';

interface ZoneType {
  id: string;
  name: string;
  color: string;
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
  pricingMode: 'flat' | 'matrix';
  pricingMatrix: PricingTier[];
  linkedZoneTypeId: string;
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
  pricingMatrix: [],
  linkedZoneTypeId: '',
};

const EMPTY_TIER: PricingTier = { minSqft: 0, maxSqft: null, price: 0 };

function TierRow({
  tier,
  index,
  isLast,
  onChange,
  onRemove,
}: {
  tier: PricingTier;
  index: number;
  isLast: boolean;
  onChange: (t: PricingTier) => void;
  onRemove: () => void;
}) {
  const isOpenEnded = tier.maxSqft === null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground w-5 text-right shrink-0">{index + 1}.</span>
      <Input
        type="number"
        min={0}
        placeholder="From sqft"
        value={tier.minSqft === 0 && index === 0 ? '0' : String(tier.minSqft || '')}
        onChange={e => onChange({ ...tier, minSqft: parseFloat(e.target.value) || 0 })}
        className="w-28 text-sm"
      />
      <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
      {isOpenEnded ? (
        <span className="w-28 text-xs text-muted-foreground px-2">any area above</span>
      ) : (
        <Input
          type="number"
          min={0}
          placeholder="Up to sqft"
          value={tier.maxSqft != null ? String(tier.maxSqft) : ''}
          onChange={e => {
            const v = e.target.value;
            onChange({ ...tier, maxSqft: v === '' ? null : parseFloat(v) || 0 });
          }}
          className="w-28 text-sm"
        />
      )}
      {isOpenEnded ? (
        <div className="flex items-center gap-1 flex-1">
          <span className="text-xs text-muted-foreground shrink-0">$/sqft</span>
          <Input
            type="number"
            min={0}
            step="0.001"
            placeholder="0.000"
            value={tier.perSqftRate != null ? String(tier.perSqftRate) : ''}
            onChange={e => onChange({ ...tier, perSqftRate: parseFloat(e.target.value) || undefined })}
            className="flex-1 text-sm"
          />
          <span className="text-xs text-muted-foreground shrink-0">or flat $</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            value={String(tier.price || '')}
            onChange={e => onChange({ ...tier, price: parseFloat(e.target.value) || 0 })}
            className="flex-1 text-sm"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1 flex-1">
          <span className="text-xs text-muted-foreground shrink-0">$</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            value={String(tier.price || '')}
            onChange={e => onChange({ ...tier, price: parseFloat(e.target.value) || 0 })}
            className="flex-1 text-sm"
          />
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <X className="w-3.5 h-3.5" />
      </Button>
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
  const globalP4pRate = (settings as any)?.p4pMasterPercentage ?? 0;
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
    setForm({
      name: s.name,
      description: s.description ?? '',
      category: s.category ?? '',
      basePrice: String(s.basePrice),
      estimatedDuration: s.estimatedDuration != null ? String(s.estimatedDuration) : '',
      p4pPercentage: s.p4pPercentage != null ? String(s.p4pPercentage) : '',
      isActive: s.isActive,
      pricingMode: s.pricingMode === 'matrix' ? 'matrix' : 'flat',
      pricingMatrix: Array.isArray(s.pricingMatrix) ? s.pricingMatrix : [],
      linkedZoneTypeId: s.linkedZoneTypeId ?? '',
    });
    setSelectedId(s.id);
    setSheetMode('edit');
  };

  const handleSave = () => {
    if (!form.name) { toast.error('Service name is required'); return; }
    if (form.pricingMode === 'matrix' && form.pricingMatrix.length === 0) {
      toast.error('Add at least one pricing tier, or switch to Flat rate');
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name,
      description: form.description,
      category: form.category,
      basePrice: form.basePrice,
      estimatedDuration: form.estimatedDuration,
      p4pPercentage: form.p4pPercentage,
      isActive: form.isActive,
      pricingMode: form.pricingMode,
      pricingMatrix: form.pricingMode === 'matrix' ? form.pricingMatrix : null,
      linkedZoneTypeId: form.linkedZoneTypeId || null,
    };

    if (sheetMode === 'create') {
      createMutation.mutate(payload);
    } else if (sheetMode === 'edit' && selectedId) {
      updateMutation.mutate({ id: selectedId, data: payload });
    }
  };

  // Matrix tier helpers
  const addTier = () => {
    const tiers = form.pricingMatrix;
    const lastBounded = tiers.filter(t => t.maxSqft !== null);
    const lastMax = lastBounded.length > 0 ? (lastBounded[lastBounded.length - 1].maxSqft ?? 0) : 0;
    // If there's already an open-ended tier, insert before it
    const hasOpen = tiers.some(t => t.maxSqft === null);
    const newTier: PricingTier = { minSqft: lastMax + 1, maxSqft: hasOpen ? lastMax + 1000 : null, price: 0 };
    setForm(f => ({ ...f, pricingMatrix: [...f.pricingMatrix, newTier] }));
  };

  const updateTier = (i: number, t: PricingTier) =>
    setForm(f => ({ ...f, pricingMatrix: f.pricingMatrix.map((r, idx) => idx === i ? t : r) }));

  const removeTier = (i: number) =>
    setForm(f => ({ ...f, pricingMatrix: f.pricingMatrix.filter((_, idx) => idx !== i) }));

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
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Service
          </Button>
        )}
      </div>

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
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-3xl font-bold">{globalP4pRate}%</p>
              <p className="text-sm text-muted-foreground">Global P4P Rate</p>
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
                <TableHead className="text-center">Status</TableHead>
                {canManageOffice && <TableHead className="w-[60px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading services...</TableCell></TableRow>
              ) : (services ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
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
                        <span className="font-medium">{s.name}</span>
                        {s.pricingMode === 'matrix' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-violet-600 border-violet-300 bg-violet-50">
                            <Grid3X3 className="w-2.5 h-2.5" /> matrix
                          </Badge>
                        )}
                      </div>
                      {s.description && <div className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{s.description}</div>}
                    </TableCell>
                    <TableCell>
                      {s.category ? <Badge variant="outline">{s.category}</Badge> : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {s.pricingMode === 'matrix' ? (
                        <span className="text-xs text-violet-600 font-medium">
                          {Array.isArray(s.pricingMatrix) ? `${s.pricingMatrix.length} tier${s.pricingMatrix.length !== 1 ? 's' : ''}` : 'matrix'}
                        </span>
                      ) : (
                        `$${s.basePrice.toFixed(2)}`
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {s.estimatedDuration != null ? (
                        <span className="flex items-center justify-end gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {s.estimatedDuration >= 60
                            ? `${Math.floor(s.estimatedDuration / 60)}h ${s.estimatedDuration % 60 > 0 ? `${s.estimatedDuration % 60}m` : ''}`
                            : `${s.estimatedDuration}m`}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.p4pPercentage != null ? (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                          {s.p4pPercentage}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Global ({globalP4pRate}%)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={s.isActive ? 'default' : 'secondary'} className={s.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : ''}>
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
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
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
                placeholder="e.g. Full Lawn Service"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Input
                placeholder="e.g. Landscaping, Irrigation"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="What does this service include?"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <Separator />

            {/* Pricing section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Pricing</p>
                <div className="flex border rounded-lg overflow-hidden text-xs">
                  {(['flat', 'matrix'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`px-3 py-1.5 transition capitalize ${form.pricingMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                      onClick={() => setForm(f => ({ ...f, pricingMode: m }))}
                    >
                      {m === 'flat' ? 'Flat rate' : 'Area-based matrix'}
                    </button>
                  ))}
                </div>
              </div>

              {form.pricingMode === 'flat' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Base Price ($)</label>
                    <Input
                      type="number"
                      step="0.01"
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
                      placeholder="e.g. 60"
                      value={form.estimatedDuration}
                      onChange={e => setForm(f => ({ ...f, estimatedDuration: e.target.value }))}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Matrix tiers */}
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium pb-1 border-b">
                      <span className="w-5" />
                      <span className="w-28">From (sqft)</span>
                      <span className="w-4" />
                      <span className="w-28">Up to (sqft)</span>
                      <span className="flex-1">Price</span>
                    </div>
                    {form.pricingMatrix.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">No tiers yet — click "Add tier" below</p>
                    )}
                    {form.pricingMatrix.map((tier, i) => (
                      <TierRow
                        key={i}
                        tier={tier}
                        index={i}
                        isLast={i === form.pricingMatrix.length - 1}
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
                      {form.pricingMatrix.some(t => t.maxSqft === null)
                        ? 'Add another bounded tier'
                        : form.pricingMatrix.length === 0
                          ? 'Add first tier'
                          : 'Add open-ended tier (any area above X sqft)'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Each tier covers a sqft range. The last tier can be left open-ended (no upper bound) — enter a per-sqft rate or a flat price for that tier.
                  </p>

                  {/* Zone type linkage */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Zone type (optional)</label>
                    <Select
                      value={form.linkedZoneTypeId || '__none__'}
                      onValueChange={v => setForm(f => ({ ...f, linkedZoneTypeId: v === '__none__' ? '' : v }))}
                    >
                      <SelectTrigger>
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
                placeholder={`Leave blank to use global (${globalP4pRate}%)`}
                value={form.p4pPercentage}
                onChange={e => setForm(f => ({ ...f, p4pPercentage: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Override the global P4P rate for this specific service. Leave blank to inherit the global rate.
              </p>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive services are hidden from scheduling.</p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
              />
            </div>

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
