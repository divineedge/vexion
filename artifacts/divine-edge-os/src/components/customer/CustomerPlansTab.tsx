import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListCustomerPlans, getListCustomerPlansQueryKey,
  useListPlanTemplates, getListPlanTemplatesQueryKey,
  usePreviewCustomerPlan, useCreateCustomerPlan,
  useListCrews, getListCrewsQueryKey,
  useListRouteTemplates, getListRouteTemplatesQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import type { PlanVisitSchedule } from '@workspace/api-client-react';
import { PlanVisitScheduleFields, spacingSummary, formatDateKey, addMonthsToKey, weekdayOfKey } from './PlanVisitScheduleFields';
import { PlanProgramFields, DEFAULT_PROGRAM, programToSchedule, programProblems, type ProgramConfig } from './PlanProgramFields';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/components/schedule/RescheduleFeeDialog';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CalendarClock, Plus, Repeat, MapPin, ChevronRight, Info, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDaysToKey = (key: string, days: number) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); };
const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };
type ScheduleMode = 'range' | 'interval';

interface Property { id: number; address: string; }

const CYCLE_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', custom: 'Custom' };
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-100 text-amber-700 border-amber-200',
  cancelled: 'bg-muted text-muted-foreground',
  pending_renewal: 'bg-blue-100 text-blue-700 border-blue-200',
};

interface PriceResolution {
  resolvedPrice: number;
  pricingMode: string;
  breakdown?: Array<{ serviceId: number; serviceName: string; areaSqft: number; price: number }>;
}

