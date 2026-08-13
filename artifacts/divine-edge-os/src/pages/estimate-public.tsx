import React, { useState, useEffect } from 'react';
import { useParams } from 'wouter';
import { useGetPublicEstimate, useRespondToEstimate } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, MapPin, Clock, AlertTriangle, Phone, Mail, Globe, Building2, CreditCard, Lock, ChevronDown } from 'lucide-react';
import { loadStripe, type Stripe as StripeInstance } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

interface LineItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  markup: number;
  discount: number;
  isOptional: boolean;
  optionalPitchLine?: string | null;
  acceptedByCustomer: boolean;
  /** Cost category for breakdown view. Defaults to 'labor'. */
  category?: 'labor' | 'parts' | 'other';
}

function getItemCategory(item: LineItem): 'labor' | 'parts' | 'other' {
  return item.category ?? 'labor';
}

const CATEGORY_LABELS: Record<'labor' | 'parts' | 'other', string> = {
  labor: 'Labor',
  parts: 'Parts / Materials',
  other: 'Other',
};

function calcItem(item: LineItem) {
  const base = item.qty * item.unitPrice;
  const afterMarkup = base * (1 + item.markup / 100);
  return afterMarkup * (1 - item.discount / 100);
}

// ── Payment form (mounted inside Stripe Elements) ─────────────────────────────
interface PaymentFormProps {
  token: string;
  acceptedOptionalItemIds: string[];
  grandTotal: number;
  onApproved: () => void;
}

