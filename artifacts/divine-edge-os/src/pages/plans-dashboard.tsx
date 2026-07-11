import React from 'react';
import { useLocation } from 'wouter';
import { useGetPlansDashboard, getGetPlansDashboardQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign, Repeat, AlertTriangle, CalendarClock, ChevronRight } from 'lucide-react';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-100 text-amber-700 border-amber-200',
  cancelled: 'bg-muted text-muted-foreground',
  pending_renewal: 'bg-blue-100 text-blue-700 border-blue-200',
};

export default function PlansDashboardPage() {
  const [, navigate] = useLocation();
  const { data, isLoading } = useGetPlansDashboard({ query: { queryKey: getGetPlansDashboardQueryKey() } });

  const cards = [
    { label: 'Active Plans', value: data?.activeCount ?? 0, icon: Repeat, color: 'text-primary bg-primary/10' },
    { label: 'Monthly Recurring Revenue', value: `$${(data?.mrr ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: DollarSign, color: 'text-emerald-600 bg-emerald-500/10' },
    { label: 'Expiring in 30 Days', value: data?.expiringSoonCount ?? 0, icon: CalendarClock, color: 'text-blue-600 bg-blue-500/10' },
    { label: 'Overdue Billing', value: data?.overdueCount ?? 0, icon: AlertTriangle, color: 'text-red-600 bg-red-500/10' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Service Plans</h1>
        <p className="text-muted-foreground mt-1">Overview of every active recurring plan, billing status, and renewal automation.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map(c => (
          <Card key={c.label}>
            <CardContent className="p-6 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${c.color}`}>
                <c.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{c.value}</p>
                <p className="text-sm text-muted-foreground">{c.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Property</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Next Billing</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : (data?.plans ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  <Repeat className="w-8 h-8 mx-auto mb-2 opacity-30" />No plans sold yet.
                </TableCell></TableRow>
              ) : (data?.plans ?? []).map(p => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/plans/${p.id}`)}>
                  <TableCell className="font-medium">{p.customerName}</TableCell>
                  <TableCell>{p.templateName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.propertyAddress}</TableCell>
                  <TableCell className="text-right">${p.billingPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-sm">
                    {p.nextBillingDate}
                    {p.isOverdue && <Badge variant="outline" className="ml-2 text-xs bg-red-100 text-red-700 border-red-200">Overdue</Badge>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={STATUS_STYLE[p.status] ?? ''}>{p.status.replace('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell><ChevronRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
