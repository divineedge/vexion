/**
 * Embeddable quote widget — iframe-safe, no auth required.
 * Accessible at /widget/quote?address=...
 * Calls real backend endpoints to persist prospect leads and quotes.
 * Supports Google Places autocomplete when VITE_GOOGLE_MAPS_API_KEY is set.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, DollarSign, MapPin, ChevronRight } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

/* ── Google Maps types (minimal) ─────────────────────────────────────────── */
declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: object
          ) => {
            addListener: (event: string, cb: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              address_components?: Array<{
                long_name: string;
                short_name: string;
                types: string[];
              }>;
            };
          };
        };
      };
    };
    __googleMapsPlacesReady?: boolean;
  }
}

interface Service {
  id: number;
  name: string;
  description: string | null;
  basePrice: number;
  category: string | null;
}

type Step = 'address' | 'service' | 'confirm' | 'done';

const MAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export default function QuoteWidgetPage() {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const initialAddress = params.get('address') ?? '';
  const tenantId = params.get('tenantId') ?? undefined;

  const [step, setStep] = useState<Step>(initialAddress ? 'service' : 'address');
  const [address, setAddress] = useState(initialAddress);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [services, setServices] = useState<Service[] | null>(null);
  const [loadingServices, setLoadingServices] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  const [quoteRef, setQuoteRef] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addressInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<ReturnType<NonNullable<NonNullable<Window['google']>['maps']>['places']>['Autocomplete'] extends new (...a: any[]) => infer R ? R : never | null>(null);

  /* ── Google Places autocomplete ────────────────────────────────────────── */
  const attachAutocomplete = useCallback(() => {
    if (!addressInputRef.current || !window.google?.maps?.places) return;
    if (autocompleteRef.current) return; // already attached

    const ac = new window.google.maps.places.Autocomplete(addressInputRef.current, {
      types: ['address'],
      fields: ['formatted_address', 'address_components'],
    });

    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (!place.formatted_address) return;

      setAddress(place.formatted_address);

      const comps = place.address_components ?? [];
      const get = (type: string) =>
        comps.find(c => c.types.includes(type))?.long_name ?? '';
      const getShort = (type: string) =>
        comps.find(c => c.types.includes(type))?.short_name ?? '';

      setCity(get('locality') || get('sublocality_level_1'));
      setState(getShort('administrative_area_level_1'));
      setZip(get('postal_code'));
    });

    autocompleteRef.current = ac as any;
  }, []);

  useEffect(() => {
    if (!MAPS_KEY) return;

    // Already loaded
    if (window.google?.maps?.places) {
      attachAutocomplete();
      return;
    }

    // Script already injected but not yet loaded
    if (document.querySelector('#gmaps-script')) return;

    const script = document.createElement('script');
    script.id = 'gmaps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = attachAutocomplete;
    document.head.appendChild(script);
  }, [attachAutocomplete]);

  // Re-attach when the address step becomes active (step could change)
  useEffect(() => {
    if (step === 'address' && MAPS_KEY) {
      // Small delay so the input is mounted
      const t = setTimeout(attachAutocomplete, 100);
      return () => clearTimeout(t);
    }
  }, [step, attachAutocomplete]);

  /* ── Load services ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (step !== 'service' || services !== null) return;
    setLoadingServices(true);
    const url = tenantId
      ? `/api/widget/services?tenantId=${tenantId}`
      : '/api/widget/services';
    customFetch<Service[]>(url)
      .then(data => {
        const list = data.slice(0, 8);
        setServices(list);
        // If no services configured, jump straight to contact form
        if (list.length === 0) setStep('confirm');
      })
      .catch(() => {
        setServices([]);
        setStep('confirm');
      })
      .finally(() => setLoadingServices(false));
  }, [step, services, tenantId]);

  /* ── Handlers ──────────────────────────────────────────────────────────── */
  const handleAddressSubmit = () => {
    if (!address.trim()) { setError('Please enter an address'); return; }
    setError(null);
    setStep('service');
  };

  const handleServiceSelect = (svc: Service) => {
    setSelectedService(svc);
    setStep('confirm');
  };

  const handleSkipService = () => {
    setSelectedService(null);
    setStep('confirm');
  };

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim()) { setError('Name and email are required'); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { setError('Please enter a valid email'); return; }

    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        address: address.trim(),
        city: city || undefined,
        state: state || undefined,
        zip: zip || undefined,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
      };
      if (selectedService) {
        body.serviceId = selectedService.id;
        body.serviceName = selectedService.name;
      }
      if (tenantId) body.tenantId = tenantId;

      const result = await customFetch<{
        token: string; quoteId: number; price: number; serviceName: string;
      }>('/api/widget/quote-request', { method: 'POST', body: JSON.stringify(body) });

      setQuoteToken(result.token);
      setQuoteRef(result.quoteId);
      setStep('done');
    } catch {
      setError('Failed to submit request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-medium mx-auto mb-3">
            <DollarSign className="w-3 h-3" /> Instant Quote
          </div>
          <CardTitle className="text-xl">
            {step === 'address' && 'Get an Instant Price'}
            {step === 'service' && 'Choose a Service'}
            {step === 'confirm' && 'Your Contact Info'}
            {step === 'done' && 'Request Submitted!'}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">

          {/* ── Step: Address ── */}
          {step === 'address' && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-primary" /> Property Address
                </label>
                <Input
                  ref={addressInputRef}
                  placeholder="123 Main St, Miami, FL 33101"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddressSubmit()}
                  autoComplete="street-address"
                />
                {MAPS_KEY && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Start typing for address suggestions
                  </p>
                )}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full gap-2" onClick={handleAddressSubmit}>
                Get Quote <ChevronRight className="w-4 h-4" />
              </Button>
            </>
          )}

          {/* ── Step: Service selection ── */}
          {step === 'service' && (
            <>
              <p className="text-sm text-muted-foreground">
                Property: <strong>{address}</strong>
              </p>
              {loadingServices && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  Loading services…
                </div>
              )}
              {!loadingServices && (services ?? []).length > 0 && (
                <div className="space-y-2">
                  {(services ?? []).map(svc => (
                    <button
                      key={svc.id}
                      className="w-full text-left px-4 py-3 border rounded-lg hover:border-primary hover:bg-primary/5 transition flex items-center justify-between group"
                      onClick={() => handleServiceSelect(svc)}
                    >
                      <div>
                        <p className="font-medium text-sm">{svc.name}</p>
                        {svc.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {svc.description}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="font-semibold text-primary text-sm">
                          {svc.basePrice > 0 ? `$${svc.basePrice.toFixed(2)}` : 'Get quote'}
                        </p>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary ml-auto mt-0.5" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2 pt-1">
                {!loadingServices && (services ?? []).length > 0 && (
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground text-center"
                    onClick={handleSkipService}
                  >
                    Not sure — just contact me
                  </button>
                )}
                <button
                  className="text-sm text-muted-foreground hover:text-foreground text-left"
                  onClick={() => setStep('address')}
                >
                  ← Change address
                </button>
              </div>
            </>
          )}

          {/* ── Step: Confirm ── */}
          {step === 'confirm' && (
            <>
              {selectedService ? (
                <div className="rounded-lg border bg-primary/5 p-4">
                  <p className="text-sm font-medium">{selectedService.name}</p>
                  {selectedService.basePrice > 0 && (
                    <p className="text-2xl font-bold text-primary mt-1">
                      ${selectedService.basePrice.toFixed(2)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{address}</p>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>{address}</span>
                </div>
              )}
              <div className="space-y-3">
                <Input
                  placeholder="Your Name *"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                />
                <Input
                  type="email"
                  placeholder="Email *"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                />
                <Input
                  placeholder="Phone (optional)"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={handleSubmit} disabled={loading}>
                {loading ? 'Submitting…' : 'Request Quote'}
              </Button>
              <button
                className="text-sm text-muted-foreground hover:text-foreground block"
                onClick={() => setStep(services && services.length > 0 ? 'service' : 'address')}
              >
                ← Back
              </button>
            </>
          )}

          {/* ── Step: Done ── */}
          {step === 'done' && (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
              <h2 className="text-lg font-bold">You're all set!</h2>
              <p className="text-sm text-muted-foreground">
                We'll review your request and follow up at <strong>{email}</strong> shortly.
              </p>
              {quoteRef && (
                <p className="text-xs text-muted-foreground">Reference #{quoteRef}</p>
              )}
              {quoteToken && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    const base = (import.meta as any).env?.BASE_URL?.replace(/\/$/, '') ?? '';
                    window.open(`${base}/quote/${quoteToken}`, '_blank');
                  }}
                >
                  View Quote Details
                </Button>
              )}
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
