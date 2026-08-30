import { useState } from 'react';
import { format } from 'date-fns';
import {
  getListShrinkageReportsQueryKey,
  useListShrinkageReports,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function formatCurrency(value: number | null | undefined) {
  if (value == null) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ShrinkageReport() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const params = { ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) };
  const { data: ledger, isLoading } = useListShrinkageReports(params, {
    query: { queryKey: getListShrinkageReportsQueryKey(params) },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">From</label>
            <Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">To</label>
            <Input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} />
          </div>
        </div>
        <div className="rounded-lg border px-4 py-2 text-right">
          <p className="text-xs text-muted-foreground">Cumulative Loss</p>
          <p className="text-lg font-bold text-destructive">{formatCurrency(ledger?.totalLoss ?? 0)}</p>
        </div>
      </div>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="text-right">Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell>
              </TableRow>
            )}
            {!isLoading && (ledger?.lines.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No shrinkage recorded in this range.</TableCell>
              </TableRow>
            )}
            {ledger?.lines.map(line => (
              <TableRow key={line.id}>
                <TableCell className="text-xs">{format(new Date(line.createdAt), 'MMM d, yyyy')}</TableCell>
                <TableCell className="font-medium">{line.itemName}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{line.sku}</TableCell>
                <TableCell className="text-right">{line.expectedStock}</TableCell>
                <TableCell className="text-right">{line.actualCount}</TableCell>
                <TableCell className={`text-right font-mono ${line.variance < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                  {line.variance > 0 ? '+' : ''}{line.variance}
                </TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(line.totalLoss)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}