function PaymentForm({ token, acceptedOptionalItemIds, grandTotal, onApproved }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const respond = useRespondToEstimate();

  const [cardComplete, setCardComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const apiBase = (() => {
    const base = import.meta.env.BASE_URL ?? '/';
    const clean = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${clean}/api`;
  })();

  async function handleApprove() {
    if (!stripe || !elements || !cardComplete) return;
    setSubmitting(true);
    try {
      // 1. Create a SetupIntent via our backend
      const siRes = await fetch(`${apiBase}/public/estimates/${token}/setup-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!siRes.ok) {
        const err = await siRes.json().catch(() => ({}));
        toast.error((err as any).error ?? 'Failed to initialise payment setup');
        return;
      }
      const { clientSecret } = await siRes.json();

      // 2. Confirm the card setup client-side
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: elements.getElement(CardElement)! },
      });
      if (result.error) {
        toast.error(result.error.message ?? 'Card setup failed');
        return;
      }
      const paymentMethodId = result.setupIntent?.payment_method as string | null;
      if (!paymentMethodId) {
        toast.error('Card setup did not return a payment method');
        return;
      }

      // 3. Submit acceptance with the confirmed payment method ID
      respond.mutate(
        {
          token,
          data: {
            action: 'approve',
            acceptedOptionalItemIds,
            paymentMethodId,
          } as any,
        },
        {
          onSuccess: () => { onApproved(); toast.success('Estimate approved!'); },
          onError: () => toast.error('Failed to submit response. Please try again.'),
        },
      );
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || respond.isPending;

  return (
    <div className="space-y-3">
      {/* Card input section */}
      <Card className="border-blue-200 bg-blue-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-blue-800">
            <Lock className="w-4 h-4" /> Payment method required
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            A card is saved now and will only be charged after the work is completed and invoiced.
          </p>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md bg-white p-3">
            <CardElement
              onChange={e => setCardComplete(e.complete)}
              options={{
                style: {
                  base: { fontSize: '15px', color: '#1a1a1a', '::placeholder': { color: '#a0aec0' } },
                },
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <CreditCard className="w-3 h-3" /> Secured by Stripe. Your card details are never stored on our servers.
          </p>
        </CardContent>
      </Card>

      <Button
        className="w-full h-12 text-base"
        onClick={handleApprove}
        disabled={busy || !cardComplete || !stripe}
      >
        <CheckCircle2 className="w-5 h-5 mr-2" />
        {busy ? 'Submitting...' : `Approve — $${grandTotal.toFixed(2)}`}
      </Button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EstimatePublicPage() {
  const { token } = useParams<{ token: string }>();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [declineReason, setDeclineReason] = useState('');
  const [responded, setResponded] = useState<'approved' | 'declined' | null>(null);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [stripePromise, setStripePromise] = useState<Promise<StripeInstance | null> | null>(null);

  const { data: estimate, isLoading, error } = useGetPublicEstimate(token!, {
    query: { enabled: !!token, queryKey: ['getPublicEstimate', token] },
  });

  const respond = useRespondToEstimate();

  // Initialise Stripe when the estimate loads and Stripe is enabled
  useEffect(() => {
    const pk = (estimate as any)?.stripePublishableKey;
    if (pk && !stripePromise) {
      setStripePromise(loadStripe(pk));
    }
  }, [estimate]);

  // Initialize accepted with already-accepted optional items
  useEffect(() => {
    if (estimate) {
      const optional = (estimate.lineItems as LineItem[]).filter(i => i.isOptional && i.acceptedByCustomer);
      setAccepted(new Set(optional.map(i => i.id)));
    }
  }, [estimate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">Loading estimate...</p>
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Estimate Not Found</h2>
            <p className="text-muted-foreground">This estimate link is invalid or has been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if ((estimate as any).expired || estimate.status === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Estimate Expired</h2>
            <p className="text-muted-foreground">This estimate has expired. Please contact us for an updated quote.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allItems = (estimate.lineItems as LineItem[]) ?? [];
  const required = allItems.filter(i => !i.isOptional);
  const optional = allItems.filter(i => i.isOptional);

  const requiredTotal = required.reduce((sum, i) => sum + calcItem(i), 0);
  const optionalTotal = optional.filter(i => accepted.has(i.id)).reduce((sum, i) => sum + calcItem(i), 0);
  const grandTotal = requiredTotal + optionalTotal;

  const stripeEnabled = !!(estimate as any).stripeEnabled; // stripeEnabled is in the generated schema but estimate type is allOf — access via any until stricter type is applied

  function toggleOptional(id: string) {
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApproveNoStripe() {
    respond.mutate({
      token: token!,
      data: {
        action: 'approve',
        acceptedOptionalItemIds: Array.from(accepted),
      },
    }, {
      onSuccess: () => { setResponded('approved'); toast.success('Estimate approved!'); },
      onError: () => toast.error('Failed to submit response. Please try again.'),
    });
  }

  function handleDecline() {
    respond.mutate({
      token: token!,
      data: {
        action: 'decline',
        declineReason: declineReason || undefined,
      },
    }, {
      onSuccess: () => { setResponded('declined'); },
      onError: () => toast.error('Failed to submit response. Please try again.'),
    });
  }

  if (responded === 'approved') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-lg w-full mx-4">
          <CardContent className="pt-10 pb-10 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Estimate Approved!</h2>
            <p className="text-muted-foreground">Thank you. We'll be in touch shortly to schedule your service.</p>
            <div className="mt-6 p-4 bg-muted/50 rounded-lg text-left">
              <p className="text-sm font-medium mb-1">Your Total</p>
              <p className="text-3xl font-bold">${grandTotal.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (responded === 'declined') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Estimate Declined</h2>
            <p className="text-muted-foreground">Your response has been recorded. Feel free to reach out if you'd like to discuss further.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Already responded before
  if (estimate.status === 'approved') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Already Approved</h2>
            <p className="text-muted-foreground">This estimate has already been approved. We'll be in touch.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (estimate.status === 'declined') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Already Declined</h2>
            <p className="text-muted-foreground">This estimate was previously declined.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Derive base URL for the public logo endpoint (same pattern as useApiBase)
  const apiBase = (() => {
    const base = import.meta.env.BASE_URL ?? '/';
    const clean = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${clean}/api`;
  })();
  const logoUrl = `${apiBase}/public/tenants/${estimate.tenantId}/logo`;
  const biz = estimate.businessProfile;

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Business branding header */}
        <div className="text-center space-y-3">
          <img
            src={logoUrl}
            alt="Company logo"
            className="h-16 w-auto mx-auto object-contain"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          {biz?.companyName && (
            <h1 className="text-2xl font-bold">{biz.companyName}</h1>
          )}
          {biz?.tagline && (
            <p className="text-sm text-muted-foreground italic">{biz.tagline}</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {biz?.phone && (
              <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{biz.phone}</span>
            )}
            {biz?.email && (
              <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{biz.email}</span>
            )}
            {biz?.website && (
              <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{biz.website}</span>
            )}
            {biz?.address && (
              <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{biz.address}</span>
            )}
          </div>
          <Separator />
        </div>

        {/* Estimate identity */}
        <div className="text-center space-y-1">
          <h2 className="text-3xl font-bold">Your Estimate</h2>
          {estimate.expiresAt && (
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Expires {format(new Date(estimate.expiresAt), 'MMMM d, yyyy')}
            </p>
          )}
          {estimate.propertyAddress && (
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {estimate.propertyAddress}
            </p>
          )}
        </div>

        {/* Required services */}
        {(() => {
          const catGroups = (['labor', 'parts', 'other'] as const)
            .map(key => ({ key, label: CATEGORY_LABELS[key], items: required.filter(i => getItemCategory(i) === key) }))
            .filter(g => g.items.length > 0);

          return (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Services Included</CardTitle>
                  <button
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={() => setShowBreakdown(v => !v)}
                    title={showBreakdown ? 'Show total only' : 'See cost breakdown by category'}
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showBreakdown ? 'rotate-180' : ''}`} />
                    {showBreakdown ? 'Hide details' : 'Details'}
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {required.length === 0 && <p className="text-sm text-muted-foreground">No services listed.</p>}

                {showBreakdown ? (
                  catGroups.map(cat => {
                    const catTotal = cat.items.reduce((s, i) => s + calcItem(i), 0);
                    return (
                      <div key={cat.key}>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat.label}</span>
                          <span className="text-xs font-semibold text-muted-foreground">${catTotal.toFixed(2)}</span>
                        </div>
                        <div className="pl-3 border-l-2 border-muted/60 space-y-2">
                          {cat.items.map(item => (
                            <div key={item.id} className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <p className="font-medium text-sm">{item.description}</p>
                                <p className="text-xs text-muted-foreground">Qty {item.qty} × ${item.unitPrice.toFixed(2)}</p>
                              </div>
                              <span className="font-semibold text-sm shrink-0">${calcItem(item).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                ) : null}

                {optional.length === 0 && (
                  <>
                    <Separator />
                    <div className="flex justify-between items-center font-bold">
                      <span>Total</span>
                      <span className="text-xl">${grandTotal.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Optional add-ons */}
        {optional.length > 0 && (
          <Card className="border-amber-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-amber-700">Add-On Services</CardTitle>
              <p className="text-sm text-muted-foreground">Select any add-ons you'd like to include. Your total updates live.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {optional.map(item => {
                const isChecked = accepted.has(item.id);
                return (
                  <label
                    key={item.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${isChecked ? 'bg-amber-50 border-amber-300' : 'hover:bg-muted/40 border-border'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleOptional(item.id)}
                      className="mt-0.5 rounded accent-amber-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{item.description}</p>
                      {item.optionalPitchLine && (
                        <p className="text-xs text-muted-foreground italic mt-0.5">{item.optionalPitchLine}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">Qty {item.qty} × ${item.unitPrice.toFixed(2)}</p>
                    </div>
                    <span className="font-semibold text-sm shrink-0">${calcItem(item).toFixed(2)}</span>
                  </label>
                );
              })}

              <Separator />
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Required services</span>
                  <span>${requiredTotal.toFixed(2)}</span>
                </div>
                {optionalTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Selected add-ons</span>
                    <span>${optionalTotal.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center font-bold pt-1">
                  <span>Total</span>
                  <span className="text-xl">${grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {estimate.notes && (
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Notes from Us</p>
              <p className="text-sm">{estimate.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        {estimate.status === 'sent' && (
          <div className="space-y-3">
            {!showDeclineForm ? (
              <>
                {stripeEnabled && stripePromise ? (
                  <Elements stripe={stripePromise}>
                    <PaymentForm
                      token={token!}
                      acceptedOptionalItemIds={Array.from(accepted)}
                      grandTotal={grandTotal}
                      onApproved={() => setResponded('approved')}
                    />
                  </Elements>
                ) : (
                  <Button
                    className="w-full h-12 text-base"
                    onClick={handleApproveNoStripe}
                    disabled={respond.isPending}
                  >
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    {respond.isPending ? 'Submitting...' : `Approve — $${grandTotal.toFixed(2)}`}
                  </Button>
                )}
                <Button variant="outline" className="w-full h-10" onClick={() => setShowDeclineForm(true)}>
                  Decline
                </Button>
              </>
            ) : (
              <Card>
                <CardContent className="pt-5 space-y-3">
                  <p className="text-sm font-medium">Reason for declining (optional)</p>
                  <Textarea rows={3} placeholder="Let us know if there's anything we can improve..." value={declineReason} onChange={e => setDeclineReason(e.target.value)} />
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setShowDeclineForm(false)}>Back</Button>
                    <Button variant="destructive" onClick={handleDecline} disabled={respond.isPending}>
                      {respond.isPending ? 'Submitting...' : 'Decline Estimate'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <p className="text-xs text-center text-muted-foreground">By approving, you agree to proceed with the services listed above.</p>
          </div>
        )}
      </div>
    </div>
  );
}
