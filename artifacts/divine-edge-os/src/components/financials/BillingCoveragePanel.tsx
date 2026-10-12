import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, AlertTriangle, RefreshCw, ChevronDown, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';

export interface CoverageJob {
  id: number;
  title: string;
  customerId: number | null;
  customerName: string | null;
  completedAt: string | null;
  totalAmount: number | null;
  reason: string;
  needsAttention: boolean;
  invoiceId: number | null;
}
export interface CoverageReport { jobs: CoverageJob[]; checkedAt: string }

const COVERAGE_KEY = ['billing-coverage'];

// Map backend reason codes to plain-language explanations; unknown text is shown as-is.
const REASONS: Record<string, string> = {
  missing_price: 'No price set on the job. Add pricing before invoicing.',
  zero_total: 'Job total is $0. Confirm pricing or mark as no-charge.',
  billing_hold: 'Billing is on hold for this job.',
  missing_customer: 'Job has no customer attached.',
  recurring_pending: 'Will be billed in the next recurring cycle.',
  recurring_cycle: 'Will be billed in the next recurring cycle.',
  awaiting_cycle: 'Will be billed in the next recurring cycle.',
  auto_invoice_failed: 'Automatic invoice creation failed.',
  ready_to_invoice: 'Ready to invoice.',
  no_invoice: 'Completed with no invoice.',
};
const reasonText = (r: string) => REASONS[r] ?? r.replace(/_/g, ' ');

export function BillingCoveragePanel({ enabled = true }: { enabled?: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<CoverageReport>({
    queryKey: COVERAGE_KEY,
    queryFn: () => customFetch<CoverageReport>('/api/billing/coverage'),
    refetchInterval: 60_000,
    enabled,
  });
  const check = useMutation({
    mutationFn: () => customFetch<CoverageReport>('/api/billing/coverage/check', { method: 'POST' }),
    onSuccess: res => { qc.setQueryData(COVERAGE_KEY, res); toast.success('Billing audit complete'); },
    onError: () => toast.error('Billing audit failed'),
  });
  const jobs = data?.jobs ?? [];
  const attention = jobs.filter(j => j.needsAttention);
  const sorted = [...attention, ...jobs.filter(j => !j.needsAttention)];
  if (!enabled) return null;
  const clean = !isLoading && !isError && jobs.length === 0;

  return (
    <Card className={attention.length > 0 ? 'border-amber-300 bg-amber-50/40' : ''} data-testid="panel-billing-coverage">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${attention.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {attention.length > 0 ? <AlertTriangle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-[180px]">
            <p className="font-semibold text-sm">Billing coverage</p>
            {isLoading ? (
              <div className="h-3.5 w-48 mt-1 rounded bg-muted animate-pulse" />
            ) : isError ? (
              <p className="text-xs text-muted-foreground">Coverage audit unavailable.</p>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="text-coverage-summary">
                {clean ? 'Every completed job is invoiced.' : `${jobs.length} completed job${jobs.length !== 1 ? 's' : ''} not invoiced`}
                {data?.checkedAt ? ` · Checked ${new Date(data.checkedAt).toLocaleString()}` : ''}
              </p>
            )}
          </div>
          {attention.length > 0 && (
            <Badge className="bg-amber-200 text-amber-900 border-transparent" data-testid="badge-needs-attention">{attention.length} need attention</Badge>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" disabled={check.isPending}
            onClick={() => (isError ? refetch() : check.mutate())} data-testid="button-coverage-check">
            <RefreshCw className={`w-3.5 h-3.5 ${check.isPending || isFetching ? 'animate-spin' : ''}`} />
            {isError ? 'Retry' : check.isPending ? 'Checking…' : 'Run check'}
          </Button>
          {jobs.length > 0 && (
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => setExpanded(e => !e)} data-testid="button-coverage-toggle">
              {expanded ? 'Hide' : 'Review'} <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </Button>
          )}
        </div>

        {expanded && jobs.length > 0 && (
          <div className="divide-y rounded-md border bg-background">
            {sorted.map(j => {
              return (
                <div key={j.id} className="flex items-start gap-3 px-3 py-2.5 text-sm" data-testid={`row-coverage-${j.id}`}>
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${j.needsAttention ? 'bg-amber-500' : 'bg-muted-foreground/40'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{j.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.customerName ?? 'No customer'}
                      {j.completedAt ? ` · Completed ${new Date(j.completedAt).toLocaleDateString()}` : ''}
                    </p>
                    <p className={`text-xs mt-0.5 ${j.needsAttention ? 'text-amber-800' : 'text-muted-foreground'}`}>{reasonText(j.reason)}</p>
                  </div>
                  <span className="tabular-nums font-medium shrink-0">{j.totalAmount != null ? `$${j.totalAmount.toFixed(2)}` : '—'}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link href={`/jobs/${j.id}`} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs hover:bg-muted" data-testid={`link-coverage-job-${j.id}`}>
                      Open job <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
