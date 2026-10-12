import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Wallet, Plus, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export interface CreditEntry {
  id: number;
  amount: number;
  kind: string;
  reference: string | null;
  invoiceId: number | null;
  createdAt: string;
}
export interface CreditLedger { balance: number; entries: CreditEntry[] }

const KIND_LABEL: Record<string, string> = {
  prepayment: 'Prepayment received',
  application: 'Applied to invoice',
  applied: 'Applied to invoice',
  invoice_application: 'Applied to invoice',
  reversal: 'Reversal',
  refund: 'Refund',
  adjustment: 'Adjustment',
};

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;

export const customerCreditsKey = (id: number) => ['customer-credits', id];

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function CustomerCreditsCard({ customerId, canRecord }: { customerId: number; canRecord: boolean }) {
  if (!canRecord) return null;
  return <CreditsCardInner customerId={customerId} canRecord={canRecord} />;
}

function CreditsCardInner({ customerId, canRecord }: { customerId: number; canRecord: boolean }) {
  const qc = useQueryClient();
  const enabled = Number.isFinite(customerId) && customerId > 0;
  const { data, isLoading, isError, refetch } = useQuery<CreditLedger>({
    queryKey: customerCreditsKey(customerId),
    queryFn: () => customFetch<CreditLedger>(`/api/customers/${customerId}/credits`),
    enabled,
    refetchInterval: 30_000,
  });

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const requestIdRef = useRef<string>(newRequestId());

  const record = useMutation({
    mutationFn: (body: { amount: number; reference: string; requestId: string }) =>
      customFetch<unknown>(`/api/customers/${customerId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Prepayment recorded');
      requestIdRef.current = newRequestId();
      setOpen(false);
      setAmount('');
      setReference('');
      qc.invalidateQueries({ queryKey: customerCreditsKey(customerId) });
    },
    // Keep the same requestId so a retry is idempotent server-side.
    onError: (err: any) => toast.error(err?.data?.error ?? err?.message ?? 'Could not record prepayment. Retry is safe.'),
  });

  const parsed = Number(amount);
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number.isFinite(parsed) && parsed > 0;
  const refValid = reference.trim().length > 0;

  const openDialog = () => {
    requestIdRef.current = newRequestId();
    setAmount('');
    setReference('');
    setOpen(true);
  };

  const submit = () => {
    if (!amountValid || !refValid || record.isPending) return;
    record.mutate({ amount: Math.round(parsed * 100) / 100, reference: reference.trim(), requestId: requestIdRef.current });
  };

  const entries = data?.entries ?? [];

  return (
    <Card data-testid="card-customer-credits">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><Wallet className="w-4 h-4" /> Prepaid credit</CardTitle>
          <CardDescription>Funds already received, applied automatically to new invoices.</CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Balance</p>
            {isLoading ? (
              <div className="h-7 w-20 rounded bg-muted animate-pulse" />
            ) : isError ? (
              <p className="text-sm text-muted-foreground">Unavailable</p>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-emerald-700" data-testid="text-credit-balance">{money(data?.balance ?? 0)}</p>
            )}
          </div>
          {canRecord && (
            <Button size="sm" className="gap-1.5" onClick={openDialog} data-testid="button-record-prepayment">
              <Plus className="w-3.5 h-3.5" /> Record prepayment
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">{[0, 1].map(i => <div key={i} className="h-9 rounded bg-muted/60 animate-pulse" />)}</div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> Could not load credit history.</span>
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => refetch()} data-testid="button-retry-credits"><RefreshCw className="w-3.5 h-3.5" /> Retry</Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-3 text-center">No prepaid credit on file.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {entries.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`row-credit-${e.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}{e.invoiceId != null ? ` · Invoice #${e.invoiceId}` : ''}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {new Date(e.createdAt).toLocaleDateString()}{e.reference ? ` · ${e.reference}` : ''}
                  </p>
                </div>
                <span className={`tabular-nums font-semibold ${e.amount >= 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                  {e.amount >= 0 ? '+' : '-'}{money(e.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={o => { if (!record.isPending) setOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record prepayment</DialogTitle>
            <DialogDescription>
              Log money you have already received (check, cash, transfer). This does not charge any card.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Amount received</label>
              <Input type="number" min={0.01} step={0.01} inputMode="decimal" placeholder="0.00" value={amount}
                onChange={e => setAmount(e.target.value)} data-testid="input-prepayment-amount" />
              {amount && !amountValid && <p className="text-xs text-destructive">Enter a positive dollar amount.</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Payment reference <span className="text-destructive">*</span></label>
              <Input placeholder="e.g. Check #1042, Zelle 3/14" value={reference} maxLength={200}
                onChange={e => setReference(e.target.value)} data-testid="input-prepayment-reference" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={record.isPending}>Cancel</Button>
            <Button onClick={submit} disabled={!amountValid || !refValid || record.isPending} data-testid="button-submit-prepayment">
              {record.isPending ? 'Recording…' : record.isError ? 'Retry' : 'Record credit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
