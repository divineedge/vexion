import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, AlertTriangle, RefreshCw, ChevronDown, ArrowUpRight, FilePlus2, FileText, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
  /** Server-derived: safe to create (or recover) a draft invoice for this job. */
  canInvoice?: boolean;
}
export interface RecoveredInvoice { jobId: number; invoiceId: number }
export interface CoverageReport { jobs: CoverageJob[]; checkedAt: string; recoveredInvoices?: RecoveredInvoice[] }

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
const RECURRING = new Set(['recurring_pending', 'recurring_cycle', 'awaiting_cycle']);
const errText = (e: unknown) => {
  const d = (e as { data?: { error?: string; message?: string } })?.data;
  return d?.error || d?.message || (e instanceof Error ? e.message : '') || 'Could not create draft invoice';
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
  // Local record of drafts created/recovered this session; survives coverage list invalidation and audits.
  const [created, setCreated] = useState<Record<number, { invoiceId: number; existing: boolean }>>({});
  const check = useMutation({
    mutationFn: () => customFetch<CoverageReport>('/api/billing/coverage/check', { method: 'POST' }),
    onSuccess: res => {
      qc.setQueryData(COVERAGE_KEY, res);
      const rec = res.recoveredInvoices ?? [];
      if (rec.length) {
        setCreated(c => ({ ...c, ...Object.fromEntries(rec.map(r => [r.jobId, { invoiceId: r.invoiceId, existing: false }])) }));
        qc.invalidateQueries({ queryKey: ['/api/invoices'] });
      }
      toast.success(rec.length ? `Billing audit complete. ${rec.length} draft invoice${rec.length > 1 ? 's' : ''} recovered (not sent).` : 'Billing audit complete');
    },
    onError: () => toast.error('Billing audit failed'),
  });
  const [confirmFor, setConfirmFor] = useState<number | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [errors, setErrors] = useState<Record<number, string>>({});
  const createDraft = useMutation({
    mutationFn: ({ jobId, reason }: { jobId: number; reason?: string }) =>
      customFetch<{ invoiceId: number; existing: boolean }>(`/api/billing/coverage/jobs/${jobId}/invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {}),
      }),
    onSuccess: (res, { jobId }) => {
      setCreated(c => ({ ...c, [jobId]: res }));
      setErrors(e => { const n = { ...e }; delete n[jobId]; return n; });
      setConfirmFor(null); setConfirmReason('');
      toast.success(res.existing ? 'Existing invoice found for this job' : 'Draft invoice created. Not sent.');
      qc.invalidateQueries({ queryKey: COVERAGE_KEY });
      qc.invalidateQueries({ queryKey: ['/api/invoices'] });
    },
    onError: (e, { jobId }) => { const m = errText(e); setErrors(x => ({ ...x, [jobId]: m })); toast.error(m); },
  });
  const jobs = data?.jobs ?? [];
  const createdOnly = Object.entries(created).filter(([jid]) => !jobs.some(j => j.id === Number(jid)));
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

        {createdOnly.length > 0 && (
          <div className="rounded-md border bg-emerald-50/60 px-3 py-2 text-xs space-y-1" data-testid="list-coverage-created">
            <p className="font-medium text-emerald-900">Draft invoices created this session (not sent)</p>
            {createdOnly.map(([jid, r]) => (
              <div key={jid} className="flex items-center justify-between gap-2">
                <Link href={`/schedule?jobId=${jid}`} className="hover:underline">Job #{jid}{r.existing ? ' (existing invoice)' : ''}</Link>
                <Link href={`/invoices?invoiceId=${r.invoiceId}`} className="inline-flex items-center gap-1 text-emerald-800 hover:underline" data-testid={`link-created-invoice-${jid}`}>
                  Open invoice <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
            ))}
          </div>
        )}

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
                    {errors[j.id] && <p className="text-xs mt-0.5 text-destructive" data-testid={`text-coverage-error-${j.id}`}>{errors[j.id]}</p>}
                    {confirmFor === j.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input value={confirmReason} onChange={e => setConfirmReason(e.target.value)} className="h-7 text-xs flex-1 min-w-[180px]"
                          placeholder="Why bill now instead of the recurring cycle?" data-testid={`input-coverage-reason-${j.id}`} />
                        <Button size="sm" className="h-7 text-xs" disabled={!confirmReason.trim() || createDraft.isPending}
                          onClick={() => createDraft.mutate({ jobId: j.id, reason: confirmReason.trim() })} data-testid={`button-coverage-confirm-${j.id}`}>
                          Confirm draft
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setConfirmFor(null); setConfirmReason(''); }}>Cancel</Button>
                      </div>
                    )}
                  </div>
                  <span className="tabular-nums font-medium shrink-0">{j.totalAmount != null ? `$${j.totalAmount.toFixed(2)}` : '—'}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {created[j.id] ? (
                      <Link href={`/invoices?invoiceId=${created[j.id].invoiceId}`} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-200" data-testid={`link-coverage-invoice-${j.id}`}>
                        <FileText className="w-3 h-3" /> Open invoice
                      </Link>
                    ) : j.invoiceId && !j.canInvoice ? (
                      <Link href={`/invoices?invoiceId=${j.invoiceId}`} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs border hover:bg-muted" data-testid={`link-coverage-review-invoice-${j.id}`}>
                        <FileText className="w-3 h-3" /> Review invoice
                      </Link>
                    ) : j.canInvoice && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={createDraft.isPending && createDraft.variables?.jobId === j.id}
                        title="Create a draft invoice. Nothing is sent to the customer."
                        onClick={() => RECURRING.has(j.reason) ? setConfirmFor(j.id) : createDraft.mutate({ jobId: j.id })} data-testid={`button-coverage-create-${j.id}`}>
                        {createDraft.isPending && createDraft.variables?.jobId === j.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FilePlus2 className="w-3 h-3" />}
                        {RECURRING.has(j.reason) ? 'Bill now' : 'Create draft'}
                      </Button>
                    )}
                    <Link href={`/schedule?jobId=${j.id}`} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs hover:bg-muted" data-testid={`link-coverage-job-${j.id}`}>
                      {j.canInvoice ? 'Open job' : 'Review job'} <ArrowUpRight className="w-3 h-3" />
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
