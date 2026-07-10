/**
 * QuickQuotePanel — shown as a panel on the property detail page.
 * Lets staff select a service + measurement zones, calculate a price,
 * and generate an instant-quote link to send to the customer.
 */
import React, { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { DollarSign, Copy, ExternalLink, CheckCircle2, Calculator, Ruler } from 'lucide-react';
import { toast } from 'sonner';

export interface MeasurementZone {
  id: string;
  label: string;
  areaSqft: number;
  enabled: boolean;
  color: string;
}

interface Service {
  id: number;
  name: string;
  description: string | null;
  basePrice: number;
  category: string | null;
}

interface QuickQuotePanelProps {
  propertyId: number;
  zones: MeasurementZone[];
  preferredAreaUnit?: 'sqft' | 'acres';
}

function formatArea(sqft: number, unit: 'sqft' | 'acres'): string {
  if (unit === 'acres') return `${(sqft / 43560).toFixed(3)} ac`;
  return `${sqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft`;
}

export default function QuickQuotePanel({ propertyId, zones, preferredAreaUnit = 'sqft' }: QuickQuotePanelProps) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [loadingServices, setLoadingServices] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set(zones.filter(z => z.enabled).map(z => z.id)));
  const [priceType, setPriceType] = useState<'flat' | 'per_sqft'>('flat');
  const [overridePrice, setOverridePrice] = useState('');
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

  const selectedService = services?.find(s => String(s.id) === selectedServiceId);
  const selectedZoneList = zones.filter(z => selectedZones.has(z.id));
  const totalAreaSqft = selectedZoneList.reduce((s, z) => s + z.areaSqft, 0);

  const calculatedPrice = (() => {
    if (overridePrice) return parseFloat(overridePrice) || 0;
    if (!selectedService) return 0;
    if (priceType === 'per_sqft' && totalAreaSqft > 0) {
      return selectedService.basePrice * totalAreaSqft;
    }
    return selectedService.basePrice;
  })();

  const toggleZone = (id: string) => {
    setSelectedZones(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createQuote = async () => {
    if (!selectedServiceId && !overridePrice) {
      toast.error('Select a service or enter a custom price');
      return;
    }
    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        selectedZoneLabels: selectedZoneList.map(z => z.label),
        totalAreaSqft: totalAreaSqft || null,
        priceType,
        calculatedPrice,
        serviceName: selectedService?.name ?? 'Custom Quote',
      };
      if (selectedServiceId) payload.serviceId = parseInt(selectedServiceId, 10);

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
          Select a service and measurement zones to generate an instant quote link for your customer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Service selector */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Service</label>
          <Select
            value={selectedServiceId}
            onValueChange={setSelectedServiceId}
            onOpenChange={open => { if (open) loadServices(); }}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingServices ? 'Loading services...' : 'Select a service...'} />
            </SelectTrigger>
            <SelectContent>
              {(services ?? []).map(s => (
                <SelectItem key={s.id} value={String(s.id)}>
                  <div className="flex items-center justify-between gap-4 w-full">
                    <span>{s.name}</span>
                    <span className="text-muted-foreground text-xs">${s.basePrice.toFixed(2)}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Price type (only relevant when service has a basePrice) */}
        {selectedService && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Price type:</span>
            <div className="flex border rounded-lg overflow-hidden text-sm">
              {(['flat', 'per_sqft'] as const).map(t => (
                <button
                  key={t}
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
            </label>
            <div className="space-y-1.5">
              {zones.map(zone => (
                <label
                  key={zone.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selectedZones.has(zone.id) ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/50'}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedZones.has(zone.id)}
                    onChange={() => toggleZone(zone.id)}
                    className="rounded"
                  />
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                  <span className="flex-1 text-sm font-medium">{zone.label}</span>
                  <span className="text-xs text-muted-foreground">{formatArea(zone.areaSqft, preferredAreaUnit)}</span>
                </label>
              ))}
            </div>
            {selectedZoneList.length > 0 && (
              <div className="text-xs text-muted-foreground text-right">
                Selected: {formatArea(totalAreaSqft, preferredAreaUnit)}
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
              type="number"
              min="0"
              step="0.01"
              placeholder={selectedService ? `${calculatedPrice.toFixed(2)} (calculated)` : '0.00'}
              value={overridePrice}
              onChange={e => setOverridePrice(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Price preview */}
        <div className="rounded-lg border bg-muted/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Quote Total</p>
            <p className="text-2xl font-bold text-primary mt-0.5">
              ${calculatedPrice.toFixed(2)}
            </p>
            {priceType === 'per_sqft' && selectedService && totalAreaSqft > 0 && (
              <p className="text-xs text-muted-foreground">
                ${selectedService.basePrice}/sqft × {formatArea(totalAreaSqft, preferredAreaUnit)}
              </p>
            )}
          </div>
          {!generatedQuote && (
            <Button onClick={createQuote} disabled={creating} className="gap-2">
              {creating ? 'Generating...' : 'Generate Quote Link'}
            </Button>
          )}
        </div>

        {/* Generated quote link */}
        {generatedQuote && quoteUrl && (
          <div className="space-y-3 p-4 border border-emerald-200 bg-emerald-50/50 rounded-lg">
            <div className="flex items-center gap-2 text-emerald-700 font-medium text-sm">
              <CheckCircle2 className="w-4 h-4" /> Quote link ready
            </div>
            <div className="flex gap-2">
              <Input
                readOnly
                value={quoteUrl}
                className="text-xs font-mono bg-white"
              />
              <Button size="icon" variant="outline" onClick={copyLink} title="Copy link">
                <Copy className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="outline" onClick={() => window.open(quoteUrl, '_blank')} title="Open link">
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => setGeneratedQuote(null)}
            >
              Create Another Quote
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
