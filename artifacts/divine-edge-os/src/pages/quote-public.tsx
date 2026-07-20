/**
 * Public instant-quote page — no auth required.
 * Accessible at /quote/:token
 */
import React, { useState } from 'react';
import { useParams } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, XCircle, MapPin, Ruler, DollarSign, Clock, AlertTriangle, Package, LayoutGrid } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

interface BlueprintMaterialPart {
  name: string;
  quantity: number;
  unit: string;
  total: number;
}

interface BlueprintMaterials {
  parts: BlueprintMaterialPart[];
  subtotal: number;
  overageAmount: number;
  total: number;
  computedAt: string | null;
}

interface BlueprintZone {
  label: string;
  areaSqft: number | null;
  color: string | null;
}

interface BlueprintZones {
  zones: BlueprintZone[];
  totalAreaSqft: number | null;
}

interface PublicQuote {
  id: number;
  token: string;
  blueprintId: number | null;
  serviceName: string;
  serviceDescription: string | null;
  selectedZoneLabels: string[];
  totalAreaSqft: number | null;
  calculatedPrice: number;
  priceType: 'flat' | 'per_sqft';
  status: 'pending' | 'approved' | 'declined';
  expiresAt: string | null;
  expired: boolean;
  property: {
    id: number;
    address: string;
    city: string | null;
    state: string | null;
    zip: string | null;
    lat: number | null;
    lng: number | null;
    measurementPolygons: Array<{ id: string; label: string; areaSqft: number; enabled: boolean; color: string }>;
    serviceableAreaSqft: number | null;
    customerName: string | null;
  } | null;
  blueprintMaterials: BlueprintMaterials | null;
  blueprintZones: BlueprintZones | null;
  createdAt: string;
}

