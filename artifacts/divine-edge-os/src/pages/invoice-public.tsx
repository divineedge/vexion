import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'wouter';
import { useGetPublicInvoice, useCreatePublicInvoicePayment, useGetPublicInvoicePaymentOptions, getGetPublicInvoicePaymentOptionsQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { XCircle, Lock, Loader2, CheckCircle2, Landmark, Clock, AlertCircle, RefreshCw } from 'lucide-react';
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
  const qc = useQueryClient();
  const [saveCard, setSaveCard] = useState(true);
  const createPayment = useCreatePublicInvoicePayment();

  const { data: invoice, isLoading, error } = useGetPublicInvoice(token!, {
    query: {
      enabled: !!token,
      queryKey: ['getPublicInvoice', token],
      refetchInterval: q => (returnedFromCheckout && (q.state.data as any)?.status !== 'paid' && Date.now() < pollUntil ? 3000 : false),
    },
  });
  const invStatus = (invoice as any)?.status;
  const optionsQuery = useGetPublicInvoicePaymentOptions(token!, {
    query: {
      enabled: !!token && !!invoice && invStatus !== 'paid',
      queryKey: getGetPublicInvoicePaymentOptionsQueryKey(token!),
      staleTime: 0,
      refetchInterval: q => ((q.state.data as any)?.paymentStatus === 'paid' ? false : 10_000),
    },
  });
  const options = optionsQuery.data;
  const sawPaid = useRef(false);
  useEffect(() => {
    if (options?.paymentStatus === 'paid' && !sawPaid.current) {
      sawPaid.current = true;
      qc.invalidateQueries({ queryKey: ['getPublicInvoice', token] });
    }
  }, [options?.paymentStatus, qc, token]);
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
    if (options?.paymentStatus !== 'available' || !options.methods.length) return;
    createPayment.mutate(
      { token: token!, data: { saveCard, authorizationAccepted: saveCard } },
      {
        onSuccess: res => {
          if (res?.checkoutUrl) openCheckout(res.checkoutUrl);
          else toast.error('Could not open the payment page. Please try again.');
        },
        onError: (e: any) => { toast.error(e?.data?.error ?? e?.message ?? 'Could not start payment. Please try again.'); optionsQuery.refetch(); },
      },
    );
  }

  return (
    <InvoiceDocument invoice={invoice} hideLegacyPayLink>
      {returnedFromCheckout && !isPaid && (
        <div className="rounded-lg border p-4 text-sm print:hidden" data-testid="status-payment-return">
          <p className="flex items-center gap-2 font-medium"><Clock className="w-4 h-4" /> Payment submitted. Awaiting confirmation.</p>
          <p className="text-muted-foreground mt-1">This invoice is marked paid only after the payment processor confirms it. Card payments usually confirm within minutes; bank payments can take up to 4 business days.{pollExpired ? ' You can close this page and check back later.' : ''}</p>
        </div>
      )}
      {isPaid && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm print:hidden" data-testid="status-invoice-paid">
          <p className="flex items-center gap-2 text-emerald-800 font-medium"><CheckCircle2 className="w-4 h-4" /> This invoice is paid.</p>
        </div>
      )}
      {payable && (
        <Card className="print:hidden" data-testid="panel-pay-invoice">
          <CardContent className="pt-5 pb-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Amount due today</span>
              <span className="text-2xl font-bold" data-testid="text-pay-amount">${balanceDue.toFixed(2)}</span>
            </div>
            {optionsQuery.isLoading ? (
              <Button size="lg" className="w-full gap-2" disabled data-testid="button-pay-invoice"><Loader2 className="w-4 h-4 animate-spin" /> Checking payment options…</Button>
            ) : optionsQuery.isError || !options ? (
              <div className="space-y-2" data-testid="status-payment-options-error">
                <p className="text-sm text-destructive flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> Payment options could not be loaded. Online payment is unavailable until they load.</p>
                <Button variant="outline" className="w-full gap-2" onClick={() => optionsQuery.refetch()} disabled={optionsQuery.isFetching} data-testid="button-retry-payment-options">
                  {optionsQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Retry
                </Button>
              </div>
            ) : options.paymentStatus !== 'available' || options.methods.length === 0 ? (
              <div className={`rounded-md border p-3 text-sm ${options.paymentStatus === 'paid' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`} data-testid="status-payment">
                <p className="font-medium flex items-center gap-2">
                  {options.paymentStatus === 'paid' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                  {options.paymentStatus === 'paid' ? 'Payment confirmed' : options.paymentStatus === 'processing' ? 'Payment processing' : options.paymentStatus === 'review' ? 'Payment under review' : 'Online payment unavailable'}
                </p>
                {options.message && <p className="text-xs mt-1">{options.message}</p>}
                {(options.paymentStatus === 'processing' || options.paymentStatus === 'review') && <p className="text-xs mt-1">Another payment cannot be started while this one is pending. Pending is not paid.</p>}
              </div>
            ) : (() => {
              const hasBank = options.methods.includes('us_bank_account');
              const hasCard = options.methods.includes('card');
              const text = options.achRequired ? `Pay by bank account, $${balanceDue.toFixed(2)}` : hasBank && hasCard ? `Pay by card or bank, $${balanceDue.toFixed(2)}` : `Pay Now, $${balanceDue.toFixed(2)}`;
              return (
                <>
                  {hasBank && (
                    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1" data-testid="text-ach-info">
                      <p className="font-medium text-foreground flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5" /> {options.achRequired ? 'This invoice is paid by bank account (ACH)' : 'Card or bank account (ACH) accepted'}</p>
                      <p>Bank details are entered on Stripe's secure page. Stripe verifies your account, usually instantly by signing in to your bank, or with small deposits that can take a few business days if instant verification isn't available. A bank payment can take up to 4 business days to confirm; until then it is pending, not paid.</p>
                      {options.message && <p>{options.message}</p>}
                    </div>
                  )}
                  <SaveCardConsent checked={saveCard} onChange={setSaveCard} disabled={createPayment.isPending} id="public-invoice-save-card" bankPayments={hasBank} />
                  <Button size="lg" className="w-full gap-2" onClick={pay} disabled={createPayment.isPending} aria-label={text} data-testid="button-pay-invoice">
                    {createPayment.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    {createPayment.isPending ? 'Opening secure checkout…' : text}
                  </Button>
                  <p className="text-[11px] text-center text-muted-foreground">Payment details are entered on Stripe's secure checkout page.</p>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </InvoiceDocument>
  );
}
