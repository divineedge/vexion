/**
 * Embeddable quote widget — iframe-safe, no auth required.
 * Accessible at /widget/quote?address=...
 * Calls real backend endpoints to persist prospect leads and quotes.
 */
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, DollarSign, MapPin, ChevronRight } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

interface Service {
  id: number;
  name: string;
  description: string | null;
  basePrice: number;
  category: string | null;
}

type Step = 'address' | 'service' | 'confirm' | 'done';

export default function QuoteWidgetPage() {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const initialAddress = params.get('address') ?? '';
  const tenantId = params.get('tenantId') ?? undefined;

  const [step, setStep] = useState<Step>(initialAddress ? 'service' : 'address');
  const [address, setAddress] = useState(initialAddress);
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

  // Load services when entering the service step
  useEffect(() => {
    if (step !== 'service' || services !== null) return;
    setLoadingServices(true);
    const url = tenantId ? `/api/widget/services?tenantId=${tenantId}` : '/api/widget/services';
    customFetch<Service[]>(url)
      .then(data => setServices(data.slice(0, 8)))
      .catch(() => setServices([]))
      .finally(() => setLoadingServices(false));
  }, [step, services, tenantId]);

  const handleAddressSubmit = () => {
    if (!address.trim()) { setError('Please enter an address'); return; }
    setError(null);
    setStep('service');
  };

  const handleServiceSelect = (svc: Service) => {
    setSelectedService(svc);
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
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
      };
      if (selectedService) {
        body.serviceId = selectedService.id;
        body.serviceName = selectedService.name;
      }
      if (tenantId) body.tenantId = tenantId;

      const result = await customFetch<{ token: string; quoteId: number; price: number; serviceName: string }>(
        '/api/widget/quote-request',
        { method: 'POST', body: JSON.stringify(body) }
      );
      setQuoteToken(result.token);
      setQuoteRef(result.quoteId);
      setStep('done');
    } catch {
      setError('Failed to submit request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
          {/* Step: Address */}
          {step === 'address' && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-primary" /> Property Address
                </label>
                <Input
                  placeholder="123 Main St, Miami, FL 33101"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddressSubmit()}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full gap-2" onClick={handleAddressSubmit}>
                Get Quote <ChevronRight className="w-4 h-4" />
              </Button>
            </>
          )}

          {/* Step: Service selection */}
          {step === 'service' && (
            <>
              <p className="text-sm text-muted-foreground">
                Property: <strong>{address}</strong>
              </p>
              {loadingServices && (
                <div className="text-center py-6 text-muted-foreground text-sm">Loading services...</div>
              )}
              <div className="space-y-2">
                {!loadingServices && services?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No services available right now.</p>
                )}
                {(services ?? []).map(svc => (
                  <button
                    key={svc.id}
                    className="w-full text-left px-4 py-3 border rounded-lg hover:border-primary hover:bg-primary/5 transition flex items-center justify-between group"
                    onClick={() => handleServiceSelect(svc)}
                  >
                    <div>
                      <p className="font-medium text-sm">{svc.name}</p>
                      {svc.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{svc.description}</p>
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
              <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setStep('address')}>
                ← Change address
              </button>
            </>
          )}

          {/* Step: Confirm */}
          {step === 'confirm' && selectedService && (
            <>
              <div className="rounded-lg border bg-primary/5 p-4">
                <p className="text-sm font-medium">{selectedService.name}</p>
                {selectedService.basePrice > 0 && (
                  <p className="text-2xl font-bold text-primary mt-1">${selectedService.basePrice.toFixed(2)}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">{address}</p>
              </div>
              <div className="space-y-3">
                <Input
                  placeholder="Your Name *"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
                <Input
                  type="email"
                  placeholder="Email *"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <Input
                  placeholder="Phone (optional)"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={handleSubmit} disabled={loading}>
                {loading ? 'Submitting...' : 'Request Quote'}
              </Button>
              <button
                className="text-sm text-muted-foreground hover:text-foreground block"
                onClick={() => setStep('service')}
              >
                ← Back
              </button>
            </>
          )}

          {/* Step: Done */}
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
                    const base = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
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
