import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { Receipt, AlertTriangle, RefreshCw } from 'lucide-react';

interface Deposit {
  id: number;
  estimateNumber: string | null;
  total: number;
  paymentRequirement: string | null;
  depositValue: number | null;
  depositPaidAt: string | null;
  depositChargedAmount: number | null;
  convertedToJobId: number | null;
  invoiceId: number | null;
}

const money = (n: number | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;

export function CustomerDepositsCard({ customerId }: { customerId: number }) {
  const { canManageOffice } = useAuth();
  if (!canManageOffice) return null;
  return <CustomerDepositsCardInner customerId={customerId} />;
}

function CustomerDepositsCardInner({ customerId }: { customerId: number }) {
  const q = useQuery<Deposit[]>({
    queryKey: ['customer-deposits', customerId],
    queryFn: async () => (await customFetch<{ deposits: Deposit[] }>(`/api/customers/${customerId}/deposits`)).deposits ?? [],
    enabled: customerId > 0,
  });
  const deposits = q.data ?? [];
  return (
    <Card data-testid="card-customer-deposits">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />Estimate deposits</CardTitle>
        <CardDescription>Deposit receipts tied to estimates. These are separate from prepaid credit and are applied to the matching invoice.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : q.isError ? (
          <div className="flex items-center justify-between text-sm text-destructive">
            <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Could not load deposits.</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => q.refetch()}><RefreshCw className="w-3.5 h-3.5" />Retry</Button>
          </div>
        ) : deposits.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No estimate deposits on record.</p>
        ) : (
          <div className="divide-y">
            {deposits.map(d => {
              const paid = !!d.depositPaidAt;
              return (
                <div key={d.id} className="py-2.5 flex flex-wrap items-center gap-3 text-sm" data-testid={`row-deposit-${d.id}`}>
                  <div className="flex-1 min-w-[10rem]">
                    <p className="font-medium">Estimate {d.estimateNumber ?? `#${d.id}`}</p>
                    <p className="text-xs text-muted-foreground">
                      Estimate total {money(d.total)}
                      {d.paymentRequirement ? ` · ${d.paymentRequirement.replace(/_/g, ' ')}` : ''}
                      {d.depositValue != null ? ` · ${d.paymentRequirement === 'percent' ? `${d.depositValue}%` : money(d.depositValue)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{paid ? money(d.depositChargedAmount) : '—'}</p>
                    <p className="text-xs text-muted-foreground">{paid ? new Date(d.depositPaidAt as string).toLocaleDateString() : 'Awaiting payment'}</p>
                  </div>
                  <Badge variant="outline" className={paid ? 'text-emerald-700 border-emerald-300' : 'text-amber-700 border-amber-300'}>{paid ? 'Paid' : 'Unpaid'}</Badge>
                  <div className="flex gap-2 text-xs">
                    {d.convertedToJobId && <span className="text-muted-foreground">Job #{d.convertedToJobId}</span>}
                    {d.invoiceId && <span className="text-muted-foreground">Invoice #{d.invoiceId}</span>}
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

export default CustomerDepositsCard;
