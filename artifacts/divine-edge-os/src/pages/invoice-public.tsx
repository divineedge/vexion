import React, { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { useGetPublicInvoice, useCreatePublicInvoicePayment } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { XCircle, Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { InvoiceDocument } from '@/components/documents/InvoiceDocument';
import { SaveCardConsent } from '@/components/payments/CardAuthorization';

function openCheckout(url: string) {
  // Never run Stripe Checkout inside the guest portal iframe.
  try {
    if (window.top && window.top !== window.self) { window.top.location.href = url; return; }
  } catch { /* cross-origin parent: fall through */ }
  window.location.href = url;
}

export default function InvoicePublicPage() {
  const { token } = useParams<{ token: string }>();
  const returnedFromCheckout = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('payment') === 'success';
  const [pollUntil] = useState(() => Date.now() + 60_000);
  const [saveCard, setSaveCard] = useState(true);
  const createPayment = useCreatePublicInvoicePayment();

  const { data: invoice, isLoading, error } = useGetPublicInvoice(token!, {
    query: {
      enabled: !!token,
      queryKey: ['getPublicInvoice', token],
      refetchInterval: q => (returnedFromCheckout && (q.state.data as any)?.status !== 'paid' && Date.now() < pollUntil ? 3000 : false),
    },
  });
  const [pollExpired, setPollExpired] = useState(false);
  useEffect(() => {
    if (!returnedFromCheckout) return;
    const t = setTimeout(() => setPollExpired(true), Math.max(0, pollUntil - Date.now()));
    return () => clearTimeout(t);
  }, [returnedFromCheckout, pollUntil]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">Loading invoice…</p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Invoice Not Found</h2>
            <p className="text-muted-foreground">This invoice link is invalid or has been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const inv = invoice as any;
  const balanceDue: number = typeof inv.balanceDue === 'number' ? inv.balanceDue : (inv.total ?? 0);
  const payable = (inv.status === 'sent' || inv.status === 'overdue') && balanceDue > 0;
  const isPaid = inv.status === 'paid';

  function pay() {
    createPayment.mutate(
      { token: token!, data: { saveCard, authorizationAccepted: saveCard } },
      {
        onSuccess: res => {
          if (res?.checkoutUrl) openCheckout(res.checkoutUrl);
          else toast.error('Could not open the payment page. Please try again.');
        },
        onError: (e: any) => toast.error(e?.data?.error ?? e?.message ?? 'Could not start payment. Please try again.'),
      },
    );
  }

  return (
    <InvoiceDocument invoice={invoice} hideLegacyPayLink>
      {returnedFromCheckout && (
        <div className="rounded-lg border p-4 text-sm print:hidden" data-testid="status-payment-return">
          {isPaid ? (
            <p className="flex items-center gap-2 text-emerald-700 font-medium"><CheckCircle2 className="w-4 h-4" /> Payment received. This invoice is paid.</p>
          ) : pollExpired ? (
            <p className="text-muted-foreground">We have not confirmed your payment yet. It may take a few minutes; refresh this page later or contact the business.</p>
          ) : (
            <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Verifying your payment…</p>
          )}
        </div>
      )}
      {payable && !(returnedFromCheckout && !pollExpired) && (
        <Card className="print:hidden" data-testid="panel-pay-invoice">
          <CardContent className="pt-5 pb-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Amount due today</span>
              <span className="text-2xl font-bold" data-testid="text-pay-amount">${balanceDue.toFixed(2)}</span>
            </div>
            <SaveCardConsent checked={saveCard} onChange={setSaveCard} disabled={createPayment.isPending} id="public-invoice-save-card" />
            <Button size="lg" className="w-full gap-2" onClick={pay} disabled={createPayment.isPending} data-testid="button-pay-invoice">
              {createPayment.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              {createPayment.isPending ? 'Opening secure checkout…' : `Pay Now — $${balanceDue.toFixed(2)}`}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">Card entry happens on Stripe's secure checkout page.</p>
          </CardContent>
        </Card>
      )}
    </InvoiceDocument>
  );
}
