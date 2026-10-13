import { useState } from "react";
import { customFetch, type PortalPaySessionResult } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Loader2, Lock, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [saveCard, setSaveCard] = useState(false);
  const [pending, setPending] = useState(false);
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  async function pay(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    onStart?.();
    try {
      const res = await customFetch<PortalPaySessionResult>(`/api/portal/invoices/${invoiceId}/pay-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: buildReturnUrl(returnPath), saveCard }),
      });
      if (res?.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      throw new Error("Could not open payment page. Please try again.");
    } catch (err: any) {
      toast.error(err?.data?.error ?? err?.message ?? "Payment session failed. Please try again.");
      setPending(false);
      onFail?.();
    }
  }

  const id = `save-card-${invoiceId}`;
  return (
    <div className={`space-y-2 ${className ?? ""}`} onClick={stop}>
      <Button className="w-full" size={size} disabled={disabled || pending} onClick={pay} data-testid={`button-pay-${invoiceId}`}>
        {pending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening secure checkout…</> : <><Lock className="w-4 h-4 mr-2" />{label}</>}
      </Button>
      <div className="flex items-start gap-2">
        <Checkbox id={id} checked={saveCard} onCheckedChange={v => setSaveCard(v === true)} disabled={pending} data-testid={`checkbox-save-card-${invoiceId}`} />
        <label htmlFor={id} className="text-xs text-muted-foreground leading-snug cursor-pointer select-none">
          Save card for future payments
        </label>
      </div>
      {!compact && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <CreditCard className="w-3 h-3" /> Secure Stripe checkout. Manage saved cards in{" "}
          <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">Profile</Link>.
        </p>
      )}
    </div>
  );
}
