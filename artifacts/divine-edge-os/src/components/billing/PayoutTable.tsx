import type { PlatformPayout } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cents, REVERSED } from '@/lib/softwareBilling';
import { format } from 'date-fns';

function Money({ v }: { v: number | null }) {
  return v == null ? <span className="text-muted-foreground italic">pending</span> : <>{cents(v)}</>;
}

export function payoutStatusTone(status: string) {
  if (status === 'paid' || status === 'succeeded' || status === 'transferred') return 'bg-primary/10 text-primary border-primary/20';
  if (REVERSED(status)) return 'bg-destructive/10 text-destructive border-destructive/20';
  if (status.includes('pending')) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-muted text-muted-foreground';
}

/** Earned = payouts with a known amount that were not reversed/refunded. */
export function earnedPlatformFees(payouts: PlatformPayout[]) {
  return payouts.filter(p => !REVERSED(p.status) && p.platformFeeCents != null).reduce((s, p) => s + (p.platformFeeCents ?? 0), 0);
}

export function PayoutTable({ payouts, showTenant, onRetry, retryingId }: {
  payouts: PlatformPayout[]; showTenant?: boolean;
  onRetry?: (id: string) => void; retryingId?: string | null;
}) {
  if (payouts.length === 0) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="empty-payouts">No online payments have been processed yet.</div>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            {showTenant && <TableHead>Business</TableHead>}
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Stripe fee</TableHead>
            <TableHead className="text-right">Platform fee</TableHead>
            <TableHead className="text-right">Business payout</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last error</TableHead>
            {onRetry && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {payouts.map(p => {
            const reversed = REVERSED(p.status);
            const retryable = p.status === 'pending' || p.status === 'reversal_pending';
            return (
              <TableRow key={p.paymentIntentId} data-testid={`row-payout-${p.paymentIntentId}`} className={reversed ? 'opacity-70' : ''}>
                <TableCell className="whitespace-nowrap text-xs">{format(new Date(p.createdAt), 'MMM d, yyyy')}</TableCell>
                {showTenant && <TableCell className="text-xs">#{p.tenantId}</TableCell>}
                <TableCell className={`text-right tabular-nums ${reversed ? 'line-through' : ''}`}>{cents(p.amountCents)}</TableCell>
                <TableCell className="text-right tabular-nums"><Money v={p.processorFeeCents} /></TableCell>
                <TableCell className="text-right tabular-nums"><Money v={p.platformFeeCents} /></TableCell>
                <TableCell className="text-right tabular-nums font-medium"><Money v={p.payoutCents} /></TableCell>
                <TableCell><Badge variant="outline" className={payoutStatusTone(p.status)}>{p.status.replace(/_/g, ' ')}</Badge></TableCell>
                <TableCell className="text-xs text-destructive max-w-[220px] truncate" title={p.lastError ?? ''}>{p.lastError ?? '—'}</TableCell>
                {onRetry && (
                  <TableCell>
                    {retryable && (
                      <Button size="sm" variant="outline" disabled={retryingId === p.paymentIntentId}
                        onClick={() => onRetry(p.paymentIntentId)} data-testid={`button-retry-${p.paymentIntentId}`}>
                        {retryingId === p.paymentIntentId ? 'Retrying…' : 'Retry'}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