export default function CustomerPlansTab({ customerId, properties }: { customerId: number; properties: Property[] }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [sellOpen, setSellOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>('');
  const [propertyId, setPropertyId] = useState<string>(properties[0] ? String(properties[0].id) : '');
  const [startDate, setStartDate] = useState<string>(todayKey());
  const [mode, setMode] = useState<ScheduleMode>('range');
  const [sched, setSched] = useState<PlanVisitSchedule>({ firstServiceDate: todayKey(), lastServiceDate: addMonthsToKey(todayKey(), 12), totalVisits: 4, spacingUnit: 'weeks', preferredWeekday: weekdayOfKey(todayKey()) });
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [autoRenew, setAutoRenew] = useState(true);
  const [priceOverride, setPriceOverride] = useState<string>('');
  const [priceResolution, setPriceResolution] = useState<PriceResolution | null>(null);
  const [resolvingPrice, setResolvingPrice] = useState(false);
  const [program, setProgram] = useState<ProgramConfig>(DEFAULT_PROGRAM);
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [appliedOverride, setAppliedOverride] = useState('');
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  const { data: plans, isLoading } = useListCustomerPlans(
    { customerId },
    { query: { queryKey: getListCustomerPlansQueryKey({ customerId }) } },
  );
  const { data: templates } = useListPlanTemplates({ query: { queryKey: getListPlanTemplatesQueryKey() } });
  const activeTemplates = useMemo(() => (templates ?? []).filter(t => t.isActive), [templates]);
  const { data: crews } = useListCrews({ query: { queryKey: getListCrewsQueryKey(), enabled: sellOpen } });
  const { data: routeTemplates } = useListRouteTemplates(undefined, { query: { queryKey: getListRouteTemplatesQueryKey(), enabled: sellOpen } });
  // Tenant-wide plans (not customer-filtered) for "join an existing program".
  const { data: allPlans } = useListCustomerPlans(undefined, { query: { queryKey: getListCustomerPlansQueryKey(), enabled: sellOpen && program.alignEnabled } });
  const crewName = (id?: number | null) => (id == null ? null : (crews ?? []).find(c => c.id === id)?.name ?? `Crew #${id}`);

  const previewMutation = usePreviewCustomerPlan();
  const createMutation = useCreateCustomerPlan();

  const selectedTemplate = activeTemplates.find(t => String(t.id) === templateId);
  const templatePricingMode = (selectedTemplate as any)?.pricingMode ?? 'flat';

  // Auto-resolve price when template + property are selected and template is area-based
  useEffect(() => {
    if (!templateId || !propertyId) { setPriceResolution(null); return; }
    if (templatePricingMode === 'flat') {
      setPriceResolution(null);
      if (selectedTemplate) setPriceOverride(String(selectedTemplate.price));
      return;
    }

    let cancelled = false;
    setResolvingPrice(true);
    setPriceResolution(null);

    customFetch<PriceResolution>('/api/plan-templates/resolve-price', {
      method: 'POST',
      body: JSON.stringify({ templateId: Number(templateId), propertyId: Number(propertyId) }),
      headers: { 'Content-Type': 'application/json' },
    }).then(res => {
      if (cancelled) return;
      setPriceResolution(res);
      setPriceOverride(String(res.resolvedPrice.toFixed(2)));
    }).catch(() => {
      if (cancelled) return;
      // Fall back to flat price
      if (selectedTemplate) setPriceOverride(String(selectedTemplate.price));
    }).finally(() => {
      if (!cancelled) setResolvingPrice(false);
    });

    return () => { cancelled = true; };
  }, [templateId, propertyId, templatePricingMode]);

  // When template changes to flat, seed the price override from the template's flat price
  useEffect(() => {
    if (templatePricingMode === 'flat' && selectedTemplate) {
      setPriceOverride(String(selectedTemplate.price));
    }
  }, [templateId]);

  const templateServices = selectedTemplate?.services ?? [];
  const alignCandidates = useMemo(
    () => (allPlans ?? []).filter(p => String(p.templateId) === templateId && p.status === 'active'),
    [allPlans, templateId],
  );
  const baseSchedule: PlanVisitSchedule | undefined = mode === 'range'
    ? { ...sched, firstServiceDate: startDate, ...programToSchedule(program, templateServices, sched.totalVisits) }
    : undefined;
  const baseKey = JSON.stringify({ templateId, propertyId, startDate, visitSchedule: baseSchedule ?? null });
  const visitSchedule: PlanVisitSchedule | undefined = baseSchedule && appliedOverride
    ? { ...baseSchedule, capacityOverrideReason: appliedOverride }
    : baseSchedule;
  const requestKey = JSON.stringify({ base: baseKey, override: appliedOverride });
  const programProblem = mode === 'range' ? programProblems(program, sched.totalVisits) : null;
  const scheduleValid = mode === 'interval' || (visitSchedule != null && spacingSummary(visitSchedule) != null && visitSchedule.totalVisits <= 366 && !programProblem);
  const previewFresh = !!previewMutation.data && previewedKey === requestKey && !previewMutation.isPending && !previewMutation.isError;
  const previewWarnings = previewFresh ? (previewMutation.data?.capacityWarnings ?? []) : [];
  const overrideReady = previewWarnings.length === 0 || appliedOverride.length > 0;
  const canConfirm = previewFresh && overrideReady;

  // Any scheduling/template/property/program change invalidates the preview and any override
  useEffect(() => { previewMutation.reset(); setPreviewedKey(null); setAppliedOverride(''); setLastWarnings([]); setOverrideChecked(false); setOverrideReason(''); }, [baseKey]);

  // Seed count and default last date from the template when it changes
  useEffect(() => {
    if (!selectedTemplate) return;
    const customDays = selectedTemplate.billingCycle === 'custom' ? selectedTemplate.customCycleDays : null;
    const lastServiceDate = customDays && customDays > 0
      ? addDaysToKey(startDate, customDays)
      : addMonthsToKey(startDate, CYCLE_MONTHS[selectedTemplate.billingCycle] ?? 12);
    setSched(s => ({ ...s, totalVisits: Math.max(2, Math.min(366, selectedTemplate.visitCount ?? s.totalVisits)), lastServiceDate }));
  }, [templateId]);

  const openSell = () => {
    setTemplateId('');
    setPropertyId(properties[0] ? String(properties[0].id) : '');
    const t = todayKey(); setStartDate(t); setMode('range'); setPreviewedKey(null);
    setSched({ firstServiceDate: t, lastServiceDate: addMonthsToKey(t, 12), totalVisits: 4, spacingUnit: 'weeks', preferredWeekday: weekdayOfKey(t) });
    setAutoRenew(true);
    setPriceOverride('');
    setPriceResolution(null);
    setResolvingPrice(false);
    setProgram(DEFAULT_PROGRAM);
    setOverrideChecked(false); setOverrideReason(''); setAppliedOverride(''); setLastWarnings([]);
    previewMutation.reset();
    setSellOpen(true);
  };

  const runPreview = (override?: string) => {
    if (!templateId || !propertyId) { toast.error('Choose a plan template and property'); return; }
    if (programProblem) { toast.error(programProblem); return; }
    if (!scheduleValid) { toast.error('Fix the service date range first'); return; }
    const ov = override ?? appliedOverride;
    const vs = baseSchedule ? (ov ? { ...baseSchedule, capacityOverrideReason: ov } : baseSchedule) : undefined;
    const key = JSON.stringify({ base: baseKey, override: ov });
    previewMutation.mutate(
      { data: { templateId: Number(templateId), propertyId: Number(propertyId), startDate, ...(vs ? { visitSchedule: vs } : {}) } },
      { onSuccess: (res) => { setPreviewedKey(key); setLastWarnings(res.capacityWarnings ?? []); } },
    );
  };

  const applyOverride = () => {
    const reason = overrideReason.trim();
    if (!overrideChecked || !reason) return;
    setAppliedOverride(reason);
    runPreview(reason);
  };

  const confirmSale = () => {
    if (!templateId || !propertyId || !canConfirm) return;
    const preview = previewMutation.data;
    const finalPrice = parseFloat(priceOverride) || selectedTemplate?.price || 0;
    createMutation.mutate({
      data: {
        templateId: Number(templateId),
        customerId,
        propertyId: Number(propertyId),
        startDate,
        autoRenew,
        price: finalPrice,
        ...(visitSchedule ? { visitSchedule } : { visits: preview?.visits }),
      },
    }, {
      onSuccess: () => {
        toast.success('Plan sold and visits scheduled');
        qc.invalidateQueries({ queryKey: getListCustomerPlansQueryKey({ customerId }) });
        qc.invalidateQueries({ predicate: q => { const k = String(q.queryKey[0] ?? ''); return /jobs|schedule|plans|visits/.test(k); } });
        setSellOpen(false);
      },
      onError: (err) => toast.error(apiErrorMessage(err, 'Failed to sell plan')),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Recurring service plans sold to this customer, with automated visit scheduling and billing.</p>
        <Button size="sm" className="gap-2" title="Sell a service plan to this customer" onClick={openSell} disabled={properties.length === 0}>
          <Plus className="w-4 h-4" /> Sell a Plan
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading plans...</p>
      ) : (plans ?? []).length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          <Repeat className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No plans yet</p>
          <p className="text-sm mt-1">Sell this customer a recurring service plan to auto-schedule their visits.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {(plans ?? []).map(p => (
            <Card key={p.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => navigate(`/plans/${p.id}`)}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium" title={p.templateName}>{p.templateName}</p>
                    <Badge variant="outline" className={STATUS_STYLE[p.status] ?? ''} title={`Plan status: ${p.status.replace('_', ' ')}`}>{p.status.replace('_', ' ')}</Badge>
                    {p.autoRenew && <Badge variant="outline" className="text-xs">Auto-renew</Badge>}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1" title={p.propertyAddress ?? undefined}><MapPin className="w-3 h-3" />{p.propertyAddress}</span>
                    <span className="flex items-center gap-1" title={p.nextBillingDate ? `Next billing: ${p.nextBillingDate}` : 'No next billing date'}><CalendarClock className="w-3 h-3" />Next billing {p.nextBillingDate ?? '—'}</span>
                    <span title={`Billing: $${p.billingPrice.toFixed(2)} per ${CYCLE_LABEL[p.billingCycle]}`}>${p.billingPrice.toFixed(2)} / {CYCLE_LABEL[p.billingCycle]}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sell a Service Plan</DialogTitle>
            <DialogDescription>Preview the auto-generated visit schedule before activating the plan.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan Template</label>
              <Select value={templateId} onValueChange={v => { setTemplateId(v); previewMutation.reset(); }}>
                <SelectTrigger title="Select the service plan to sell to this customer"><SelectValue placeholder="Choose a plan" /></SelectTrigger>
                <SelectContent>
                  {activeTemplates.map(t => {
                    const pm = (t as any).pricingMode ?? 'flat';
                    return (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}{pm === 'flat' ? ` — $${t.price.toFixed(2)}/${CYCLE_LABEL[t.billingCycle]}` : ` — area-based/${CYCLE_LABEL[t.billingCycle]}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property</label>
              <Select value={propertyId} onValueChange={v => { setPropertyId(v); previewMutation.reset(); }}>
                <SelectTrigger title="Property where this plan's services will be performed"><SelectValue placeholder="Choose a property" /></SelectTrigger>
                <SelectContent>
                  {properties.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.address}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{mode === 'range' ? 'Start / First Service' : 'Start Date'}</label>
                <Input type="date" title="Date the plan becomes active and the first billing period begins" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Auto-Renew</label>
                <div className="flex items-center h-9">
                  <Switch title={autoRenew ? 'Auto-renew enabled — plan will renew automatically at the end of the period' : 'Auto-renew disabled — plan will expire at the end of the period'} checked={autoRenew} onCheckedChange={setAutoRenew} />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Visit Scheduling</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([['range', 'Evenly space between dates', 'Fixed first & last service, N total visits'], ['interval', 'Template interval', 'Legacy frequency from the plan template']] as const).map(([v, title, sub]) => (
                  <button key={v} type="button" data-testid={`button-mode-${v}`} onClick={() => setMode(v)}
                    className={`text-left rounded-md border px-3 py-2 transition-colors ${mode === v ? 'border-primary bg-primary/5' : 'hover:border-primary/40'}`}>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{sub}</p>
                  </button>
                ))}
              </div>
            </div>
            {mode === 'range' && (
              <>
                {program.alignEnabled ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground" data-testid="text-align-dates">
                    Visit dates come from the chosen plan's remaining rounds and continue its treatment sequence (it does not restart at treatment 1). One remaining round is enough. Preview to see the resolved dates and count.
                  </div>
                ) : (
                  <PlanVisitScheduleFields value={{ ...sched, firstServiceDate: startDate }} onChange={v => { setStartDate(v.firstServiceDate); setSched(v); }} />
                )}
                {templateId && (
                  <PlanProgramFields
                    value={program}
                    onChange={setProgram}
                    services={templateServices}
                    crews={crews ?? []}
                    routes={routeTemplates ?? []}
                    alignCandidates={alignCandidates}
                    totalVisits={sched.totalVisits}
                  />
                )}
                {programProblem && <p className="text-xs text-destructive" data-testid="text-program-problem">{programProblem}</p>}
              </>
            )}
            {mode === 'interval' && (
              <p className="text-xs text-muted-foreground">Crew, route, per-round services and reminders are set with the date-range option.</p>
            )}

            {/* Warning: area-based template selected but property has no satellite measurements */}
            {!resolvingPrice && priceResolution && priceResolution.pricingMode !== 'flat' && priceResolution.resolvedPrice === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <strong>No measurements found.</strong> This is an area-based plan but the selected property has no satellite measurements.
                  The auto-resolved price is <strong>$0</strong> — override the price below before activating, or add measurements on the property first.
                </span>
              </div>
            )}

            {/* Price field */}
            {templateId && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium">Price per {selectedTemplate ? CYCLE_LABEL[selectedTemplate.billingCycle] : 'Period'} ($)</label>
                  {resolvingPrice && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  {priceResolution && !resolvingPrice && priceResolution.pricingMode !== 'flat' && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3.5 h-3.5 text-violet-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs" side="top">
                          <p className="font-medium mb-1">
                            {priceResolution.pricingMode === 'sum_services' ? 'Resolved from service pricing' : 'Resolved from area matrix'}
                          </p>
                          {priceResolution.breakdown?.map(b => (
                            <p key={b.serviceId} className="text-muted-foreground">
                              {b.serviceName}: {b.areaSqft.toLocaleString()} sqft → ${b.price.toFixed(2)}
                            </p>
                          ))}
                          <p className="text-muted-foreground mt-1 italic">You can edit the price below to override.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <Input
                  type="number" step="0.01" min={0}
                  title="Override the calculated plan price for this customer — leave blank to use the auto-resolved price"
                  placeholder="0.00"
                  value={priceOverride}
                  onChange={e => setPriceOverride(e.target.value)}
                />
                {priceResolution && !resolvingPrice && priceResolution.pricingMode !== 'flat' && (
                  <p className="text-xs text-violet-600">
                    Auto-resolved from property area{priceResolution.pricingMode === 'sum_services' ? ' and service pricing' : ''}. Edit above to override.
                  </p>
                )}
              </div>
            )}

            <Button variant="outline" title="Preview the visit schedule this plan will generate before confirming" onClick={() => runPreview()} disabled={previewMutation.isPending || !templateId || !propertyId || !scheduleValid} className="w-full">
              {previewMutation.isPending ? 'Building preview...' : 'Preview Schedule'}
            </Button>

            {previewMutation.isError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" data-testid="text-preview-error">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{apiErrorMessage(previewMutation.error, 'Could not build the preview.')}</span>
              </div>
            )}

            {lastWarnings.length > 0 && !previewMutation.isPending && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" data-testid="panel-capacity-warnings">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="w-4 h-4" />Capacity warnings</p>
                <ul className="list-disc pl-5 text-xs space-y-0.5">
                  {lastWarnings.map((w, i) => <li key={i} data-testid={`text-capacity-warning-${i}`}>{w}</li>)}
                </ul>
                <p className="text-xs">Budgets count every other job on that crew and day plus travel buffer, not just this plan. Move the dates or pick another crew above, then preview again.</p>
                <div className="flex flex-wrap gap-2">
                  {mode === 'range' && !program.alignEnabled && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-white" data-testid="button-shift-week"
                      onClick={() => { const n = addDaysToKey(startDate, 7); const l = addDaysToKey(sched.lastServiceDate, 7); setStartDate(n); setSched(s => ({ ...s, firstServiceDate: n, lastServiceDate: l })); }}>
                      Shift all dates +1 week
                    </Button>
                  )}
                  {(crews ?? []).length > 1 && (
                    <Select value={program.crewId || 'none'} onValueChange={v => setProgram(p => ({ ...p, crewId: v === 'none' ? '' : v }))}>
                      <SelectTrigger className="h-7 w-48 text-xs bg-white" data-testid="select-warning-crew"><SelectValue placeholder="Try another crew" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No default crew</SelectItem>
                        {(crews ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {mode === 'range' && (
                  <div className="space-y-1.5 border-t border-amber-200 pt-2">
                    <label className="flex items-start gap-2 text-xs cursor-pointer">
                      <Checkbox checked={overrideChecked} onCheckedChange={v => setOverrideChecked(v === true)} className="mt-0.5 bg-white" data-testid="checkbox-plan-override" />
                      <span>Manager override: book these visits even though the crew is over capacity.</span>
                    </label>
                    <Textarea rows={2} className="bg-white text-xs" placeholder="Reason (required)" value={overrideReason} disabled={!overrideChecked}
                      onChange={e => setOverrideReason(e.target.value)} data-testid="input-plan-override-reason" />
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" className="h-7 text-xs" disabled={!overrideChecked || !overrideReason.trim() || previewMutation.isPending} onClick={applyOverride} data-testid="button-apply-override">
                        Apply override and re-preview
                      </Button>
                      {appliedOverride && <span className="text-xs">Override applied{appliedOverride !== overrideReason.trim() ? ' (reason edited, re-apply to use it)' : ''}.</span>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {previewMutation.data && previewFresh && (() => {
              const pv = previewMutation.data;
              const tz = pv.timeZone ?? null;
              const resolved = pv.visitSchedule;
              return (
                <>
                  <Separator />
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    <p className="text-sm font-medium" data-testid="text-preview-summary">
                      {pv.visits.length} visit(s) {mode === 'range'
                        ? resolved ? `from ${formatDateKey(resolved.firstServiceDate)} to ${formatDateKey(resolved.lastServiceDate)}${program.alignEnabled ? ` · ${resolved.totalVisits} remaining round(s), continuing the source plan's treatment sequence` : ''}` : `from ${formatDateKey(startDate)} to ${formatDateKey(sched.lastServiceDate)}`
                        : 'this period'}
                    </p>
                    {pv.visits.map((v, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-sm border rounded-md px-3 py-2" data-testid={`row-preview-visit-${i}`}>
                        <div className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            {v.roundNumber != null && <Badge variant="secondary" className="text-[10px] px-1.5">R{v.roundNumber}</Badge>}
                            <span className="truncate">{(v.serviceNames && v.serviceNames.length ? v.serviceNames : [v.serviceName]).join(' + ')}</span>
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {crewName(v.crewId) ?? 'No crew'}{v.estimatedDuration ? ` · ${v.estimatedDuration} min` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-muted-foreground">{formatDateKey(v.date, undefined, tz)}</span>
                          {v.clustered && <Badge variant="outline" className="text-xs">Clustered nearby</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {previewWarnings.length > 0 && !appliedOverride && (
                    <p className="text-xs text-amber-700" data-testid="text-confirm-blocked">Resolve the capacity warnings or apply a manager override to activate.</p>
                  )}
                </>
              );
            })()}
          </div>

          <DialogFooter>
            <Button variant="outline" title="Cancel and close the plan sale dialog" onClick={() => setSellOpen(false)}>Cancel</Button>
            <Button title="Confirm the plan sale and activate it for this customer" onClick={confirmSale} disabled={!canConfirm || createMutation.isPending}>
              {createMutation.isPending ? 'Activating...' : 'Confirm & Activate Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
