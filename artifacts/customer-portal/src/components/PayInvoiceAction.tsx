import { useEffect, useRef, useState } from "react";
import {
  customFetch, type PortalPaySessionResult,
  useGetPortalInvoicePaymentOptions, getGetPortalInvoicePaymentOptionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Lock, CreditCard, Landmark, Clock, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveCardConsent } from "@/components/payments/CardAuthorization";
import { verifiedCheckoutUrl } from "@/lib/checkoutUrl";

/** Build a return URL that stays on the current tenant (preserves ?tenant= if present). */
function buildReturnUrl(path: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
  const tenant = new URLSearchParams(window.location.search).get("tenant");
  return tenant ? `${base}?tenant=${encodeURIComponent(tenant)}` : base;
}

interface Props {
  invoiceId: number;
  /** Path (relative to portal base) Stripe returns to, e.g. "invoices" or "invoices/12". */
  returnPath: string;
  label?: string;
  size?: "default" | "lg" | "sm";
  className?: string;
  disabled?: boolean;
  onStart?: () => void;
  onFail?: () => void;
  compact?: boolean;
}

export function PayInvoiceAction({ invoiceId, returnPath, label = "Pay Now", size = "default", className, disabled, onStart, onFail, compact }: Props) {
  const [saveCard, setSaveCard] = useState(true);
  const [pending, setPending] = useState(false);
  const qc = useQueryClient();
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  const { data: options, isLoading, isError, refetch, isFetching } = useGetPortalInvoicePaymentOptions(invoiceId, {
    query: {
      queryKey: getGetPortalInvoicePaymentOptionsQueryKey(invoiceId),
      enabled: invoiceId > 0,
      staleTime: 0,
      refetchInterval: q => ((q.state.data as any)?.paymentStatus === "paid" ? false : 10_000),
    },
  });

  // When the processor confirms the payment, refresh the invoice data.
  const sawPaid = useRef(false);
  useEffect(() => {
    if (options?.paymentStatus === "paid" && !sawPaid.current) {
      sawPaid.current = true;
      qc.invalidateQueries();
    }
  }, [options?.paymentStatus, qc]);

  const methods = options?.methods ?? [];
  const hasBank = methods.includes("us_bank_account");
  const hasCard = methods.includes("card");
  const status = options?.paymentStatus;
  const canPay = !!options && status === "available" && methods.length > 0;

  async function pay(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending || !canPay) return;
    setPending(true);
    onStart?.();
    try {
      const res = await customFetch<PortalPaySessionResult>(`/api/portal/invoices/${invoiceId}/pay-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: buildReturnUrl(returnPath), saveCard, authorizationAccepted: saveCard }),
      });
      if (res?.checkoutUrl) {
        window.location.href = verifiedCheckoutUrl(res.checkoutUrl);
        return;
      }
      throw new Error("Could not open payment page. Please try again.");
    } catch (err: any) {
      toast.error(err?.data?.error ?? err?.message ?? "Payment session failed. Please try again.");
      setPending(false);
      onFail?.();
      refetch();
    }
  }

  const id = `save-card-${invoiceId}`;

  if (isLoading) {
    return (
      <div className={`space-y-2 w-full ${className ?? ""}`} onClick={stop} data-testid={`status-payment-options-loading-${invoiceId}`}>
        <Skeleton className="h-16 w-full" />
        <Button className="w-full" size={size} disabled><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking payment options…</Button>
      </div>
    );
  }

  if (isError || !options) {
    return (
      <div className={`space-y-2 w-full ${className ?? ""}`} onClick={stop} data-testid={`status-payment-options-error-${invoiceId}`}>
        <p className="text-xs text-destructive flex items-start gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> We could not load payment options. Online payment is unavailable until they load.</p>
        <Button variant="outline" className="w-full" size={size} onClick={e => { e.stopPropagation(); refetch(); }} disabled={isFetching} data-testid={`button-retry-payment-options-${invoiceId}`}>
          {isFetching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />} Retry
        </Button>
      </div>
    );
  }

  if (status !== "available") {
    const Icon = status === "paid" ? CheckCircle2 : Clock;
    const tone = status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900";
    return (
      <div className={`w-full rounded-md border p-3 text-sm ${tone} ${className ?? ""}`} onClick={stop} data-testid={`status-payment-${invoiceId}`}>
        <p className="font-medium flex items-center gap-1.5">
          <Icon className="w-4 h-4" />
          {status === "paid" ? "Payment confirmed" : status === "processing" ? "Payment processing" : "Payment under review"}
        </p>
        {options.message && <p className="text-xs mt-1 opacity-90">{options.message}</p>}
        {status !== "paid" && <p className="text-xs mt-1 opacity-90">A new payment cannot be started while this one is pending. Pending is not the same as paid.</p>}
      </div>
    );
  }

  const buttonText = options.achRequired ? `${label} by bank account` : hasBank && hasCard ? `${label} by card or bank` : label;

  return (
    <div className={`space-y-2 w-full ${className ?? ""}`} onClick={stop}>
      {hasBank && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1" data-testid={`text-ach-info-${invoiceId}`}>
          <p className="font-medium text-foreground flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5" />
            {options.achRequired ? "This invoice is paid by bank account (ACH)" : hasCard ? "Card or bank account (ACH) accepted" : "Bank account (ACH)"}
          </p>
          {!compact && <p>Bank details are entered on Stripe's secure page. Stripe verifies your account, usually instantly by signing in to your bank, or with small deposits that can take a few business days if instant verification isn't available. A bank payment can take up to 4 business days to confirm; until then it shows as pending, not paid.</p>}
          {compact && <p>Bank payments can take up to 4 business days to confirm.</p>}
          {options.message && <p>{options.message}</p>}
        </div>
      )}
      <SaveCardConsent id={id} checked={saveCard} onChange={setSaveCard} disabled={pending} bankPayments={hasBank} />
      <Button className="w-full" size={size} disabled={disabled || pending || !canPay} onClick={pay} aria-label={buttonText} data-testid={`button-pay-${invoiceId}`}>
        {pending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening secure checkout…</> : <><Lock className="w-4 h-4 mr-2" />{buttonText}</>}
      </Button>
      {!compact && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <CreditCard className="w-3 h-3" /> Secure Stripe checkout. Manage saved payment methods in{" "}
          <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">Profile</Link>.
        </p>
      )}
    </div>
  );
}
