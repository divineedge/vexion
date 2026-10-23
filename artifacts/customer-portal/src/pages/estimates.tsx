import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatDate } from "@/lib/format";
import { FileText, Clock, CheckCircle2, XCircle, ThumbsUp, ThumbsDown, Loader2, ChevronRight, ChevronDown, Sparkles, CreditCard, ShieldCheck } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { toast } from "sonner";
import { loadStripe, type Stripe as StripeInstance } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { SaveCardConsent } from "@/components/payments/CardAuthorization";

interface PortalEstimate {
  id: number;
  title: string;
  status: string;
  total: number;
  subtotal: number;
  tax: number;
  createdAt: string;
  expiresAt: string | null;
  publicToken: string | null;
  paymentRequirement?: string | null;
  depositValue?: number | null;
  depositPaidAt?: string | null;
}

interface SavedCard {
  label: string;
  last4: string;
  brand: string;
}

interface DetailLineItem {
  idx: number;
  /** UUID of the line item — needed to send acceptedOptionalItemIds on approval */
  itemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isOptional: boolean;
  optionalPitchLine: string | null;
  acceptedByCustomer: boolean;
  /** Items sharing the same non-empty groupId are mutually exclusive (radio set) */
  groupId?: string | null;
  /** Cost category for breakdown view. Defaults to 'labor'. */
  category?: 'labor' | 'parts' | 'other';
}

function getItemCategory(item: DetailLineItem): 'labor' | 'parts' | 'other' {
  return item.category ?? 'labor';
}

const CATEGORY_LABELS: Record<'labor' | 'parts' | 'other', string> = {
  labor: 'Labor',
  parts: 'Parts / Materials',
  other: 'Other',
};

interface EstimateDetail {
  id: number;
  title: string;
  status: string;
  description: string | null;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: DetailLineItem[];
  estimatedDurationMin: number | null;
  expiresAt: string | null;
  createdAt: string;
  publicToken: string | null;
  paymentRequirement?: string | null;
  depositValue?: number | null;
  depositPaidAt?: string | null;
  depositAmount?: number;
  depositChargedAmount?: number | null;
  declineReasonOptions?: string[];
}

