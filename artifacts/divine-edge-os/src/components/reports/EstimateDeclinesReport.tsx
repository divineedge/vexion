import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface DeclineReport {
  total: number;
  byReason: { reason: string; count: number }[];
  estimates: { id: number; estimateNumber: string | null; customerName: string | null; declinedAt: string | null; reason: string | null; comment: string | null; total: number }[];
}

function initialRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
  return { from, to: now.toISOString().slice(0, 10) };
}

export default function EstimateDeclinesReport() {
  const [r, setR] = useState(initialRange());
  const q = useQuery({
    queryKey: ['estimate-declines-report', r.from, r.to],
    queryFn: () => customFetch<DeclineReport>(`/api/reports/estimate-declines?from=${r.from}&to=${r.to}`),
  });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><label className="text-xs text-muted-foreground">From</label><Input type="date" value={r.from} onChange={e => setR({ ...r, from: e.target.value })} /></div>
        <div className="space-y-1"><label className="text-xs text-muted-foreground">To</label><Input type="date" value={r.to} onChange={e => setR({ ...r, to: e.target.value })} /></div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => q.refetch()}><RefreshCw className="w-4 h-4" />Refresh</Button>
      </div>
      {q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />)}</div>
      ) : q.isError ? (
        <Card><CardContent className="py-8 text-center space-y-3"><p className="text-sm text-muted-foreground">Could not load the decline report.</p><Button size="sm" onClick={() => q.refetch()}>Try again</Button></CardContent></Card>
      ) : !d || d.total === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No estimates were declined in this period.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">By reason</CardTitle><CardDescription>{d.total} declined estimate{d.total === 1 ? '' : 's'}</CardDescription></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
                <TableBody>
                  {d.byReason.map(b => (
                    <TableRow key={b.reason}><TableCell>{b.reason}</TableCell><TableCell className="text-right tabular-nums">{b.count}</TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{((b.count / d.total) * 100).toFixed(1)}%</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Declined estimates</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Estimate</TableHead><TableHead>Customer</TableHead><TableHead>Declined</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {d.estimates.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.estimateNumber ?? `#${e.id}`}</TableCell>
                      <TableCell>{e.customerName ?? '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{e.declinedAt ? format(new Date(e.declinedAt), 'MMM d, yyyy') : '-'}</TableCell>
                      <TableCell><div>{e.reason ?? 'No reason given'}</div>{e.comment && <div className="text-xs text-muted-foreground max-w-xs">{e.comment}</div>}</TableCell>
                      <TableCell className="text-right tabular-nums">${Number(e.total ?? 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
