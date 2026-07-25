import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { FileText, ExternalLink, Clock, CheckCircle2, XCircle } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

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
  const { data: estimates, isLoading } = useQuery<PortalEstimate[]>({
    queryKey: ["portal-estimates"],
    queryFn: () => customFetch<PortalEstimate[]>("/api/portal/estimates"),
  });

  const pending = (estimates ?? []).filter(e => e.status === "sent");
  const past = (estimates ?? []).filter(e => e.status !== "sent");

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
                onClick={() => {
                  const base = window.location.origin;
                  window.open(`${base}/api/public/quotes/${e.publicToken}`, "_blank");
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
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
    </div>
  );
}
