import React, { useState } from 'react';
import {
  useGetJobProfitabilityReport,
  useGetEmployeeRevenueReport,
  useGetPlStatementReport,
  useGetAgingInvoicesReport,
  useGetSalesTaxReport,
  useListCrews, getListCrewsQueryKey,
  useListUsers, getListUsersQueryKey,
} from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Briefcase, Users, ScrollText, Clock3, Percent, Download, Printer,
  RefreshCw, ShieldAlert,
} from 'lucide-react';
import { format } from 'date-fns';
import { downloadCsv } from '@/lib/csvExport';

function defaultRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

function money(n: number | undefined | null) {
  return `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

const REPORTS = [
  { id: 'job-profitability', label: 'Job Profitability', icon: Briefcase, description: 'Revenue, cost, and margin for every completed job.' },
  { id: 'employee-revenue', label: 'Employee Revenue', icon: Users, description: 'Revenue and P4P earnings generated per technician.' },
  { id: 'pl-statement', label: 'P&L Statement', icon: ScrollText, description: 'Revenue, cost of goods sold, and net income for a period.' },
  { id: 'aging-invoices', label: 'Aging Invoices', icon: Clock3, description: 'Open invoices grouped by how overdue they are.' },
  { id: 'sales-tax', label: 'Sales Tax', icon: Percent, description: 'Taxable revenue and tax collected, by month.' },
] as const;

export default function ReportsPage() {
  const { canManageOffice } = useAuth();
  const [active, setActive] = useState<typeof REPORTS[number]['id']>('job-profitability');

  if (!canManageOffice) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <ShieldAlert className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Reports are restricted</h2>
        <p className="text-muted-foreground max-w-sm">Only owners and managers can view business reports.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 print:space-y-2">
      <div className="print:hidden">
        <h1 className="text-3xl font-bold tracking-tight">Business Reports</h1>
        <p className="text-muted-foreground mt-1">Job profitability, payroll, P&amp;L, aging, and sales tax — all in one matrix.</p>
      </div>

      {/* Report matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 print:hidden">
        {REPORTS.map(r => (
          <Card
            key={r.id}
            className={`cursor-pointer transition-colors hover:border-primary/50 ${active === r.id ? 'border-primary ring-1 ring-primary' : ''}`}
            onClick={() => setActive(r.id)}
          >
            <CardContent className="p-4 space-y-2">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${active === r.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                <r.icon className="w-4 h-4" />
              </div>
              <p className="font-semibold text-sm">{r.label}</p>
              <p className="text-xs text-muted-foreground leading-snug">{r.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={active} onValueChange={v => setActive(v as typeof active)}>
        <TabsList className="hidden">
          {REPORTS.map(r => <TabsTrigger key={r.id} value={r.id}>{r.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="job-profitability"><JobProfitabilityReport /></TabsContent>
        <TabsContent value="employee-revenue"><EmployeeRevenueReport /></TabsContent>
        <TabsContent value="pl-statement"><PlStatementReport /></TabsContent>
        <TabsContent value="aging-invoices"><AgingInvoicesReport /></TabsContent>
        <TabsContent value="sales-tax"><SalesTaxReport /></TabsContent>
      </Tabs>
    </div>
  );
}

function GeneratedBadge({ generatedAt, cached }: { generatedAt?: string; cached?: boolean }) {
  if (!generatedAt) return null;
  return (
    <Badge variant="secondary" className="font-normal text-xs gap-1">
      <RefreshCw className="w-3 h-3" /> Generated {format(new Date(generatedAt), 'MMM d, h:mm a')}{cached ? ' (cached)' : ''}
    </Badge>
  );
}

// ── Report A: Job Profitability ────────────────────────────────────────────
function JobProfitabilityReport() {
  const { start, end } = defaultRange();
  const [startDate, setStartDate] = useState(start);
  const [endDate, setEndDate] = useState(end);
  const [crewId, setCrewId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const { data: crews = [] } = useListCrews({ query: { queryKey: getListCrewsQueryKey() } });
  const { data: users = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });

  const params = { startDate, endDate, ...(crewId ? { crewId: Number(crewId) } : {}), ...(assigneeId ? { assigneeId: Number(assigneeId) } : {}) };
  const { data, isFetching, refetch } = useGetJobProfitabilityReport(params);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv('job-profitability.csv', data.rows.map(r => ({
      job: r.jobTitle, customer: r.customerName ?? '', completedAt: r.completedAt, crew: r.crewName ?? '',
      assignee: r.assigneeName ?? '', property: r.propertyAddress ?? '', revenue: r.revenue, partsCost: r.partsCost,
      laborCost: r.laborCost, fuelCost: r.fuelCost, netProfit: r.netProfit, marginPct: r.marginPct,
    })));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle>Job Profitability</CardTitle>
          <CardDescription>Parts cost and labor use the P4P engine; fuel is allocated evenly across jobs in range.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <Button size="sm" variant="outline" className="gap-2" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Start"><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Field label="Crew">
            <Select value={crewId || '__all__'} onValueChange={v => setCrewId(v === '__all__' ? '' : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All crews" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All crews</SelectItem>
                {crews.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Technician">
            <Select value={assigneeId || '__all__'} onValueChange={v => setAssigneeId(v === '__all__' ? '' : v)}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All technicians" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All technicians</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Button size="sm" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="Revenue" value={money(data.totals.revenue)} />
              <Stat label="Parts Cost" value={money(data.totals.partsCost)} />
              <Stat label="Labor Cost" value={money(data.totals.laborCost)} />
              <Stat label="Fuel Cost" value={money(data.totals.fuelCost)} />
              <Stat label="Net Profit" value={money(data.totals.netProfit)} highlight />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead><TableHead>Customer</TableHead><TableHead>Crew</TableHead><TableHead>Technician</TableHead>
                  <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Parts</TableHead>
                  <TableHead className="text-right">Labor</TableHead><TableHead className="text-right">Fuel</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead><TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map(r => (
                  <TableRow key={r.jobId}>
                    <TableCell className="font-medium">{r.jobTitle}</TableCell>
                    <TableCell className="text-muted-foreground">{r.customerName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{r.crewName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{r.assigneeName ?? '—'}</TableCell>
                    <TableCell className="text-right">{money(r.revenue)}</TableCell>
                    <TableCell className="text-right">{money(r.partsCost)}</TableCell>
                    <TableCell className="text-right">{money(r.laborCost)}</TableCell>
                    <TableCell className="text-right">{money(r.fuelCost)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.netProfit < 0 ? 'text-destructive' : ''}`}>{money(r.netProfit)}</TableCell>
                    <TableCell className={`text-right ${r.marginPct < 0 ? 'text-destructive' : 'text-emerald-600'}`}>{r.marginPct}%</TableCell>
                  </TableRow>
                ))}
                {data.rows.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No completed jobs in this range.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Report B: Employee Revenue ─────────────────────────────────────────────
function EmployeeRevenueReport() {
  const { start, end } = defaultRange();
  const [startDate, setStartDate] = useState(start);
  const [endDate, setEndDate] = useState(end);
  const { data, isFetching, refetch } = useGetEmployeeRevenueReport({ startDate, endDate });

  const exportCsv = () => {
    if (!data) return;
    downloadCsv('employee-revenue.csv', data.rows.map(r => ({
      name: r.name, jobs: r.jobCount, revenue: r.totalRevenue, avgJobValue: r.averageJobValue,
      p4pEarnings: r.totalP4pEarnings, p4pToRevenueRatioPct: r.p4pToRevenueRatioPct,
    })));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle>Employee Revenue</CardTitle>
          <CardDescription>Revenue and P4P earnings generated by each technician in the selected period.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <Button size="sm" variant="outline" className="gap-2" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Start"><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Button size="sm" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
        </div>

        {data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Technician</TableHead><TableHead className="text-right">Jobs</TableHead>
                <TableHead className="text-right">Total Revenue</TableHead><TableHead className="text-right">Avg Job Value</TableHead>
                <TableHead className="text-right">P4P Earnings</TableHead><TableHead className="text-right">P4P / Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(r => (
                <TableRow key={r.userId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">{r.jobCount}</TableCell>
                  <TableCell className="text-right">{money(r.totalRevenue)}</TableCell>
                  <TableCell className="text-right">{money(r.averageJobValue)}</TableCell>
                  <TableCell className="text-right">{money(r.totalP4pEarnings)}</TableCell>
                  <TableCell className="text-right">{r.p4pToRevenueRatioPct}%</TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No completed jobs in this range.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Report C: P&L Statement ────────────────────────────────────────────────
function PlStatementReport() {
  const { start, end } = defaultRange();
  const [startDate, setStartDate] = useState(start);
  const [endDate, setEndDate] = useState(end);
  const { data, isFetching, refetch } = useGetPlStatementReport({ startDate, endDate });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle>P&amp;L Statement</CardTitle>
          <CardDescription>Revenue is recognized on paid invoices; cost of goods sold is derived from the jobs they bill.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <Button size="sm" variant="outline" className="gap-2" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Start"><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Button size="sm" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
        </div>

        {data && (
          <div className="max-w-xl space-y-1 border rounded-lg divide-y">
            <PlRow label="Revenue" value={data.revenue} bold />
            <PlRow label="Cost of Goods Sold" value={-data.costOfGoodsSold.total} indent />
            <PlRow label="— Parts" value={-data.costOfGoodsSold.partsCost} indent2 />
            <PlRow label="— Labor (P4P)" value={-data.costOfGoodsSold.laborCost} indent2 />
            <PlRow label="— Fuel" value={-data.costOfGoodsSold.fuelCost} indent2 />
            <PlRow label="Gross Profit" value={data.grossProfit} bold />
            <PlRow label="Operating Expenses" value={-data.operatingExpenses.total} indent />
            {data.operatingExpenses.byCategory.map(c => (
              <PlRow key={c.category} label={`— ${c.category}`} value={-c.amount} indent2 />
            ))}
            <PlRow label="Net Income" value={data.netIncome} bold highlight />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlRow({ label, value, bold, indent, indent2, highlight }: { label: string; value: number; bold?: boolean; indent?: boolean; indent2?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between px-4 py-2 ${bold ? 'font-semibold' : ''} ${highlight ? 'bg-primary/5' : ''} ${indent2 ? 'pl-8 text-sm text-muted-foreground' : indent ? 'pl-6' : ''}`}>
      <span>{label}</span>
      <span className={value < 0 ? 'text-destructive' : ''}>{value < 0 ? `(${money(Math.abs(value))})` : money(value)}</span>
    </div>
  );
}

// ── Report D: Aging Invoices ───────────────────────────────────────────────
const BUCKET_ORDER = ['current', '1-30', '31-60', '61-90', '90+'] as const;

function AgingInvoicesReport() {
  const { data, isFetching, refetch } = useGetAgingInvoicesReport();

  const exportCsv = () => {
    if (!data) return;
    const rows = BUCKET_ORDER.flatMap(key => {
      const bucket = (data.buckets as Record<string, typeof data.buckets.current>)[key];
      if (!bucket) return [];
      return bucket.invoices.map(inv => ({
        bucket: bucket.label, invoice: inv.invoiceNumber, customer: inv.customerName ?? '',
        total: inv.total, dueDate: inv.dueDate ?? '', daysOverdue: inv.daysOverdue,
      }));
    });
    downloadCsv('aging-invoices.csv', rows);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle>Aging Invoices</CardTitle>
          <CardDescription>Open invoices grouped by how far past their due date they are.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <Button size="sm" variant="outline" className="gap-2" onClick={() => refetch()} disabled={isFetching}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {BUCKET_ORDER.map(key => {
                const bucket = (data.buckets as Record<string, typeof data.buckets.current>)[key];
                if (!bucket) return null;
                return <Stat key={key} label={bucket.label} value={money(bucket.total)} highlight={key === '90+'} />;
              })}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Days Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BUCKET_ORDER.flatMap(key => {
                  const bucket = (data.buckets as Record<string, typeof data.buckets.current>)[key];
                  if (!bucket) return [];
                  return bucket.invoices.map((inv) => (
                    <TableRow key={inv.invoiceId}>
                      <TableCell><Badge variant="secondary" className="font-normal">{bucket.label}</Badge></TableCell>
                      <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.customerName ?? '—'}</TableCell>
                      <TableCell className="text-right">{money(inv.total)}</TableCell>
                      <TableCell>{inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell className="text-right">{inv.daysOverdue}</TableCell>
                    </TableRow>
                  ));
                })}
                {data.totalOutstanding === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No open invoices.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Report E: Sales Tax ────────────────────────────────────────────────────
function SalesTaxReport() {
  const { start, end } = defaultRange();
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(end);
  const { data, isFetching, refetch } = useGetSalesTaxReport({ startDate, endDate });

  const exportCsv = () => {
    if (!data) return;
    downloadCsv('sales-tax.csv', data.rows.map(r => ({ month: r.month, taxableRevenue: r.taxableRevenue, taxCollected: r.taxCollected, effectiveRatePct: r.effectiveTaxRatePct })));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle>Sales Tax Tracker</CardTitle>
          <CardDescription>Taxable revenue and tax collected on paid invoices, by month.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <Button size="sm" variant="outline" className="gap-2" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Start"><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Button size="sm" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <Stat label="Taxable Revenue" value={money(data.totals.taxableRevenue)} />
              <Stat label="Tax Collected" value={money(data.totals.taxCollected)} highlight />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead><TableHead className="text-right">Taxable Revenue</TableHead>
                  <TableHead className="text-right">Tax Collected</TableHead><TableHead className="text-right">Effective Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map(r => (
                  <TableRow key={r.month}>
                    <TableCell className="font-medium">{r.month}</TableCell>
                    <TableCell className="text-right">{money(r.taxableRevenue)}</TableCell>
                    <TableCell className="text-right">{money(r.taxCollected)}</TableCell>
                    <TableCell className="text-right">{r.effectiveTaxRatePct}%</TableCell>
                  </TableRow>
                ))}
                {data.rows.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No paid invoices in this range.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'bg-primary/5 border-primary/30' : ''}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold mt-0.5 ${highlight ? 'text-primary' : ''}`}>{value}</p>
    </div>
  );
}