/** Inline card form — receives a pre-created setup intent clientSecret */
function InlineCardFormInner({
  depositAmount,
  onSuccess,
  onCancel,
}: {
  depositAmount: number;
  onSuccess: (pmId: string, saveCard: boolean) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [saveCard, setSaveCard] = React.useState(true);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    const cardEl = elements.getElement(CardElement);
    if (!cardEl) return;
    setBusy(true);
    try {
      const choice = { saveCard, authorizationAccepted: saveCard };
      const si = await customFetch<{ clientSecret: string }>("/api/portal/me/setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice),
      });
      const result = await stripe.confirmCardSetup(si.clientSecret, { payment_method: { card: cardEl } });
      if (result.error) { toast.error(result.error.message ?? "Card setup failed"); return; }
      if (result.setupIntent?.status !== "succeeded") { toast.error("Card setup did not complete"); return; }
      const pmId = result.setupIntent?.payment_method as string | undefined;
      if (!pmId) { toast.error("No payment method returned"); return; }
      if (saveCard) {
        await customFetch("/api/portal/me/attach-payment-method", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethodId: pmId, ...choice }),
        });
      }
      onSuccess(pmId, saveCard);
    } catch {
      toast.error("Failed to save card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 bg-white">
        <CardElement
          options={{ style: { base: { fontSize: "16px", color: "#374151" } } }}
          onChange={e => setReady(e.complete)}
        />
      </div>
      <SaveCardConsent checked={saveCard} onChange={setSaveCard} disabled={busy} id="portal-estimate-save-card" />
      <p className="text-xs text-muted-foreground">
        Charged today: <strong>{formatCurrency(depositAmount)}</strong>. {saveCard ? "Your card is saved for future invoices as described above." : "This card is used once and not saved."}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy} className="flex-1">Cancel</Button>
        <Button size="sm" disabled={!ready || busy} onClick={handleSubmit} className="flex-1 gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
          {busy ? "Processing…" : `Pay ${formatCurrency(depositAmount)} & Approve`}
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "sent":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" />Awaiting Approval</Badge>;
    case "approved":
      return <Badge variant="secondary" className="bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>;
    case "rejected":
      return <Badge variant="secondary" className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />Declined</Badge>;
    case "expired":
      return <Badge variant="outline" className="text-muted-foreground">Expired</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function Estimates() {
  const queryClient = useQueryClient();
  const [reviewEstimateId, setReviewEstimateId] = useState<number | null>(null);
  const [reviewToken, setReviewToken] = useState<string | null>(null);
  const [detail, setDetail] = useState<EstimateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState<"approve" | "decline" | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declineChoice, setDeclineChoice] = useState("");
  // Track optional item selections: key = item.idx, value = accepted boolean
  const [optionalSelections, setOptionalSelections] = useState<Record<number, boolean>>({});

  // Track the last in-flight optional-items PATCH so respond() can await it
  // before submitting approval, preventing a stale PATCH from overwriting the
  // approved selection after the estimate status has changed to 'approved'.
  const pendingPatchRef = useRef<Promise<void> | null>(null);

  // ── Deposit payment flow ─────────────────────────────────────────────────
  // payStep: null = show normal approve/decline
  //          'confirm' = show "charge your saved card $X" confirmation
  //          'add-card' = show Stripe card form to add a card first
  const [payStep, setPayStep] = useState<null | "confirm" | "add-card">(null);
  const [savedCard, setSavedCard] = useState<SavedCard | null | undefined>(undefined);
  const [payingDeposit, setPayingDeposit] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [stripePromise, setStripePromise] = useState<Promise<StripeInstance | null> | null>(null);
  const [cardSetupSecret, setCardSetupSecret] = useState<string | null>(null);

  const { data: estimates, isLoading } = useQuery<PortalEstimate[]>({
    queryKey: ["portal-estimates", localStorage.getItem("portal_token")],
    queryFn: () => customFetch<PortalEstimate[]>("/api/portal/estimates"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30000,
  });

  const pending = (estimates ?? []).filter(e => e.status === "sent");
  const past = (estimates ?? []).filter(e => e.status !== "sent");

  const openReview = async (id: number) => {
    setReviewEstimateId(id);
    setReviewToken(null);
    setDetail(null);
    setDetailLoading(true);
    setOptionalSelections({});
    setShowBreakdown(false);
    setPayStep(null);
    setSavedCard(undefined);
    setCardSetupSecret(null);
    try {
      const data = await customFetch<EstimateDetail>(`/api/portal/estimates/${id}`);
      setDetail(data);
      setReviewToken(data.publicToken);
      // Initialise optional selections from server state
      const init: Record<number, boolean> = {};
      data.lineItems.forEach(item => {
        if (item.isOptional) init[item.idx] = item.acceptedByCustomer;
      });
      setOptionalSelections(init);

      // If this is a "sent" estimate with a payment requirement, pre-fetch the
      // customer's saved card so the payment step renders without a loading flash.
      if (data.status === "sent" && data.paymentRequirement && data.paymentRequirement !== "none" && !data.depositPaidAt) {
        customFetch<{ paymentMethod: SavedCard | null }>("/api/portal/me/payment-method")
          .then(r => setSavedCard(r.paymentMethod))
          .catch(() => setSavedCard(null));
      }
    } catch {
      toast.error("Could not load estimate details. Please try again.");
      setReviewEstimateId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  /** Charge the deposit for the current estimate using the given payment method. */
  const payDeposit = async (paymentMethodId?: string, saveCard?: boolean): Promise<boolean> => {
    if (!reviewEstimateId) return false;
    setPayingDeposit(true);
    try {
      await customFetch(`/api/portal/estimates/${reviewEstimateId}/pay-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentMethodId ? { paymentMethodId, saveCard: !!saveCard, authorizationAccepted: !!saveCard } : {}),
      });
      return true;
    } catch (err: any) {
      toast.error(err?.message ?? "Payment failed. Please try again.");
      return false;
    } finally {
      setPayingDeposit(false);
    }
  };

  /** Entry point for the "Approve" button — checks payment requirement first. */
  const handleApprove = async () => {
    if (!detail) return;

    // Await any in-flight optional-item persistence so the server has the final
    // selection committed before we compute and charge the deposit amount.
    // If the patch already failed, toggleOptional already showed an error toast;
    // we still proceed (the server will use whatever state it has).
    if (pendingPatchRef.current) {
      try { await pendingPatchRef.current; } catch { /* error already surfaced */ }
      pendingPatchRef.current = null;
    }

    const req = detail.paymentRequirement;
    const depositPaidAt = detail.depositPaidAt;

    // No payment required or already paid → go straight to respond
    if (!req || req === "none" || depositPaidAt) {
      respond("approve");
      return;
    }

    // Payment required — show payment step (savedCard may still be loading)
    // If card is already known to be present show confirm, otherwise show add-card
    if (savedCard) {
      setPayStep("confirm");
    } else {
      // savedCard === null (no card) or undefined (still loading)
      // If still loading, wait
      if (savedCard === undefined) {
        // Fetch synchronously
        try {
          const r = await customFetch<{ paymentMethod: SavedCard | null }>("/api/portal/me/payment-method");
          setSavedCard(r.paymentMethod);
          if (r.paymentMethod) {
            setPayStep("confirm");
          } else {
            await prepareCardStep();
          }
        } catch {
          await prepareCardStep();
        }
      } else {
        await prepareCardStep();
      }
    }
  };

  const prepareCardStep = async () => {
    try {
      const r = await customFetch<{ clientSecret: string; publishableKey: string }>("/api/portal/me/setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saveCard: false, authorizationAccepted: false }),
      });
      setCardSetupSecret(r.clientSecret);
      if (!stripePromise) setStripePromise(loadStripe(r.publishableKey));
      setPayStep("add-card");
    } catch {
      toast.error("Could not prepare card form. Please try again.");
    }
  };

  const handleConfirmCharge = async () => {
    const ok = await payDeposit();
    if (ok) {
      setPayStep(null);
      respond("approve");
    }
  };

  const toggleOptional = (item: DetailLineItem, checked: boolean) => {
    if (!reviewEstimateId || !detail) return;
    // Snapshot full prior state so we can roll back everything on failure,
    // not just the clicked item (a failed radio change could otherwise leave
    // no option selected in the group).
    const prevSelections = optionalSelections;

    let next = { ...optionalSelections, [item.idx]: checked };
    // If this item belongs to a group and is being selected, deselect all
    // other items in the same group (radio-button behaviour)
    if (checked && item.groupId) {
      detail.lineItems.forEach(li => {
        if (li.isOptional && li.groupId === item.groupId && li.idx !== item.idx) {
          next[li.idx] = false;
        }
      });
    }
    setOptionalSelections(next);

    // Build full selections array and persist to server.
    // Store the promise so respond() can await it before submitting approval.
    const selections = detail.lineItems.map(li =>
      li.isOptional ? (next[li.idx] ?? li.acceptedByCustomer) : true
    );
    const patchPromise = customFetch(`/api/portal/estimates/${reviewEstimateId}/optional-items`, {
      method: "PATCH",
      body: JSON.stringify({ selections }),
    }).then(() => { /* ok */ }).catch(() => {
      // Revert to the full prior state, not just the clicked item, so a
      // failed radio change doesn't leave the group with no option selected.
      setOptionalSelections(prevSelections);
      toast.error("Failed to save selection. Please try again.");
    });
    pendingPatchRef.current = patchPromise;
  };

  // Recompute displayed totals based on current optional selections.
  // For grouped optional items, only the first accepted item per group is counted
  // (mirrors server-side calcTotals logic).
  const computedTotals = detail ? (() => {
    const countedGroups = new Set<string>();
    let subtotal = 0;
    for (const item of detail.lineItems) {
      const accepted = item.isOptional ? (optionalSelections[item.idx] ?? item.acceptedByCustomer) : true;
      if (!accepted) continue;
      if (item.isOptional && item.groupId) {
        if (countedGroups.has(item.groupId)) continue;
        countedGroups.add(item.groupId);
      }
      subtotal += item.total;
    }
    const taxRate = detail.subtotal > 0 ? detail.tax / detail.subtotal : 0;
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    return { subtotal, tax, total: subtotal + tax };
  })() : null;

  // Compute the deposit amount from the LIVE selection total so the displayed
  // confirmation amount always matches what the server will charge — not the stale
  // stored detail.depositAmount which reflects the total at load time.
  const computedDepositAmount = (() => {
    if (!detail) return 0;
    const liveTotal = computedTotals?.total ?? detail.total;
    const req = detail.paymentRequirement;
    if (!req || req === "none") return 0;
    if (req === "full") return liveTotal;
    if (req === "deposit_pct") return Math.round((detail.depositValue ?? 0) / 100 * liveTotal * 100) / 100;
    if (req === "deposit_fixed") return detail.depositValue ?? 0;
    return 0;
  })();

  const respond = async (action: "approve" | "decline") => {
    if (!reviewToken) return;
    if (action === "decline" && declineChoice === "Other" && !declineReason.trim()) {
      toast.error("Please tell us a bit more when choosing Other.");
      return;
    }
    setActing(action);
    try {
      // Await any in-flight selection PATCH so it cannot race against the
      // approval and overwrite the approved line items after status changes.
      if (pendingPatchRef.current) {
        await pendingPatchRef.current;
        pendingPatchRef.current = null;
      }
      // Collect accepted optional item UUIDs so the server knows which add-ons
      // (including the selected radio-group option) are included in the approval.
      const acceptedOptionalItemIds = detail
        ? detail.lineItems
            .filter(li => li.isOptional && li.itemId && (optionalSelections[li.idx] ?? li.acceptedByCustomer))
            .map(li => li.itemId!)
        : [];
      await customFetch(`/api/public/estimates/${reviewToken}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, acceptedOptionalItemIds, ...(action === "decline" ? { ...(declineChoice ? { declineReasonChoice: declineChoice } : {}), ...(declineReason.trim() ? { declineReason: declineReason.trim() } : {}) } : {}) }),
      });
      toast.success(action === "approve" ? "Estimate approved!" : "Estimate declined.");
      queryClient.invalidateQueries({ queryKey: ["portal-estimates"] });
      setReviewEstimateId(null);
      setReviewToken(null);
      setDetail(null);
      setDeclineOpen(false);
      setDeclineReason("");
      setDeclineChoice("");
    } catch (err: any) {
      toast.error(err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setActing(null);
    }
  };

  const EstimateCard = ({ e }: { e: PortalEstimate }) => (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground truncate">{e.title}</h3>
              <StatusBadge status={e.status} />
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Sent {formatDate(e.createdAt)}</span>
              {e.expiresAt && <span>Expires {formatDate(e.expiresAt)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className="text-lg font-bold text-foreground">{formatCurrency(e.total)}</p>
              {e.tax > 0 && <p className="text-xs text-muted-foreground">incl. tax</p>}
            </div>
            <Button
              size="sm"
              variant={e.status === "sent" ? "default" : "outline"}
              className="gap-1.5 shrink-0"
              onClick={() => openReview(e.id)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
              {e.status === "sent" ? "Review & Approve" : "View"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const requiredItems = detail?.lineItems.filter(i => !i.isOptional) ?? [];
  const optionalItems = detail?.lineItems.filter(i => i.isOptional) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Estimates</h1>
        <p className="text-muted-foreground mt-1 text-sm">Review and approve service proposals from your provider.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      ) : (estimates ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="font-medium text-muted-foreground">No estimates yet</p>
            <p className="text-sm text-muted-foreground mt-1">When your provider sends you a proposal, it will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Awaiting Your Response</h2>
              {pending.map(e => <EstimateCard key={e.id} e={e} />)}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-3">
              {pending.length > 0 && <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Past Estimates</h2>}
              {past.map(e => <EstimateCard key={e.id} e={e} />)}
            </div>
          )}
        </div>
      )}

      {/* Review & Approve dialog */}
      <Dialog open={reviewEstimateId !== null} onOpenChange={open => { if (!open && !acting) { setReviewEstimateId(null); setReviewToken(null); setDetail(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.title ?? "Estimate"}</DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detail ? (
            <div className="space-y-5">
              {detail.description && (
                <p className="text-sm text-muted-foreground">{detail.description}</p>
              )}

              {/* Required line items */}
              {requiredItems.length > 0 && (() => {
                const requiredTotal = requiredItems.reduce((s, i) => s + i.total, 0);
                const catGroups = (['labor', 'parts', 'other'] as const)
                  .map(key => ({ key, label: CATEGORY_LABELS[key], items: requiredItems.filter(i => getItemCategory(i) === key) }))
                  .filter(g => g.items.length > 0);

                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What's Included</p>
                      <button
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                        onClick={() => setShowBreakdown(v => !v)}
                        title={showBreakdown ? 'Show total only' : 'See cost breakdown by category'}
                      >
                        <ChevronDown className={`w-3 h-3 transition-transform ${showBreakdown ? 'rotate-180' : ''}`} />
                        {showBreakdown ? 'Hide details' : 'Details'}
                      </button>
                    </div>

                    {showBreakdown ? (
                      /* Expanded: items grouped by category */
                      <div className="space-y-3">
                        {catGroups.map(cat => {
                          const catTotal = cat.items.reduce((s, i) => s + i.total, 0);
                          return (
                            <div key={cat.key}>
                              <div className="flex justify-between items-center mb-1.5">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat.label}</span>
                                <span className="text-xs font-semibold text-muted-foreground">{formatCurrency(catTotal)}</span>
                              </div>
                              <div className="pl-3 border-l-2 border-muted space-y-2">
                                {cat.items.map(item => (
                                  <div key={item.idx} className="flex items-start justify-between gap-3 text-sm">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium">{item.description}</p>
                                      {item.quantity !== 1 && (
                                        <p className="text-xs text-muted-foreground">{item.quantity} × {formatCurrency(item.unitPrice)}</p>
                                      )}
                                    </div>
                                    <p className="font-medium shrink-0">{formatCurrency(item.total)}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Collapsed: single services total line only */
                      <div className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm">
                        <span className="font-medium text-muted-foreground">Services</span>
                        <span className="font-semibold">{formatCurrency(requiredTotal)}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Optional add-ons */}
              {optionalItems.length > 0 && (() => {
                const ungrouped = optionalItems.filter(i => !i.groupId);
                const grouped = optionalItems.filter(i => !!i.groupId);
                const groups = grouped.reduce<Record<string, DetailLineItem[]>>((acc, item) => {
                  const g = item.groupId!;
                  if (!acc[g]) acc[g] = [];
                  acc[g].push(item);
                  return acc;
                }, {});
                const isSent = detail.status === "sent";

                // Shared row renderer (label + price)
                const ItemBody = ({ item, accepted }: { item: DetailLineItem; accepted: boolean }) => (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{item.description}</p>
                      {item.optionalPitchLine && (
                        <p className="text-xs text-amber-700 italic mt-0.5">{item.optionalPitchLine}</p>
                      )}
                      {item.quantity !== 1 && (
                        <p className="text-xs text-muted-foreground">{item.quantity} × {formatCurrency(item.unitPrice)}</p>
                      )}
                    </div>
                    <p className={`font-medium shrink-0 ${accepted ? "" : "text-muted-foreground line-through"}`}>
                      {formatCurrency(item.total)}
                    </p>
                  </>
                );

                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Optional Add-ons</p>
                      <Badge variant="outline" className="text-xs text-amber-700 border-amber-200 bg-amber-50">
                        Select what you'd like
                      </Badge>
                    </div>

                    {/* Ungrouped — independent checkboxes */}
                    {ungrouped.length > 0 && (
                      <div className="rounded-lg border overflow-hidden divide-y">
                        {ungrouped.map(item => {
                          const accepted = optionalSelections[item.idx] ?? item.acceptedByCustomer;
                          return (
                            <div key={item.idx} className={`flex items-start gap-3 px-4 py-3 text-sm transition-colors ${accepted ? "bg-amber-50/40" : "bg-muted/20"}`}>
                              <Checkbox
                                id={`opt-${item.idx}`}
                                checked={accepted}
                                onCheckedChange={checked => { if (isSent) toggleOptional(item, !!checked); }}
                                disabled={!isSent}
                                className="mt-0.5 shrink-0"
                              />
                              <label htmlFor={`opt-${item.idx}`} className={`flex-1 min-w-0 flex items-start gap-3 ${isSent ? "cursor-pointer" : ""}`}>
                                <ItemBody item={item} accepted={accepted} />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Grouped — radio sets (pick one per group) */}
                    {Object.entries(groups).map(([groupName, items]) => (
                      <div key={groupName} className="rounded-lg border overflow-hidden">
                        <div className="px-4 py-2 bg-amber-50 border-b flex items-center gap-1.5">
                          <span className="text-amber-600 text-sm">⊙</span>
                          <p className="text-xs font-semibold text-amber-800">{groupName}</p>
                          <span className="text-xs text-muted-foreground">— choose one</span>
                        </div>
                        <div className="divide-y">
                          {items.map(item => {
                            const accepted = optionalSelections[item.idx] ?? item.acceptedByCustomer;
                            return (
                              <div
                                key={item.idx}
                                className={`flex items-start gap-3 px-4 py-3 text-sm transition-colors ${accepted ? "bg-amber-50/40" : "bg-muted/20"} ${isSent ? "cursor-pointer" : ""}`}
                                onClick={() => { if (isSent && !accepted) toggleOptional(item, true); }}
                              >
                                {/* Native radio input for accessibility */}
                                <input
                                  type="radio"
                                  name={`group-${reviewEstimateId}-${groupName}`}
                                  checked={accepted}
                                  onChange={() => { if (isSent) toggleOptional(item, true); }}
                                  disabled={!isSent}
                                  className="mt-1 shrink-0 accent-amber-600"
                                  aria-label={item.description}
                                />
                                <ItemBody item={item} accepted={accepted} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {isSent && (
                      <p className="text-xs text-muted-foreground">
                        {ungrouped.length > 0 && grouped.length > 0
                          ? "Check individual add-ons and select one option from each group before approving."
                          : ungrouped.length > 0
                          ? "Check or uncheck the add-ons you'd like to include before approving."
                          : "Choose one option from each group before approving."}
                      </p>
                    )}
                  </div>
                );
              })()}

              <Separator />

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(computedTotals?.subtotal ?? detail.subtotal)}</span>
                </div>
                {(computedTotals?.tax ?? detail.tax) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax</span>
                    <span>{formatCurrency(computedTotals?.tax ?? detail.tax)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base">
                  <span>Total</span>
                  <span>{formatCurrency(computedTotals?.total ?? detail.total)}</span>
                </div>
              </div>

              {detail.estimatedDurationMin != null && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Estimated time:{" "}
                    <span className="font-medium text-foreground">
                      {(() => {
                        const mins = detail.estimatedDurationMin!;
                        const h = Math.floor(mins / 60);
                        const m = mins % 60;
                        if (h === 0) return `${m} min`;
                        if (m === 0) return `${h} hr`;
                        return `${h} hr ${m} min`;
                      })()}
                    </span>
                  </span>
                </p>
              )}

              {/* Deposit requirement callout */}
              {detail.paymentRequirement && detail.paymentRequirement !== "none" && (
                <div className={`rounded-lg border p-3 text-sm ${detail.depositPaidAt ? "bg-emerald-50 border-emerald-200" : "bg-blue-50 border-blue-200"}`}>
                  <div className="flex items-center gap-2 font-medium">
                    {detail.depositPaidAt
                      ? <><CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /><span className="text-emerald-800">Deposit paid — {formatCurrency(detail.depositChargedAmount ?? computedDepositAmount)}</span></>
                      : <><CreditCard className="w-4 h-4 text-blue-600 shrink-0" /><span className="text-blue-800">
                          {detail.paymentRequirement === "full" ? "Full payment required" :
                           detail.paymentRequirement === "deposit_pct" ? `${detail.depositValue ?? 0}% deposit required` :
                           `${formatCurrency(detail.depositValue ?? 0)} deposit required`}
                          {" — "}{formatCurrency(computedDepositAmount)} due on acceptance
                        </span>
                      </>
                    }
                  </div>
                </div>
              )}

              {detail.expiresAt && (
                <p className="text-xs text-muted-foreground">This estimate expires {formatDate(detail.expiresAt)}.</p>
              )}
            </div>
          ) : null}

          {/* Payment step: confirm charge to saved card */}
          {detail?.status === "sent" && payStep === "confirm" && savedCard && (
            <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                Payment required to confirm acceptance
              </p>
              <div className="flex items-center gap-3 text-sm text-muted-foreground rounded-lg border bg-white px-3 py-2.5">
                <CreditCard className="w-4 h-4 shrink-0" />
                <span>{savedCard.label}</span>
              </div>
              <p className="text-sm">
                We'll charge <strong>{formatCurrency(computedDepositAmount)}</strong> to your card when you confirm.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPayStep(null)} disabled={payingDeposit} className="flex-1">
                  Cancel
                </Button>
                <Button size="sm" onClick={handleConfirmCharge} disabled={payingDeposit} className="flex-1 gap-2">
                  {payingDeposit ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {payingDeposit ? "Processing…" : `Pay ${formatCurrency(computedDepositAmount)} & Approve`}
                </Button>
              </div>
            </div>
          )}

          {/* Payment step: add card first */}
          {detail?.status === "sent" && payStep === "add-card" && stripePromise && cardSetupSecret && (
            <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-600 shrink-0" />
                Add a payment method to continue
              </p>
              <p className="text-sm text-muted-foreground">
                A deposit of <strong>{formatCurrency(computedDepositAmount)}</strong> is required to accept this estimate.
              </p>
              <Elements stripe={stripePromise}>
                <InlineCardFormInner
                  depositAmount={computedDepositAmount}
                  onSuccess={async (pmId, saveCard) => {
                    setSavedCard(null); // refresh after attach
                    const ok = await payDeposit(pmId, saveCard);
                    if (ok) {
                      setPayStep(null);
                      respond("approve");
                    }
                  }}
                  onCancel={() => setPayStep(null)}
                />
              </Elements>
            </div>
          )}

          {detail?.status === "sent" && !payStep && declineOpen && (
            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3 mt-2">
              <label htmlFor="decline-reason" className="text-sm font-medium">Decline this estimate?</label>
              <p className="text-xs text-muted-foreground">Optionally tell us why so we can follow up with a better fit.</p>
              <div role="radiogroup" aria-label="Reason for declining" className="flex flex-wrap gap-2">
                {[...(detail.declineReasonOptions ?? []).filter(o => o !== "Other"), "Other"].map(o => (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={declineChoice === o}
                    onClick={() => setDeclineChoice(declineChoice === o ? "" : o)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${declineChoice === o ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
              <textarea
                id="decline-reason"
                rows={3}
                maxLength={1000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={declineChoice === "Other" ? "Please describe your reason (required)" : "Anything else we should know? (optional)"}
                value={declineReason}
                onChange={e => setDeclineReason(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" disabled={!!acting} onClick={() => { setDeclineOpen(false); setDeclineReason(""); setDeclineChoice(""); }}>Keep Reviewing</Button>
                <Button size="sm" className="gap-2 bg-red-600 hover:bg-red-700 text-white" disabled={!!acting} onClick={() => respond("decline")}>
                  {acting === "decline" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />}
                  Confirm Decline
                </Button>
              </div>
            </div>
          )}

          {detail?.status === "sent" && !payStep && !declineOpen && (
            <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
              <Button
                variant="outline"
                className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
                disabled={!!acting || payingDeposit}
                onClick={() => setDeclineOpen(true)}
              >
                {acting === "decline" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />}
                Decline
              </Button>
              <Button
                className="gap-2"
                disabled={!!acting || payingDeposit}
                onClick={handleApprove}
              >
                {acting === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
                {detail?.depositPaidAt || !detail?.paymentRequirement || detail.paymentRequirement === "none"
                  ? "Approve Estimate"
                  : `Approve & Pay ${formatCurrency(computedDepositAmount)}`}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
