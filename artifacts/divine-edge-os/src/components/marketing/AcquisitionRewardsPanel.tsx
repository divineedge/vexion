import { Link } from 'wouter';
import { format } from 'date-fns';
import { Gift } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAcquisitionRewards, useDoorHangers, money } from '@/lib/acquisition';

export default function AcquisitionRewardsPanel() {
  const { data: rewards, isLoading, isError, refetch } = useAcquisitionRewards();
  const { data: dh } = useDoorHangers(null);
  const empName = (id: number | null) => (id == null ? null : dh?.employees.find(e => e.id === id)?.name ?? `User #${id}`);
  const list = rewards ?? [];
  const empTotal = list.filter(r => r.kind === 'employee_bonus').reduce((s, r) => s + r.amount, 0);
  const refTotal = list.filter(r => r.kind === 'referral_credit').reduce((s, r) => s + r.amount, 0);

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;
  if (isError) return <div className="border rounded-lg p-6 text-center text-sm space-y-2"><p className="text-destructive">Could not load rewards.</p><Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="p-4"><p className="text-2xl font-bold" data-testid="text-rewards-count">{list.length}</p><p className="text-xs text-muted-foreground">Earned rewards recorded</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-2xl font-bold">{money(empTotal)}</p><p className="text-xs text-muted-foreground">Employee bonuses earned (paid via payroll)</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-2xl font-bold">{money(refTotal)}</p><p className="text-xs text-muted-foreground">Referral credits earned</p></CardContent></Card>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Earned</TableHead><TableHead>Kind</TableHead><TableHead>New customer</TableHead><TableHead>Recipient</TableHead><TableHead>Invoice</TableHead><TableHead className="text-right">Earned amount</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {list.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground"><Gift className="w-8 h-8 mx-auto mb-2 opacity-40" />No rewards earned yet. Rewards appear when an attributed customer's first invoice is paid.</TableCell></TableRow>
              ) : list.map(r => (
                <TableRow key={r.id} data-testid={`row-reward-${r.id}`}>
                  <TableCell className="text-sm">{format(new Date(r.earnedAt), 'MMM d, yyyy')}</TableCell>
                  <TableCell><Badge variant="outline">{r.kind === 'employee_bonus' ? 'Employee bonus' : 'Referral credit'}</Badge></TableCell>
                  <TableCell>{r.customerId ? <Link href={`/customers/${r.customerId}`} className="text-primary hover:underline">Customer #{r.customerId}</Link> : '—'}</TableCell>
                  <TableCell>{r.recipientCustomerId ? <Link href={`/customers/${r.recipientCustomerId}`} className="text-primary hover:underline">Customer #{r.recipientCustomerId}</Link> : empName(r.recipientUserId) ?? '—'}</TableCell>
                  <TableCell>{r.invoiceId ? <Link href={`/invoices?highlight=${r.invoiceId}`} className="text-primary hover:underline">Invoice #{r.invoiceId}</Link> : '—'}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