export default function QuotePublicPage() {
  const params = useParams();
  const token = params.token as string;

  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerNote, setCustomerNote] = useState('');
  const [responding, setResponding] = useState(false);
  const [responded, setResponded] = useState(false);
  const [responseAction, setResponseAction] = useState<'approved' | 'declined' | null>(null);

  React.useEffect(() => {
    if (!token) return;
    customFetch<PublicQuote>(`/api/quotes/${token}`)
      .then(data => {
        setQuote(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Quote not found or has expired.');
        setLoading(false);
      });
  }, [token]);

  const respond = async (action: 'approved' | 'declined') => {
    if (!token) return;
    setResponding(true);
    try {
      await customFetch(`/api/quotes/${token}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action, customerNote: customerNote || undefined }),
      });
      setResponseAction(action);
      setResponded(true);
    } catch {
      setError('Failed to submit response. Please try again.');
    } finally {
      setResponding(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground">Loading your quote...</p>
        </div>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 text-center">
            <AlertTriangle className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <h2 className="text-xl font-bold mb-2">Quote Not Found</h2>
            <p className="text-muted-foreground">{error ?? 'This quote link is invalid or has expired.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isExpired = quote.expired;
  const isResponded = quote.status !== 'pending' || responded;
  const finalStatus = responded ? responseAction! : (quote.status as 'approved' | 'declined' | 'pending');

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-4">
            <DollarSign className="w-4 h-4" /> Instant Price Quote
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{quote.serviceName}</h1>
          {quote.serviceDescription && (
            <p className="text-muted-foreground mt-2">{quote.serviceDescription}</p>
          )}
        </div>

        {/* Expiry / status banner */}
        {isExpired && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
            <Clock className="w-4 h-4 shrink-0" />
            This quote has expired. Please contact us for a fresh quote.
          </div>
        )}

        {/* Property info */}
        {quote.property && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="w-4 h-4 text-primary" /> Property
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{quote.property.address}</p>
              <p className="text-sm text-muted-foreground">
                {[quote.property.city, quote.property.state, quote.property.zip].filter(Boolean).join(', ')}
              </p>

              {/* Static satellite map placeholder */}
              {quote.property.lat && quote.property.lng && (
                <div className="mt-4 rounded-lg overflow-hidden border bg-muted h-48 flex items-center justify-center relative">
                  <img
                    src={`https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=300&center=lonlat:${quote.property.lng},${quote.property.lat}&zoom=17&marker=lonlat:${quote.property.lng},${quote.property.lat};color:%23e74c3c;size:large&apiKey=YOUR_KEY`}
                    alt="Property location"
                    className="absolute inset-0 w-full h-full object-cover opacity-0"
                    onError={() => {}}
                  />
                  <div className="text-center text-muted-foreground">
                    <MapPin className="w-8 h-8 mx-auto mb-1 opacity-30" />
                    <p className="text-sm">
                      {quote.property.lat.toFixed(5)}, {quote.property.lng.toFixed(5)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Blueprint zone summary — shown when the quote was generated from a site plan */}
        {quote.blueprintZones && quote.blueprintZones.zones.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <LayoutGrid className="w-4 h-4 text-primary" /> Site Plan Summary
              </CardTitle>
              <CardDescription>
                This quote was built from a drawn site plan. The zones and measurements below are what your price is based on — please verify they match your property before approving.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {quote.blueprintZones.zones.map(zone => (
                  <div key={zone.label} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      {zone.color && (
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                      )}
                      <span className="font-medium text-sm">{zone.label}</span>
                    </div>
                    {zone.areaSqft != null ? (
                      <span className="text-sm text-muted-foreground">
                        {zone.areaSqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                ))}
              </div>
              {quote.blueprintZones.totalAreaSqft != null && (
                <div className="flex items-center justify-between pt-3 font-semibold text-sm border-t mt-1">
                  <span className="flex items-center gap-1.5">
                    <Ruler className="w-3.5 h-3.5 text-muted-foreground" /> Total Area
                  </span>
                  <span>{quote.blueprintZones.totalAreaSqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft</span>
                </div>
              )}
            </CardContent>
          </Card>
        ) : quote.selectedZoneLabels.length > 0 ? (
          /* Fallback for non-blueprint quotes that still have zone labels */
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ruler className="w-4 h-4 text-primary" /> Measurement Zones
              </CardTitle>
              <CardDescription>These areas are included in this quote's pricing.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {quote.selectedZoneLabels.map(label => {
                  const zone = quote.property?.measurementPolygons.find(z => z.label === label);
                  return (
                    <div key={label} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        {zone && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: zone.color }} />}
                        <span className="font-medium text-sm">{label}</span>
                      </div>
                      {zone && (
                        <span className="text-sm text-muted-foreground">
                          {zone.areaSqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft
                        </span>
                      )}
                    </div>
                  );
                })}
                {quote.totalAreaSqft && (
                  <div className="flex items-center justify-between pt-3 font-semibold text-sm border-t mt-1">
                    <span>Total Area</span>
                    <span>{quote.totalAreaSqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Price card */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wide font-medium">Quoted Price</p>
            <p className="text-5xl font-bold text-primary">
              ${quote.calculatedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            {quote.priceType === 'per_sqft' && quote.totalAreaSqft && (
              <p className="text-sm text-muted-foreground mt-2">
                ${(quote.calculatedPrice / quote.totalAreaSqft).toFixed(4)}/sqft × {quote.totalAreaSqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft
              </p>
            )}
          </CardContent>
        </Card>

        {/* Materials breakdown — shown when the quote is linked to a blueprint with a computed estimate */}
        {quote.blueprintMaterials && quote.blueprintMaterials.parts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="w-4 h-4 text-primary" /> Materials Included
              </CardTitle>
              {quote.blueprintMaterials.computedAt && (
                <p className="text-xs text-muted-foreground">
                  Based on drawn site plan · estimated {new Date(quote.blueprintMaterials.computedAt).toLocaleDateString()}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {quote.blueprintMaterials.parts.map((part, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{part.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {part.quantity % 1 === 0 ? part.quantity : part.quantity.toFixed(2)} {part.unit}
                      </p>
                    </div>
                    <span className="text-sm font-medium">
                      ${part.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 text-sm border-t pt-3">
                <div className="flex justify-between text-muted-foreground">
                  <span>Materials subtotal</span>
                  <span>${quote.blueprintMaterials.subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
                {quote.blueprintMaterials.overageAmount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Overage buffer</span>
                    <span>${quote.blueprintMaterials.overageAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold pt-1">
                  <span>Materials total</span>
                  <span>${quote.blueprintMaterials.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Response section */}
        {isResponded ? (
          <Card>
            <CardContent className="py-8 text-center">
              {finalStatus === 'approved' ? (
                <>
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                  <h2 className="text-xl font-bold text-emerald-700">Quote Approved!</h2>
                  <p className="text-muted-foreground mt-2">
                    Our team will be in touch shortly to schedule your service.
                  </p>
                </>
              ) : (
                <>
                  <XCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
                  <h2 className="text-xl font-bold">Quote Declined</h2>
                  <p className="text-muted-foreground mt-2">Thank you for your response.</p>
                </>
              )}
            </CardContent>
          </Card>
        ) : !isExpired ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Respond to Quote</CardTitle>
              <CardDescription>Approve to schedule this service, or decline if you're not interested.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Notes (optional)</label>
                <Textarea
                  placeholder="Any questions or special requests..."
                  value={customerNote}
                  onChange={e => setCustomerNote(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>
              <Separator />
              <div className="flex gap-3">
                <Button
                  className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700"
                  disabled={responding}
                  onClick={() => respond('approved')}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {responding ? 'Submitting...' : 'Approve Quote'}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  disabled={responding}
                  onClick={() => respond('declined')}
                >
                  <XCircle className="w-4 h-4" />
                  Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-center text-xs text-muted-foreground">
          Quote #{quote.id} · Generated {new Date(quote.createdAt).toLocaleDateString()}
          {quote.expiresAt && ` · Expires ${new Date(quote.expiresAt).toLocaleDateString()}`}
        </p>
      </div>
    </div>
  );
}
