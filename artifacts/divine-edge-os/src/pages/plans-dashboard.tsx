import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useGetPlansDashboard, getGetPlansDashboardQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PlanTemplatesSettings from '@/components/settings/PlanTemplatesSettings';
import { DollarSign, Repeat, AlertTriangle, CalendarClock, ChevronRight, Search, LayoutDashboard, Settings2 } from 'lucide-react';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-100 text-amber-700 border-amber-200',
  cancelled: 'bg-muted text-muted-foreground',
  pending_renewal: 'bg-blue-100 text-blue-700 border-blue-200',
};

export default function PlansDashboardPage() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState('all');
  const [planSearch, setPlanSearch] = useState('');
  const { data, isLoading } = useGetPlansDashboard({ query: { queryKey: getGetPlansDashboardQueryKey() } });

  const cards = [
    { label: 'Active Plans', value: data?.activeCount ?? 0, icon: Repeat, color: 'text-primary bg-primary/10' },
    { label: 'Monthly Recurring Revenue', value: `$${(data?.mrr ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: DollarSign, color: 'text-emerald-600 bg-emerald-500/10' },
    { label: `Expiring in ${(data as any)?.renewalWarningDays ?? 30} Days`, value: data?.expiringSoonCount ?? 0, icon: CalendarClock, color: 'text-blue-600 bg-blue-500/10' },
    { label: 'Overdue Billing', value: data?.overdueCount ?? 0, icon: AlertTriangle, color: 'text-red-600 bg-red-500/10' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Service Plans</h1>
        <p className="text-muted-foreground mt-1">Manage recurring plan templates and track every active customer plan.</p>
      </div>

      <Tabs defaultValue="active-plans">
        <TabsList>
          <TabsTrigger value="active-plans" className="gap-2">
            <LayoutDashboard className="w-3.5 h-3.5" /> Active Plans
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2">
            <Settings2 className="w-3.5 h-3.5" /> Plan Templates
          </TabsTrigger>
        </TabsList>

        {/* ── Active Plans tab — KPI cards + customer plan table ── */}
        <TabsContent value="active-plans" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {cards.map(c => (
              <Card key={c.label}>
                <CardContent className="p-6 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${c.color}`}>
                    <c.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" title={`${c.label}: ${c.value}`}>{c.value}</p>
                    <p className="text-sm text-muted-foreground">{c.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                  <Input
                    title="Search by customer name or plan name"
                    placeholder="Search customer or plan…"
                    value={planSearch}
                    onChange={e => setPlanSearch(e.target.value)}
                    className="h-9 text-sm pl-7 w-56"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44 h-9" title="Filter by plan status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="pending_renewal">Pending Renewal</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                  ) : (data?.plans ?? []).filter(p => statusFilter === 'all' || p.status === statusFilter).filter(p => !planSearch || p.customerName?.toLowerCase().includes(planSearch.toLowerCase()) || p.templateName?.toLowerCase().includes(planSearch.toLowerCase())).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No plans match the selected filter.</TableCell></TableRow>
                  ) : (data?.plans ?? []).filter(p => statusFilter === 'all' || p.status === statusFilter).filter(p => !planSearch || p.customerName?.toLowerCase().includes(planSearch.toLowerCase()) || p.templateName?.toLowerCase().includes(planSearch.toLowerCase())).map(p => (
                    <TableRow key={p.id} className={`cursor-pointer hover:bg-muted/50 ${p.isOverdue ? 'bg-red-50/40' : (!p.isOverdue && (p as any).daysUntilRenewal != null && (p as any).daysUntilRenewal >= 0 && (p as any).daysUntilRenewal <= ((data as any)?.renewalWarningDays ?? 30) ? 'bg-blue-50/30' : '')}`} onClick={() => navigate(`/plans/${p.id}`)}>
                      <TableCell className="font-medium" title={p.customerName ?? undefined}>{p.customerName}</TableCell>
                      <TableCell title={p.templateName ?? undefined}>{p.templateName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={p.propertyAddress ?? undefined}>{p.propertyAddress}</TableCell>
                      <TableCell className="text-right" title={`Billing price: $${p.billingPrice.toFixed(2)}`}>${p.billingPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-sm" title={p.nextBillingDate ? `Next billing: ${p.nextBillingDate}` : undefined}>
                        {p.nextBillingDate}
                        {p.isOverdue && <Badge variant="outline" className="ml-2 text-xs bg-red-100 text-red-700 border-red-200" title="Renewal is overdue">Overdue</Badge>}
                        {!p.isOverdue && (p as any).daysUntilRenewal != null && (p as any).daysUntilRenewal <= ((data as any)?.renewalWarningDays ?? 30) && (p as any).daysUntilRenewal >= 0 && (
                          <Badge variant="outline" className="ml-2 text-xs bg-blue-50 text-blue-700 border-blue-200" title={`Renews in ${(p as any).daysUntilRenewal} days`}>Renews in {(p as any).daysUntilRenewal}d</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={STATUS_STYLE[p.status] ?? ''} title={`Plan status: ${p.status.replace('_', ' ')}`}>{p.status.replace('_', ' ')}</Badge>
                      </TableCell>
                      <TableCell><ChevronRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Plan Templates tab — CRUD for sellable plan templates ── */}
        <TabsContent value="templates" className="mt-4">
          <PlanTemplatesSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
