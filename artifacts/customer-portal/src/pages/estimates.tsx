import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatDate } from "@/lib/format";
import { FileText, Clock, CheckCircle2, XCircle, ThumbsUp, ThumbsDown, Loader2, ChevronRight, Sparkles } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { toast } from "sonner";

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
}

interface EstimateDetail {
  id: number;
  title: string;
  status: string;
  description: string | null;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: DetailLineItem[];
  expiresAt: string | null;
  createdAt: string;
  publicToken: string | null;
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
  // Track optional item selections: key = item.idx, value = accepted boolean
  const [optionalSelections, setOptionalSelections] = useState<Record<number, boolean>>({});

  // Track the last in-flight optional-items PATCH so respond() can await it
  // before submitting approval, preventing a stale PATCH from overwriting the
  // approved selection after the estimate status has changed to 'approved'.
  const pendingPatchRef = useRef<Promise<void> | null>(null);

  const { data: estimates, isLoading } = useQuery<PortalEstimate[]>({
    queryKey: ["portal-estimates"],
    queryFn: () => customFetch<PortalEstimate[]>("/api/portal/estimates"),
  });

  const pending = (estimates ?? []).filter(e => e.status === "sent");
  const past = (estimates ?? []).filter(e => e.status !== "sent");

  const openReview = async (id: number) => {
    setReviewEstimateId(id);
    setReviewToken(null);
    setDetail(null);
    setDetailLoading(true);
    setOptionalSelections({});
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
    } catch {
      toast.error("Could not load estimate details. Please try again.");
      setReviewEstimateId(null);
    } finally {
      setDetailLoading(false);
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

  const respond = async (action: "approve" | "decline") => {
    if (!reviewToken) return;
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
        body: JSON.stringify({ action, acceptedOptionalItemIds }),
      });
      toast.success(action === "approve" ? "Estimate approved!" : "Estimate declined.");
      queryClient.invalidateQueries({ queryKey: ["portal-estimates"] });
      setReviewEstimateId(null);
      setReviewToken(null);
      setDetail(null);
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
              {requiredItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">What's Included</p>
                  <div className="rounded-lg border overflow-hidden">
                    {requiredItems.map((item, i) => (
                      <div key={item.idx} className={`flex items-start justify-between gap-3 px-4 py-3 text-sm ${i > 0 ? "border-t" : ""}`}>
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
              )}

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

              {detail.expiresAt && (
                <p className="text-xs text-muted-foreground">This estimate expires {formatDate(detail.expiresAt)}.</p>
              )}
            </div>
          ) : null}

          {detail?.status === "sent" && (
            <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
              <Button
                variant="outline"
                className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
                disabled={!!acting}
                onClick={() => respond("decline")}
              >
                {acting === "decline" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsDown className="w-4 h-4" />}
                Decline
              </Button>
              <Button
                className="gap-2"
                disabled={!!acting}
                onClick={() => respond("approve")}
              >
                {acting === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
                Approve Estimate
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
