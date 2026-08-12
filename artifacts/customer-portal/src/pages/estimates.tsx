import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDate } from "@/lib/format";
import { FileText, Clock, CheckCircle2, XCircle, ThumbsUp, ThumbsDown, Loader2, ChevronRight } from "lucide-react";
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

interface EstimateDetail {
  id: number;
  title: string;
  status: string;
  description: string | null;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  expiresAt: string | null;
  createdAt: string;
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
  const [reviewToken, setReviewToken] = useState<string | null>(null);
  const [detail, setDetail] = useState<EstimateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState<"approve" | "decline" | null>(null);

  const { data: estimates, isLoading } = useQuery<PortalEstimate[]>({
    queryKey: ["portal-estimates"],
    queryFn: () => customFetch<PortalEstimate[]>("/api/portal/estimates"),
  });

  const pending = (estimates ?? []).filter(e => e.status === "sent");
  const past = (estimates ?? []).filter(e => e.status !== "sent");

  const openReview = async (token: string) => {
    setReviewToken(token);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await customFetch<EstimateDetail>(`/api/public/estimates/${token}`);
      setDetail(data);
    } catch {
      toast.error("Could not load estimate details. Please try again.");
      setReviewToken(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const respond = async (action: "approve" | "decline") => {
    if (!reviewToken) return;
    setActing(action);
    try {
      await customFetch(`/api/public/estimates/${reviewToken}/respond`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      toast.success(action === "approve" ? "Estimate approved!" : "Estimate declined.");
      queryClient.invalidateQueries({ queryKey: ["portal-estimates"] });
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
            {e.publicToken && (
              <Button
                size="sm"
                variant={e.status === "sent" ? "default" : "outline"}
                className="gap-1.5 shrink-0"
                onClick={() => openReview(e.publicToken!)}
              >
                <ChevronRight className="w-3.5 h-3.5" />
                {e.status === "sent" ? "Review & Approve" : "View"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

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
      <Dialog open={!!reviewToken} onOpenChange={open => { if (!open && !acting) { setReviewToken(null); setDetail(null); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
            <div className="space-y-4">
              {detail.description && (
                <p className="text-sm text-muted-foreground">{detail.description}</p>
              )}

              {detail.lineItems?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Line Items</p>
                  <div className="rounded-lg border overflow-hidden">
                    {detail.lineItems.map((item, i) => (
                      <div key={i} className={`flex items-start justify-between gap-3 px-4 py-3 text-sm ${i > 0 ? "border-t" : ""}`}>
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

              <Separator />

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(detail.subtotal)}</span>
                </div>
                {detail.tax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax</span>
                    <span>{formatCurrency(detail.tax)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base">
                  <span>Total</span>
                  <span>{formatCurrency(detail.total)}</span>
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
