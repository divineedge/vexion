import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useListPlanTemplates, getListPlanTemplatesQueryKey,
  useCreatePlanTemplate, useUpdatePlanTemplate, useDeletePlanTemplate,
  customFetch,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Trash2, Repeat, Grid3X3, X, ChevronRight } from 'lucide-react';
import type { PricingTier } from '@/lib/pricingMatrix';

interface ServiceRuleForm { serviceId: string; serviceName: string; frequencyDays: string; }

const CYCLE_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', custom: 'Custom' };

type PricingMode = 'flat' | 'matrix' | 'sum_services';

// Plan-level tier: simpler than service tier (no perSqftRate)
interface PlanPricingTier {
  minSqft: number;
  maxSqft: number | null;
  price: number;
}

const EMPTY = {
  name: '', description: '', visitCount: '4', billingCycle: 'monthly', customCycleDays: '',
  price: '', autoRenewDefault: true, isActive: true,
  pricingMode: 'flat' as PricingMode,
  pricingMatrix: [] as PlanPricingTier[],
};

function TierRow({
  tier, index, isLast, onChange, onRemove,
}: {
  tier: PlanPricingTier; index: number; isLast: boolean;
  onChange: (t: PlanPricingTier) => void; onRemove: () => void;
}) {
  const isOpenEnded = tier.maxSqft === null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground w-5 text-right shrink-0">{index + 1}.</span>
      <Input
        type="number" min={0} placeholder="From sqft"
        value={index === 0 ? '0' : String(tier.minSqft || '')}
        readOnly={index === 0}
        onChange={e => onChange({ ...tier, minSqft: parseFloat(e.target.value) || 0 })}
        className={`w-28 text-sm ${index === 0 ? 'bg-muted/50 text-muted-foreground' : ''}`}
      />
      <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
      {isOpenEnded ? (
        <span className="w-28 text-xs text-muted-foreground px-2 italic">and above</span>
      ) : (
        <Input
          type="number" min={tier.minSqft + 1} placeholder="Up to sqft"
          value={tier.maxSqft != null ? String(tier.maxSqft) : ''}
          onChange={e => {
            const v = e.target.value;
            onChange({ ...tier, maxSqft: v === '' ? null : parseFloat(v) || 0 });
          }}
          className="w-28 text-sm"
        />
      )}
      <div className="flex items-center gap-1 flex-1">
        <span className="text-xs text-muted-foreground shrink-0">$</span>
        <Input
          type="number" min={0} step="0.01" placeholder="0.00"
          value={String(tier.price || '')}
          onChange={e => onChange({ ...tier, price: parseFloat(e.target.value) || 0 })}
          className="flex-1 text-sm"
        />
        <span className="text-xs text-muted-foreground shrink-0">/period</span>
      </div>
      {/* Only the last tier may be open-ended */}
      {isLast && (
        <button
          type="button"
          title={isOpenEnded ? 'Set upper bound' : 'Make open-ended (no upper limit)'}
          className={`text-xs px-2 py-1 rounded border transition shrink-0 ${isOpenEnded ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-muted text-muted-foreground hover:border-violet-300 hover:text-violet-700'}`}
          onClick={() => onChange({ ...tier, maxSqft: isOpenEnded ? (tier.minSqft + 5000) : null })}
        >
          {isOpenEnded ? '∞ on' : '∞'}
        </button>
      )}
      <Button
        type="button" variant="ghost" size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export default function PlanTemplatesSettings() {
  const qc = useQueryClient();
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [rules, setRules] = useState<ServiceRuleForm[]>([{ serviceId: '', serviceName: '', frequencyDays: '7' }]);

  const { data: templates, isLoading } = useListPlanTemplates({ query: { queryKey: getListPlanTemplatesQueryKey() } });
  const { data: services } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['services'],
    queryFn: () => customFetch('/api/services'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPlanTemplatesQueryKey() });
  const createMutation = useCreatePlanTemplate();
  const updateMutation = useUpdatePlanTemplate();
  const deleteMutation = useDeletePlanTemplate();

  const openCreate = () => {
    setForm(EMPTY);
    setRules([{ serviceId: '', serviceName: '', frequencyDays: '7' }]);
    setSelectedId(null);
    setSheetMode('create');
  };

  const openEdit = (t: NonNullable<typeof templates>[number]) => {
    const pm = (t as any).pricingMode as PricingMode ?? 'flat';
    const matrix = Array.isArray((t as any).pricingMatrix) ? (t as any).pricingMatrix as PlanPricingTier[] : [];
    setForm({
      name: t.name, description: t.description ?? '', visitCount: String(t.visitCount),
      billingCycle: t.billingCycle, customCycleDays: t.customCycleDays ? String(t.customCycleDays) : '',
      price: String(t.price), autoRenewDefault: t.autoRenewDefault, isActive: t.isActive,
      pricingMode: pm, pricingMatrix: matrix,
    });
    setRules((t.services as any[]).map(s => ({ serviceId: String(s.serviceId), serviceName: s.serviceName, frequencyDays: String(s.frequencyDays) })));
    setSelectedId(t.id);
    setSheetMode('edit');
  };

  const setRuleServiceId = (idx: number, serviceId: string) => {
    const svc = (services ?? []).find(s => String(s.id) === serviceId);
    setRules(rs => rs.map((r, i) => i === idx ? { ...r, serviceId, serviceName: svc?.name ?? r.serviceName } : r));
  };

  // Matrix tier helpers
  const addTier = () => {
    setForm(f => {
      const tiers = f.pricingMatrix;
      // Determine the lower bound for the new tier: previous tier's maxSqft + 1 (or 0 for first)
      const prevTier = tiers[tiers.length - 1];
      const newMin = tiers.length === 0 ? 0 : (prevTier.maxSqft != null ? prevTier.maxSqft + 1 : prevTier.minSqft + 5001);
      // Always create bounded tiers — open-ended is toggled via the ∞ button on the last row
      const newMax = newMin + 4999;
      // If current last tier is open-ended, seal it with a bounded maxSqft before adding
      let updatedTiers = tiers;
      if (prevTier && prevTier.maxSqft === null) {
        updatedTiers = tiers.map((t, i) => i === tiers.length - 1 ? { ...t, maxSqft: t.minSqft + 4999 } : t);
      }
      const newTier: PlanPricingTier = { minSqft: newMin, maxSqft: newMax, price: 0 };
      return { ...f, pricingMatrix: [...updatedTiers, newTier] };
    });
  };
  const updateTier = (i: number, t: PlanPricingTier) =>
    setForm(f => {
      const updated = f.pricingMatrix.map((r, idx) => idx === i ? t : r);
      // When a bounded tier's maxSqft changes, auto-update the next tier's minSqft
      if (t.maxSqft !== null && i + 1 < updated.length) {
        updated[i + 1] = { ...updated[i + 1], minSqft: t.maxSqft + 1 };
      }
      return { ...f, pricingMatrix: updated };
    });
  const removeTier = (i: number) =>
    setForm(f => {
      const remaining = f.pricingMatrix.filter((_, idx) => idx !== i);
      // Re-anchor minSqft for each tier after removal
      return {
        ...f,
        pricingMatrix: remaining.map((t, idx) => {
          if (idx === 0) return { ...t, minSqft: 0 };
          const prev = remaining[idx - 1];
          return prev.maxSqft != null ? { ...t, minSqft: prev.maxSqft + 1 } : t;
        }),
      };
    });

  const handleSave = () => {
    const validRules = rules.filter(r => r.serviceId && r.frequencyDays);
    if (!form.name || validRules.length === 0) { toast.error('Name and at least one service rule are required'); return; }
    if (form.pricingMode === 'matrix' && form.pricingMatrix.length === 0) {
      toast.error('Add at least one pricing tier, or switch pricing mode');
      return;
    }

    const payload = {
      name: form.name,
      description: form.description || undefined,
      services: validRules.map(r => ({ serviceId: Number(r.serviceId), serviceName: r.serviceName, frequencyDays: Number(r.frequencyDays) })),
      visitCount: Number(form.visitCount) || validRules.length,
      billingCycle: form.billingCycle as 'monthly' | 'quarterly' | 'annual' | 'custom',
      customCycleDays: form.billingCycle === 'custom' ? Number(form.customCycleDays) || 30 : undefined,
      price: Number(form.price) || 0,
      autoRenewDefault: form.autoRenewDefault,
      isActive: form.isActive,
      pricingMode: form.pricingMode,
      pricingMatrix: form.pricingMode === 'matrix' ? form.pricingMatrix : undefined,
    };

    if (sheetMode === 'create') {
      createMutation.mutate({ data: payload as any }, {
        onSuccess: () => { toast.success('Plan template created'); invalidate(); setSheetMode(null); },
        onError: () => toast.error('Failed to create plan template'),
      });
    } else if (sheetMode === 'edit' && selectedId) {
      updateMutation.mutate({ id: selectedId, data: payload as any }, {
        onSuccess: () => { toast.success('Plan template updated'); invalidate(); setSheetMode(null); },
        onError: () => toast.error('Failed to update plan template'),
      });
    }
  };

  const handleDelete = () => {
    if (!selectedId) return;
    deleteMutation.mutate({ id: selectedId }, {
      onSuccess: () => { toast.success('Plan template deleted'); invalidate(); setSheetMode(null); },
      onError: (err: any) => toast.error(err?.data?.error ?? 'Failed to delete plan template'),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Plan Templates</h3>
          <p className="text-sm text-muted-foreground">Define sellable recurring service plans — the services included, how often each runs, and the price.</p>
        </div>
        <Button size="sm" className="gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> Add Plan Template</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Services</TableHead>
                <TableHead className="text-right">Visits/Period</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : (templates ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  <Repeat className="w-8 h-8 mx-auto mb-2 opacity-30" />No plan templates yet.
                </TableCell></TableRow>
              ) : (templates ?? []).map(t => {
                const pm = (t as any).pricingMode as string ?? 'flat';
                return (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(t)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.name}</span>
                        {pm !== 'flat' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 text-violet-600 border-violet-300 bg-violet-50">
                            <Grid3X3 className="w-2.5 h-2.5" />
                            {pm === 'sum_services' ? 'sum of services' : 'matrix'}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{(t.services as any[]).map(s => s.serviceName).join(', ')}</TableCell>
                    <TableCell className="text-right">{t.visitCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      {pm === 'flat'
                        ? `$${t.price.toFixed(2)} / ${CYCLE_LABEL[t.billingCycle]}`
                        : <span className="text-violet-600 text-xs font-medium">area-based / {CYCLE_LABEL[t.billingCycle]}</span>
                      }
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={t.isActive ? 'default' : 'secondary'} className={t.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : ''}>
                        {t.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={sheetMode !== null} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>{sheetMode === 'create' ? 'Add Plan Template' : 'Edit Plan Template'}</SheetTitle>
            <SheetDescription>Configure the services, cadence, and price for this plan.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan Name <span className="text-destructive">*</span></label>
              <Input placeholder="e.g. 12-Visit Lawn Program" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <Separator />
            <label className="text-sm font-medium">Included Services</label>
            {rules.map((r, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Select value={r.serviceId} onValueChange={v => setRuleServiceId(idx, v)}>
                    <SelectTrigger><SelectValue placeholder="Service" /></SelectTrigger>
                    <SelectContent>
                      {(services ?? []).map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-28 space-y-1">
                  <Input type="number" min={1} placeholder="Days" value={r.frequencyDays}
                    onChange={e => setRules(rs => rs.map((rr, i) => i === idx ? { ...rr, frequencyDays: e.target.value } : rr))} />
                </div>
                <Button variant="ghost" size="icon" onClick={() => setRules(rs => rs.filter((_, i) => i !== idx))} disabled={rules.length === 1}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setRules(rs => [...rs, { serviceId: '', serviceName: '', frequencyDays: '7' }])}>
              <Plus className="w-3.5 h-3.5" /> Add Service Rule
            </Button>
            <p className="text-xs text-muted-foreground">Frequency is days between visits of that service (e.g. 7 = weekly, 42 = every 6 weeks).</p>

            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Visits per Period</label>
                <Input type="number" min={1} value={form.visitCount} onChange={e => setForm(f => ({ ...f, visitCount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Billing Cycle</label>
                <Select value={form.billingCycle} onValueChange={v => setForm(f => ({ ...f, billingCycle: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.billingCycle === 'custom' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Cycle Length (days)</label>
                <Input type="number" min={1} value={form.customCycleDays} onChange={e => setForm(f => ({ ...f, customCycleDays: e.target.value }))} />
              </div>
            )}

            <Separator />
            {/* Pricing section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Pricing</p>
                <div className="flex border rounded-lg overflow-hidden text-xs">
                  {(['flat', 'matrix', 'sum_services'] as PricingMode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`px-3 py-1.5 transition capitalize ${form.pricingMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                      onClick={() => setForm(f => ({ ...f, pricingMode: m }))}
                    >
                      {m === 'flat' ? 'Flat rate' : m === 'matrix' ? 'Area matrix' : 'Sum of services'}
                    </button>
                  ))}
                </div>
              </div>

              {form.pricingMode === 'flat' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Price ($)</label>
                  <Input type="number" step="0.01" placeholder="0.00" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
                </div>
              )}

              {form.pricingMode === 'matrix' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Define sqft brackets. When selling this plan, the property's total serviceable area selects the matching tier.
                  </p>
                  {form.pricingMatrix.map((tier, i) => (
                    <TierRow
                      key={i} tier={tier} index={i}
                      isLast={i === form.pricingMatrix.length - 1}
                      onChange={t => updateTier(i, t)}
                      onRemove={() => removeTier(i)}
                    />
                  ))}
                  <Button type="button" variant="outline" size="sm" className="gap-1 mt-1" onClick={addTier}>
                    <Plus className="w-3.5 h-3.5" /> Add Tier
                  </Button>
                  <div className="space-y-1.5 pt-1">
                    <label className="text-sm font-medium">Fallback / Default Price ($)</label>
                    <p className="text-xs text-muted-foreground">Used when no tier matches (e.g. property has no area measurement yet).</p>
                    <Input type="number" step="0.01" placeholder="0.00" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
                  </div>
                </div>
              )}

              {form.pricingMode === 'sum_services' && (
                <div className="space-y-2">
                  <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Auto-resolve from service pricing</p>
                    <p>
                      When selling this plan, the system looks up each included service's own area-based pricing
                      and sums the resolved prices for the property's measurement zones. Staff can still override
                      the final price before confirming.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Fallback / Default Price ($)</label>
                    <p className="text-xs text-muted-foreground">Used when zone areas can't be resolved.</p>
                    <Input type="number" step="0.01" placeholder="0.00" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
                  </div>
                </div>
              )}
            </div>

            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-Renew by Default</p>
                <p className="text-xs text-muted-foreground">Plans sold from this template default to auto-renew (can be overridden per customer).</p>
              </div>
              <Switch checked={form.autoRenewDefault} onCheckedChange={v => setForm(f => ({ ...f, autoRenewDefault: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive templates can't be sold to new customers.</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
            </div>

            <Separator />
            {sheetMode === 'edit' && selectedId && (
              <Button variant="ghost" className="text-destructive hover:text-destructive w-full gap-2" onClick={handleDelete} disabled={deleteMutation.isPending}>
                <Trash2 className="w-4 h-4" /> Delete Plan Template
              </Button>
            )}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setSheetMode(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : sheetMode === 'create' ? 'Create Template' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
