import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListCustomerPlans, getListCustomerPlansQueryKey,
  useListPlanTemplates, getListPlanTemplatesQueryKey,
  usePreviewCustomerPlan, useCreateCustomerPlan,
  customFetch,
} from '@workspace/api-client-react';
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
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [autoRenew, setAutoRenew] = useState(true);
  const [priceOverride, setPriceOverride] = useState<string>('');
  const [priceResolution, setPriceResolution] = useState<PriceResolution | null>(null);
  const [resolvingPrice, setResolvingPrice] = useState(false);

  const { data: plans, isLoading } = useListCustomerPlans(
    { customerId },
    { query: { queryKey: getListCustomerPlansQueryKey({ customerId }) } },
  );
  const { data: templates } = useListPlanTemplates({ query: { queryKey: getListPlanTemplatesQueryKey() } });
  const activeTemplates = useMemo(() => (templates ?? []).filter(t => t.isActive), [templates]);

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

  const openSell = () => {
    setTemplateId('');
    setPropertyId(properties[0] ? String(properties[0].id) : '');
    setStartDate(new Date().toISOString().slice(0, 10));
    setAutoRenew(true);
    setPriceOverride('');
    setPriceResolution(null);
    setResolvingPrice(false);
    previewMutation.reset();
    setSellOpen(true);
  };

  const runPreview = () => {
    if (!templateId || !propertyId) { toast.error('Choose a plan template and property'); return; }
    previewMutation.mutate({ data: { templateId: Number(templateId), propertyId: Number(propertyId), startDate } });
  };

  const confirmSale = () => {
    if (!templateId || !propertyId) return;
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
        visits: preview?.visits,
      },
    }, {
      onSuccess: () => {
        toast.success('Plan sold and visits scheduled');
        qc.invalidateQueries({ queryKey: getListCustomerPlansQueryKey({ customerId }) });
        setSellOpen(false);
      },
      onError: () => toast.error('Failed to sell plan'),
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
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
                <label className="text-sm font-medium">Start Date</label>
                <Input type="date" title="Date the plan becomes active and the first billing period begins" value={startDate} onChange={e => { setStartDate(e.target.value); previewMutation.reset(); }} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Auto-Renew</label>
                <div className="flex items-center h-9">
                  <Switch title={autoRenew ? 'Auto-renew enabled — plan will renew automatically at the end of the period' : 'Auto-renew disabled — plan will expire at the end of the period'} checked={autoRenew} onCheckedChange={setAutoRenew} />
                </div>
              </div>
            </div>

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

            <Button variant="outline" title="Preview the visit schedule this plan will generate before confirming" onClick={runPreview} disabled={previewMutation.isPending || !templateId || !propertyId} className="w-full">
              {previewMutation.isPending ? 'Building preview...' : 'Preview Schedule'}
            </Button>

            {previewMutation.data && (
              <>
                <Separator />
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  <p className="text-sm font-medium">{previewMutation.data.visits.length} visit(s) this period</p>
                  {previewMutation.data.visits.map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                      <span>{v.serviceName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{new Date(v.date).toLocaleDateString()}</span>
                        {v.clustered && <Badge variant="outline" className="text-xs">Clustered nearby</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" title="Cancel and close the plan sale dialog" onClick={() => setSellOpen(false)}>Cancel</Button>
            <Button title="Confirm the plan sale and activate it for this customer" onClick={confirmSale} disabled={!previewMutation.data || createMutation.isPending}>
              {createMutation.isPending ? 'Activating...' : 'Confirm & Activate Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
