/**
 * QuickQuotePanel — shown as a panel on the property detail page.
 * Lets staff select a service (optionally bundled with a second) or a plan template,
 * calculate a price, and generate an instant-quote link or save a draft estimate.
 */
import React, { useState, useEffect } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { DollarSign, Copy, ExternalLink, CheckCircle2, Calculator, Ruler, Grid3X3, Package, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { resolveServicePrice, type PricingTier } from '@/lib/pricingMatrix';

export interface MeasurementZone {
  id: string;
  label: string;
  areaSqft: number;
  enabled: boolean;
  color: string;
}

interface ZoneType {
  id: string;
  name: string;
  color: string;
}

interface Service {
  id: number;
  name: string;
  description: string | null;
  basePrice: number;
  category: string | null;
  pricingMode?: string;
  pricingMatrix?: PricingTier[] | null;
  linkedZoneTypeId?: string | null;
}

interface PlanTemplate {
  id: number;
  name: string;
  price: number;
  billingCycle: string;
  description: string | null;
  pricingMode: string;
  pricingMatrix?: Array<{ minSqft: number; maxSqft: number | null; price: number }> | null;
}

interface QuickQuotePanelProps {
  propertyId: number;
  customerId?: number;
  zones: MeasurementZone[];
  preferredAreaUnit?: 'sqft' | 'acres';
  /** Tenant zone types so we can resolve linkedZoneTypeId → zone label */
  zoneTypes?: ZoneType[];
  /** Total serviceable area (sqft) used for matrix plan pricing */
  totalServiceableAreaSqft?: number;
}

type QuoteMode = 'service' | 'plan';

function formatArea(sqft: number, unit: 'sqft' | 'acres'): string {
  if (unit === 'acres') return `${(sqft / 43560).toFixed(3)} ac`;
  return `${sqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft`;
}

export default function QuickQuotePanel({
  propertyId, customerId, zones, preferredAreaUnit = 'sqft', zoneTypes = [], totalServiceableAreaSqft,
}: QuickQuotePanelProps) {
  const [mode, setMode] = useState<QuoteMode>('service');

  // --- Service mode state ---
  const [services, setServices] = useState<Service[] | null>(null);
  const [loadingServices, setLoadingServices] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [secondaryServiceId, setSecondaryServiceId] = useState<string>('');
  const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set(zones.filter(z => z.enabled).map(z => z.id)));
  const [priceType, setPriceType] = useState<'flat' | 'per_sqft'>('flat');
  const [overridePrice, setOverridePrice] = useState('');

  // --- Plan mode state ---
  const [planTemplates, setPlanTemplates] = useState<PlanTemplate[] | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [planOverridePrice, setPlanOverridePrice] = useState('');

  // --- Shared ---
  const [generatedQuote, setGeneratedQuote] = useState<{ token: string; price: number } | null>(null);
  const [creating, setCreating] = useState(false);

  // Load services lazily
  const loadServices = async () => {
    if (services !== null) return;
    setLoadingServices(true);
    try {
      const data = await customFetch<Service[]>('/api/services?activeOnly=true');
      setServices(data);
    } catch {
      toast.error('Failed to load services');
      setServices([]);
    } finally {
      setLoadingServices(false);
    }
  };

  // Load plan templates lazily
  const loadPlans = async () => {
    if (planTemplates !== null) return;
    setLoadingPlans(true);
    try {
      const data = await customFetch<PlanTemplate[]>('/api/plan-templates');
      setPlanTemplates((data as any[]).filter(p => p.isActive !== false));
    } catch {
      toast.error('Failed to load plans');
      setPlanTemplates([]);
    } finally {
      setLoadingPlans(false);
    }
  };

  // Reset generated quote when switching modes or selections
  useEffect(() => { setGeneratedQuote(null); setOverridePrice(''); setPlanOverridePrice(''); }, [mode]);
  useEffect(() => { setGeneratedQuote(null); setSecondaryServiceId(''); setOverridePrice(''); }, [selectedServiceId]);
  useEffect(() => { setGeneratedQuote(null); }, [secondaryServiceId, selectedPlanId]);

  const selectedService = services?.find(s => String(s.id) === selectedServiceId);
  const secondaryService = services?.find(s => String(s.id) === secondaryServiceId);
  const selectedPlan = planTemplates?.find(p => String(p.id) === selectedPlanId);

  // When primary service changes, auto-select zones linked to its linkedZoneTypeId
  useEffect(() => {
    if (!selectedService) return;
    const linkedId = selectedService.linkedZoneTypeId;
    if (!linkedId || zones.length === 0) return;
    const zoneType = zoneTypes.find(zt => zt.id === linkedId);
    if (!zoneType) return;
    const matchingZones = zones.filter(z => z.label === zoneType.name);
    if (matchingZones.length === 0) return;
    setSelectedZones(new Set(matchingZones.map(z => z.id)));
  }, [selectedService?.linkedZoneTypeId, zones, zoneTypes]);

  const selectedZoneList = zones.filter(z => selectedZones.has(z.id));
  const totalAreaSqft = selectedZoneList.reduce((s, z) => s + z.areaSqft, 0);
  const linkedZoneTypeName = selectedService?.linkedZoneTypeId
    ? zoneTypes.find(zt => zt.id === selectedService.linkedZoneTypeId)?.name
    : null;
  const isMatrixService = selectedService?.pricingMode === 'matrix';

  // Calculated price for service mode
  const serviceCalculatedPrice = (() => {
    if (overridePrice) return parseFloat(overridePrice) || 0;
    if (!selectedService) return 0;
    let price1 = 0;
    if (isMatrixService && selectedService.pricingMatrix) {
      price1 = resolveServicePrice('matrix', selectedService.basePrice, selectedService.pricingMatrix, totalAreaSqft > 0 ? totalAreaSqft : null);
    } else if (priceType === 'per_sqft' && totalAreaSqft > 0) {
      price1 = selectedService.basePrice * totalAreaSqft;
    } else {
      price1 = selectedService.basePrice;
    }
    // Add secondary service flat price (bundled services always use flat base price)
    const price2 = secondaryService ? secondaryService.basePrice : 0;
    return price1 + price2;
  })();

  // Calculated price for plan mode
  const planCalculatedPrice = (() => {
    if (planOverridePrice) return parseFloat(planOverridePrice) || 0;
    if (!selectedPlan) return 0;
    if (selectedPlan.pricingMode === 'matrix' && selectedPlan.pricingMatrix) {
      const area = totalServiceableAreaSqft ?? totalAreaSqft;
      const match = selectedPlan.pricingMatrix.find(
        t => area >= t.minSqft && (t.maxSqft === null || area <= t.maxSqft),
      );
      return match?.price ?? selectedPlan.price;
    }
    return selectedPlan.price;
  })();

  const calculatedPrice = mode === 'plan' ? planCalculatedPrice : serviceCalculatedPrice;

  const toggleZone = (id: string) => {
    setSelectedZones(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createQuote = async () => {
    if (mode === 'service' && !selectedServiceId && !overridePrice) {
      toast.error('Select a service or enter a custom price');
      return;
    }
    if (mode === 'plan' && !selectedPlanId && !planOverridePrice) {
      toast.error('Select a plan or enter a custom price');
      return;
    }
    setCreating(true);
    try {
      let payload: Record<string, unknown>;
      if (mode === 'plan') {
        payload = {
          selectedZoneLabels: [],
          totalAreaSqft: null,
          priceType: 'flat',
          calculatedPrice: planCalculatedPrice,
          serviceName: selectedPlan?.name ?? 'Service Plan',
          planTemplateId: selectedPlanId ? parseInt(selectedPlanId, 10) : undefined,
        };
      } else {
        const nameParts = [selectedService?.name ?? 'Custom Quote'];
        if (secondaryService) nameParts.push(secondaryService.name);
        payload = {
          selectedZoneLabels: selectedZoneList.map(z => z.label),
          totalAreaSqft: totalAreaSqft || null,
          priceType: isMatrixService ? 'matrix' : priceType,
          calculatedPrice: serviceCalculatedPrice,
          serviceName: nameParts.join(' + '),
          ...(selectedServiceId ? { serviceId: parseInt(selectedServiceId, 10) } : {}),
          ...(secondaryServiceId ? { secondaryServiceId: parseInt(secondaryServiceId, 10) } : {}),
        };
      }

      const quote = await customFetch<{ token: string; calculatedPrice: number }>(`/api/properties/${propertyId}/quotes`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setGeneratedQuote({ token: quote.token, price: quote.calculatedPrice });
    } catch {
      toast.error('Failed to create quote');
    } finally {
      setCreating(false);
    }
  };

  const saveAsEstimate = async () => {
    if (!customerId) return;
    try {
      let lineItems: unknown[];
      if (mode === 'plan' && selectedPlan) {
        lineItems = [{
          description: selectedPlan.name + (selectedPlan.description ? ` — ${selectedPlan.description}` : ''),
          qty: 1,
          unitPrice: planCalculatedPrice,
          markup: 0,
          discount: 0,
          isOptional: false,
          optionalPitchLine: null,
          acceptedByCustomer: true,
          planTemplateId: selectedPlan.id,
          planTemplateName: selectedPlan.name,
          planBillingCycle: selectedPlan.billingCycle,
        }];
      } else {
        const desc = secondaryService
          ? `${selectedService?.name ?? 'Service'} + ${secondaryService.name}`
          : (selectedService?.name ?? 'Custom Quote');
        lineItems = [{
          description: desc,
          qty: 1,
          unitPrice: serviceCalculatedPrice,
          markup: 0,
          discount: 0,
          isOptional: false,
          optionalPitchLine: null,
          acceptedByCustomer: true,
          ...(selectedServiceId ? { serviceId: parseInt(selectedServiceId, 10), serviceName: selectedService?.name } : {}),
          ...(secondaryServiceId ? { secondaryServiceId: parseInt(secondaryServiceId, 10), secondaryServiceName: secondaryService?.name } : {}),
        }];
      }

      const r = await customFetch<{ id: number }>('/api/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, propertyId, visitMode: 'service', lineItems }),
      });
      toast.success(`Estimate #${r.id} created`);
      window.location.href = `${import.meta.env.BASE_URL}estimates?highlight=${r.id}`;
    } catch {
      toast.error('Failed to create estimate');
    }
  };

  const quoteUrl = generatedQuote
    ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/quote/${generatedQuote.token}`
    : null;

  const copyLink = () => {
    if (!quoteUrl) return;
    navigator.clipboard.writeText(quoteUrl).then(() => toast.success('Quote link copied!'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary" /> Quick Quote
        </CardTitle>
        <CardDescription>
          Generate an instant quote link or save a draft estimate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Mode toggle */}
        <div className="flex border rounded-lg overflow-hidden text-sm">
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition ${mode === 'service' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            onClick={() => setMode('service')}
            title="Quote an individual service or bundle two services together"
          >
            <Calculator className="w-3.5 h-3.5" /> Service Quote
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition ${mode === 'plan' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            onClick={() => { setMode('plan'); loadPlans(); }}
            title="Quote a recurring service plan (e.g. monthly lawn care program)"
          >
            <Package className="w-3.5 h-3.5" /> Plan Quote
          </button>
        </div>

        {/* ── SERVICE MODE ── */}
        {mode === 'service' && (
          <>
            {/* Primary service */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Service</label>
              <Select
                value={selectedServiceId}
                onValueChange={v => { setSelectedServiceId(v); setOverridePrice(''); }}
                onOpenChange={open => { if (open) loadServices(); }}
              >
                <SelectTrigger title="Select a service to generate a quote for">
                  <SelectValue placeholder={loadingServices ? 'Loading services...' : 'Select a service...'} />
                </SelectTrigger>
                <SelectContent>
                  {(services ?? []).map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      <div className="flex items-center justify-between gap-4 w-full">
                        <span>{s.name}</span>
                        {s.pricingMode === 'matrix' ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 text-violet-600 border-violet-300 bg-violet-50">
                            <Grid3X3 className="w-2.5 h-2.5" /> matrix
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">${s.basePrice.toFixed(2)}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Matrix info */}
            {selectedService && isMatrixService && (
              <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 border border-violet-200 rounded px-2.5 py-1.5">
                <Grid3X3 className="w-3 h-3 shrink-0" />
                <span>
                  Area-based pricing
                  {linkedZoneTypeName
                    ? <> — auto-using <strong>{linkedZoneTypeName}</strong> zone area</>
                    : ' — select zones below to determine price'}
                </span>
              </div>
            )}

            {/* Bundle second service */}
            {selectedServiceId && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-500" /> Bundle with Second Service
                  <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </label>
                <Select
                  value={secondaryServiceId}
                  onValueChange={v => setSecondaryServiceId(v === '__none__' ? '' : v)}
                  onOpenChange={open => { if (open) loadServices(); }}
                >
                  <SelectTrigger title="Optionally combine a second service into this quote — both appear as one bundled line item">
                    <SelectValue placeholder="No bundle — single service" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No bundle</SelectItem>
                    {(services ?? []).filter(s => String(s.id) !== selectedServiceId).map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        + {s.name}
                        <span className="ml-2 text-muted-foreground text-xs">${s.basePrice.toFixed(2)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {secondaryService && (
                  <p className="text-xs text-indigo-600">
                    Bundled: <strong>{selectedService?.name}</strong> + <strong>{secondaryService.name}</strong> — prices combined
                  </p>
                )}
              </div>
            )}

            {/* Price type (only for non-matrix single services) */}
            {selectedService && !isMatrixService && !secondaryService && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Price type:</span>
                <div className="flex border rounded-lg overflow-hidden text-sm">
                  {(['flat', 'per_sqft'] as const).map(t => (
                    <button
                      key={t}
                      title={t === 'flat' ? 'Charge a single flat rate for this service' : 'Charge per square foot based on selected zone areas'}
                      className={`px-3 py-1.5 transition ${priceType === t ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                      onClick={() => setPriceType(t)}
                    >
                      {t === 'flat' ? 'Flat rate' : 'Per sqft'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Zone selector */}
            {zones.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Ruler className="w-3.5 h-3.5 text-primary" /> Include Zones
                  {linkedZoneTypeName && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1 text-violet-600 border-violet-300">
                      auto-selected: {linkedZoneTypeName}
                    </Badge>
                  )}
                </label>
                <div className="space-y-1.5">
                  {zones.map(zone => (
                    <label
                      key={zone.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selectedZones.has(zone.id) ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/50'}`}
                    >
                      <input type="checkbox" checked={selectedZones.has(zone.id)} onChange={() => toggleZone(zone.id)} className="rounded" />
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                      <span className="flex-1 text-sm font-medium">{zone.label}</span>
                      <span className="text-xs text-muted-foreground">{formatArea(zone.areaSqft, preferredAreaUnit)}</span>
                    </label>
                  ))}
                </div>
                {selectedZoneList.length > 0 && (
                  <div className="text-xs text-muted-foreground text-right">
                    {selectedZoneList.length} zone{selectedZoneList.length !== 1 ? 's' : ''} · {formatArea(totalAreaSqft, preferredAreaUnit)}
                  </div>
                )}
              </div>
            )}

            {/* Custom price override */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Custom Price (optional override)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="number" min="0" step="0.01"
                  title="Override the calculated price — leave blank to use the auto-calculated amount"
                  placeholder={selectedService ? `${serviceCalculatedPrice.toFixed(2)} (calculated)` : '0.00'}
                  value={overridePrice}
                  onChange={e => setOverridePrice(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </>
        )}

        {/* ── PLAN MODE ── */}
        {mode === 'plan' && (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Service Plan</label>
              <Select
                value={selectedPlanId}
                onValueChange={v => { setSelectedPlanId(v); setPlanOverridePrice(''); }}
                onOpenChange={open => { if (open) loadPlans(); }}
              >
                <SelectTrigger title="Select a recurring service plan to quote">
                  <SelectValue placeholder={loadingPlans ? 'Loading plans...' : 'Select a plan...'} />
                </SelectTrigger>
                <SelectContent>
                  {(planTemplates ?? []).map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      <span>{p.name}</span>
                      <span className="ml-2 text-muted-foreground text-xs">
                        {p.pricingMode === 'matrix' ? 'area-based' : `$${p.price.toFixed(2)}/${p.billingCycle}`}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPlan?.description && (
                <p className="text-xs text-muted-foreground">{selectedPlan.description}</p>
              )}
              {selectedPlan?.pricingMode === 'matrix' && (
                <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 border border-violet-200 rounded px-2.5 py-1.5">
                  <Grid3X3 className="w-3 h-3 shrink-0" />
                  Area-based plan price — resolved from property size
                </div>
              )}
            </div>

            {/* Plan price override */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Custom Price (optional override)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="number" min="0" step="0.01"
                  title="Override the plan price — leave blank to use the plan's configured price"
                  placeholder={selectedPlan ? `${planCalculatedPrice.toFixed(2)} (plan price)` : '0.00'}
                  value={planOverridePrice}
                  onChange={e => setPlanOverridePrice(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Price preview */}
        <div className="rounded-lg border bg-muted/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Quote Total</p>
            <p className="text-2xl font-bold text-primary mt-0.5">${calculatedPrice.toFixed(2)}</p>
            {mode === 'service' && secondaryService && (
              <p className="text-xs text-indigo-600 font-medium">
                {selectedService?.name} + {secondaryService.name}
              </p>
            )}
            {mode === 'service' && isMatrixService && selectedService?.pricingMatrix && totalAreaSqft > 0 && (
              <p className="text-xs text-muted-foreground">
                Matrix price for {formatArea(totalAreaSqft, preferredAreaUnit)}
              </p>
            )}
            {mode === 'service' && !isMatrixService && priceType === 'per_sqft' && selectedService && totalAreaSqft > 0 && !secondaryService && (
              <p className="text-xs text-muted-foreground">
                ${selectedService.basePrice}/sqft × {formatArea(totalAreaSqft, preferredAreaUnit)}
              </p>
            )}
            {mode === 'plan' && selectedPlan && (
              <p className="text-xs text-muted-foreground">per {selectedPlan.billingCycle}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {!generatedQuote && (
              <Button
                title="Generate a shareable quote link to send to the customer"
                onClick={createQuote}
                disabled={creating}
                className="gap-2"
              >
                {creating ? 'Generating...' : 'Generate Quote Link'}
              </Button>
            )}
            {customerId && calculatedPrice > 0 && (
              <Button
                variant="outline"
                title="Save this quote as a draft estimate"
                className="gap-2"
                onClick={saveAsEstimate}
              >
                <Copy className="w-4 h-4" /> Save as Estimate
              </Button>
            )}
          </div>
        </div>

        {/* Generated quote link */}
        {generatedQuote && quoteUrl && (
          <div className="space-y-3 p-4 border border-emerald-200 bg-emerald-50/50 rounded-lg">
            <div className="flex items-center gap-2 text-emerald-700 font-medium text-sm">
              <CheckCircle2 className="w-4 h-4" /> Quote link ready
            </div>
            <div className="flex gap-2">
              <Input readOnly title="Shareable quote link — copy and send to the customer" value={quoteUrl} className="text-xs font-mono bg-white" />
              <Button size="icon" variant="outline" onClick={copyLink} title="Copy link"><Copy className="w-4 h-4" /></Button>
              <Button size="icon" variant="outline" onClick={() => window.open(quoteUrl, '_blank')} title="Open link"><ExternalLink className="w-4 h-4" /></Button>
            </div>
            <Button variant="outline" size="sm" title="Clear this quote and generate a new one" className="w-full text-xs" onClick={() => setGeneratedQuote(null)}>
              Create Another Quote
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
