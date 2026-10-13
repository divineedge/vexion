import React, { useState, useEffect } from 'react';
import {
  useGetJobProfitabilityReport,
  useGetEmployeeRevenueReport,
  useGetPlStatementReport,
  useGetAgingInvoicesReport,
  useGetSalesTaxReport,
  useGetInventorySalesReport,
  useGetInventoryReorderList,
  useListCrews, getListCrewsQueryKey,
  useListUsers, getListUsersQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Briefcase, Users, ScrollText, Clock3, Percent, Download, Printer, Settings,
  RefreshCw, ShieldAlert, Package, Search, X, ShoppingCart, Building2, CheckSquare, Square, AlertTriangle,
  TrendingUp, Gauge, ThumbsDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { downloadCsv } from '@/lib/csvExport';
import EstimateDeclinesReport from '@/components/reports/EstimateDeclinesReport';

function defaultRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

function money(n: number | undefined | null) {
  return `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ── Revenue Per Hour Report ───────────────────────────────────────────────────
interface RphRow { id: number | null; name: string; revenue: number; hours: number; rph: number | null; }
interface RphData {
  dateRange: { start: string; end: string };
  company: { revenue: number; hours: number; rph: number | null };
  byService: RphRow[];
  byCrew: RphRow[];
  byEmployee: RphRow[];
}

function HourlyProductivityReport() {
  const [range, setRange] = useState(defaultRange());
  const [data, setData] = useState<RphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'service' | 'crew' | 'employee'>('service');

  useEffect(() => {
    setLoading(true);
    customFetch<RphData>(`/api/reports/revenue-per-hour?start=${range.start}&end=${range.end}`)
      .then(d => setData(d))
      .catch(() => toast.error('Failed to load Revenue Per Hour report'))
      .finally(() => setLoading(false));
  }, [range.start, range.end]);

  const rows: RphRow[] = view === 'service' ? (data?.byService ?? [])
    : view === 'crew' ? (data?.byCrew ?? [])
    : (data?.byEmployee ?? []);

  const RphTable = ({ rows: r }: { rows: RphRow[] }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{view === 'service' ? 'Service' : view === 'crew' ? 'Crew' : 'Employee'}</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead className="text-right">$/hr</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {r.length === 0 ? (
          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No completed jobs in this period</TableCell></TableRow>
        ) : r.map((row, i) => (
          <TableRow key={i}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="text-right">{money(row.revenue)}</TableCell>
            <TableCell className="text-right">{row.hours.toFixed(1)}</TableCell>
            <TableCell className="text-right">
              {row.rph != null ? (
                <span className={`font-semibold ${row.rph >= 75 ? 'text-emerald-700' : row.rph >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                  {money(row.rph)}
                </span>
              ) : <span className="text-muted-foreground">—</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <Input type="date" className="h-8 text-sm w-36" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <Input type="date" className="h-8 text-sm w-36" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} />
        </div>
        {loading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Company Summary */}
      {data && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Revenue', val: money(data.company.revenue) },
            { label: 'Billable Hours', val: `${data.company.hours.toFixed(1)} hrs` },
            { label: 'Avg $/hr', val: data.company.rph != null ? money(data.company.rph) : '—', highlight: true },
          ].map(({ label, val, highlight }) => (
            <div key={label} className={`rounded-xl border p-4 ${highlight ? 'bg-primary text-primary-foreground border-primary' : ''}`}>
              <p className={`text-xs font-medium mb-1 ${highlight ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{label}</p>
              <p className="text-2xl font-bold">{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Breakdown toggle */}
      <div className="flex gap-2">
        {(['service', 'crew', 'employee'] as const).map(v => (
          <Button key={v} size="sm" variant={view === v ? 'default' : 'outline'} className="capitalize" onClick={() => setView(v)}>
            By {v}
          </Button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        {!data ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {loading ? 'Loading…' : 'No data'}
          </div>
        ) : (
          <RphTable rows={rows} />
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Includes completed jobs only. Hours = job estimated duration. Rate = revenue ÷ hours.
        Compare your target rate from the <strong>Budget Calculator</strong> against each row to spot pricing gaps.
      </p>
    </div>
  );
}

const REPORTS = [
  { id: 'job-profitability', label: 'Job Profitability', icon: Briefcase, description: 'Revenue, cost, and margin for every completed job.' },
  { id: 'employee-revenue', label: 'Employee Revenue', icon: Users, description: 'Revenue and P4P earnings generated per technician.' },
  { id: 'pl-statement', label: 'P&L Statement', icon: ScrollText, description: 'Revenue, cost of goods sold, and net income for a period.' },
  { id: 'aging-invoices', label: 'Aging Invoices', icon: Clock3, description: 'Open invoices grouped by how overdue they are.' },
  { id: 'sales-tax', label: 'Sales Tax', icon: Percent, description: 'Taxable revenue and tax collected, by month.' },
  { id: 'inventory-sales', label: 'Inventory Sales', icon: Package, description: 'Units sold, margin, and commission per inventory item.' },
  { id: 'reorder-list', label: 'Reorder List', icon: ShoppingCart, description: 'Low-stock items grouped by supplier, ready to export as a purchase order.' },
  { id: 'hourly-productivity', label: 'Revenue / Hour', icon: Gauge, description: 'Revenue per billable hour by service, crew, and employee — compare to your budget target.' },
  { id: 'estimate-declines', label: 'Estimate Declines', icon: ThumbsDown, description: 'Why customers decline estimates, counted by reason with comments.' },
] as const;

export default function ReportsPage() {
  const { canManageOffice } = useAuth();
  const [active, setActive] = useState<(typeof REPORTS)[number]['id']>('job-profitability');

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 print:hidden">
        {REPORTS.map(r => (
          <Card
            key={r.id}
            className={`cursor-pointer transition-colors hover:border-primary/50 ${active === r.id ? 'border-primary ring-1 ring-primary' : ''}`}
            title={r.description}
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
        <TabsContent value="inventory-sales"><InventorySalesReport /></TabsContent>
        <TabsContent value="reorder-list"><ReorderListReportPanel /></TabsContent>
        <TabsContent value="hourly-productivity"><HourlyProductivityReport /></TabsContent>
        <TabsContent value="estimate-declines"><EstimateDeclinesReport /></TabsContent>
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

  const [profSort, setProfSort] = React.useState<{ col: 'revenue' | 'netProfit' | 'marginPct' | 'partsCost' | 'laborCost' | 'jobTitle' | 'customerName'; dir: 'asc' | 'desc' }>({ col: 'netProfit', dir: 'desc' });
  const [profSearch, setProfSearch] = React.useState('');

  const exportCsv = () => {
    if (!data) return;
    downloadCsv('job-profitability.csv', data.rows.map(r => ({
      job: r.jobTitle, customer: r.customerName ?? '', completedAt: r.completedAt, crew: r.crewName ?? '',
      assignee: r.assigneeName ?? '', property: r.propertyAddress ?? '', revenue: r.revenue, partsCost: r.partsCost,
      laborCost: r.laborCost, fuelCost: r.fuelCost, netProfit: r.netProfit, marginPct: r.marginPct,
    })));
  };

  const sortedProfRows = React.useMemo(() => {
    if (!data) return [];
    const filtered = profSearch ? data.rows.filter(r => r.jobTitle.toLowerCase().includes(profSearch.toLowerCase()) || (r.customerName ?? '').toLowerCase().includes(profSearch.toLowerCase())) : data.rows;
    return [...filtered].sort((a, b) => {
      let cmp: number;
      if (profSort.col === 'jobTitle') cmp = a.jobTitle.localeCompare(b.jobTitle);
      else if (profSort.col === 'customerName') cmp = (a.customerName ?? '').localeCompare(b.customerName ?? '');
      else cmp = (a[profSort.col] as number) - (b[profSort.col] as number);
      return profSort.dir === 'asc' ? cmp : -cmp;
    });
  }, [data, profSort, profSearch]);

  const PSortHead = ({ col, children, left }: { col: typeof profSort.col; children: React.ReactNode; left?: boolean }) => (
    <TableHead className={`${left ? '' : 'text-right '}cursor-pointer select-none hover:text-foreground`} onClick={() => setProfSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))}>
      {children} {profSort.col === col ? (profSort.dir === 'asc' ? '↑' : '↓') : ''}
    </TableHead>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle>Job Profitability</CardTitle>
          <CardDescription>Parts cost and labor use the P4P engine; fuel marked <span className="font-medium text-foreground">actual</span> was linked directly to that job, <span className="font-medium text-foreground">est.</span> is split evenly across unlinked jobs.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <Button size="sm" variant="outline" className="gap-2" title="Download as CSV" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" title="Export as PDF" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Preset">
            <Select value="" onValueChange={v => {
              const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
              if (v === 'thisMonth') { setStartDate(new Date(y, m, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m + 1, 0).toISOString().slice(0, 10)); }
              else if (v === 'lastMonth') { setStartDate(new Date(y, m - 1, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m, 0).toISOString().slice(0, 10)); }
              else if (v === 'thisYear') { setStartDate(`${y}-01-01`); setEndDate(`${y}-12-31`); }
              else if (v === 'lastYear') { setStartDate(`${y - 1}-01-01`); setEndDate(`${y - 1}-12-31`); }
            }}>
              <SelectTrigger className="w-36" title="Select a preset date range"><SelectValue placeholder="Quick select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thisMonth">This Month</SelectItem>
                <SelectItem value="lastMonth">Last Month</SelectItem>
                <SelectItem value="thisYear">This Year</SelectItem>
                <SelectItem value="lastYear">Last Year</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start"><Input type="date" title="Filter by start date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" title="Filter by end date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Field label="Crew">
            <Select value={crewId || '__all__'} onValueChange={v => setCrewId(v === '__all__' ? '' : v)}>
              <SelectTrigger className="w-40" title="Filter by crew"><SelectValue placeholder="All crews" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All crews</SelectItem>
                {crews.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Technician">
            <Select value={assigneeId || '__all__'} onValueChange={v => setAssigneeId(v === '__all__' ? '' : v)}>
              <SelectTrigger className="w-44" title="Filter by technician"><SelectValue placeholder="All technicians" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All technicians</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Customer / Job">
            <div className="relative">
              <Input title="Search by customer name or job title" placeholder="Search…" value={profSearch} onChange={e => setProfSearch(e.target.value)} className="w-44" />
              {profSearch && <button onClick={() => setProfSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
            </div>
          </Field>
          <Button size="sm" title="Run this report" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat label="Revenue" value={money(data.totals.revenue)} />
              <Stat label="Parts Cost" value={money(data.totals.partsCost)} />
              <Stat label="Labor Cost" value={money(data.totals.laborCost)} />
              <Stat label="Fuel Cost" value={money(data.totals.fuelCost)} />
              <Stat label="Net Profit" value={money(data.totals.netProfit)} highlight />
              {data.totals.revenue > 0 && (
                <Stat label="Net Margin" value={`${((data.totals.netProfit / data.totals.revenue) * 100).toFixed(1)}%`} highlight={data.totals.netProfit > 0} />
              )}
            </div>
            {sortedProfRows.length < (data?.rows?.length ?? 0) && (
              <p className="text-xs text-muted-foreground px-1 pb-2">Showing {sortedProfRows.length} of {data?.rows?.length} jobs</p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <PSortHead col="jobTitle" left>Job</PSortHead><PSortHead col="customerName" left>Customer</PSortHead><TableHead>Crew</TableHead><TableHead>Technician</TableHead>
                  <PSortHead col="revenue">Revenue</PSortHead><PSortHead col="partsCost">Parts</PSortHead>
                  <PSortHead col="laborCost">Labor</PSortHead><TableHead className="text-right" title="Shows actual GPS-tracked cost when available, otherwise an estimate based on distance">Fuel ⓘ</TableHead><TableHead className="text-right sr-only">Fuel source</TableHead>
                  <PSortHead col="netProfit">Net Profit</PSortHead><PSortHead col="marginPct">Margin</PSortHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedProfRows.map(r => (
                  <TableRow key={r.jobId} className="cursor-pointer hover:bg-muted/40" onClick={() => { window.location.href = `${import.meta.env.BASE_URL}schedule?jobId=${r.jobId}`; }}>
                    <TableCell className="font-medium" title={r.jobTitle}>{r.jobTitle}</TableCell>
                    <TableCell className="text-muted-foreground" title={r.customerName ?? undefined}>{r.customerName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground" title={r.crewName ?? undefined}>{r.crewName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{r.assigneeName ? <button className="hover:underline text-primary" title={r.assigneeName} onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}employees?tab=accounts`; }}>{r.assigneeName}</button> : '—'}</TableCell>
                    <TableCell className="text-right" title={`Revenue: ${money(r.revenue)}`}>{money(r.revenue)}</TableCell>
                    <TableCell className="text-right" title={`Parts cost: ${money(r.partsCost)}`}>{money(r.partsCost)}</TableCell>
                    <TableCell className="text-right" title={`Labor cost: ${money(r.laborCost)}`}>{money(r.laborCost)}</TableCell>
                    <TableCell className="text-right" title={`Fuel cost: ${money(r.fuelCost)}`}>{money(r.fuelCost)}</TableCell>
                    <TableCell className="text-right">
                      {(r as { fuelCostSource?: string }).fuelCostSource === 'actual'
                        ? <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300" title="Fuel cost from actual recorded fill-ups">actual</Badge>
                        : <Badge variant="outline" className="text-xs text-muted-foreground" title="Estimated fuel cost based on mileage">est.</Badge>
                      }
                    </TableCell>
                    <TableCell className={`text-right font-medium ${r.netProfit < 0 ? 'text-destructive' : ''}`} title={`Net profit: ${money(r.netProfit)}`}>{money(r.netProfit)}</TableCell>
                    <TableCell className={`text-right ${r.marginPct < 0 ? 'text-destructive' : 'text-emerald-600'}`} title={`Profit margin: ${r.marginPct}%`}>{r.marginPct}%</TableCell>
                  </TableRow>
                ))}
                {data.rows.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No completed jobs in this range.</TableCell></TableRow>
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

  const [empSort, setEmpSort] = React.useState<{ col: 'name' | 'jobCount' | 'totalRevenue' | 'averageJobValue' | 'totalP4pEarnings'; dir: 'asc' | 'desc' }>({ col: 'totalRevenue', dir: 'desc' });

  const exportCsv = () => {
    if (!data) return;
    downloadCsv('employee-revenue.csv', data.rows.map(r => ({
      name: r.name, jobs: r.jobCount, revenue: r.totalRevenue, avgJobValue: r.averageJobValue,
      p4pEarnings: r.totalP4pEarnings, p4pToRevenueRatioPct: r.p4pToRevenueRatioPct,
    })));
  };

  const sortedRows = React.useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const av = a[empSort.col] as string | number;
      const bv = b[empSort.col] as string | number;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return empSort.dir === 'asc' ? cmp : -cmp;
    });
  }, [data, empSort]);

  const SortHead = ({ col, children }: { col: typeof empSort.col; children: React.ReactNode }) => (
    <TableHead className="cursor-pointer select-none hover:text-foreground text-right" onClick={() => setEmpSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))}>
      {children} {empSort.col === col ? (empSort.dir === 'asc' ? '↑' : '↓') : ''}
    </TableHead>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">Employee Revenue {data && data.rows.length > 0 && <Badge variant="secondary" className="text-xs font-normal">{data.rows.length}</Badge>}</CardTitle>
          <CardDescription>Revenue and P4P earnings generated by each technician in the selected period.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <Button size="sm" variant="outline" className="gap-2" title="Download as CSV" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" title="Export as PDF" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Preset">
            <Select value="" onValueChange={v => {
              const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
              if (v === 'thisMonth') { setStartDate(new Date(y, m, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m + 1, 0).toISOString().slice(0, 10)); }
              else if (v === 'lastMonth') { setStartDate(new Date(y, m - 1, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m, 0).toISOString().slice(0, 10)); }
              else if (v === 'thisYear') { setStartDate(`${y}-01-01`); setEndDate(`${y}-12-31`); }
              else if (v === 'lastYear') { setStartDate(`${y - 1}-01-01`); setEndDate(`${y - 1}-12-31`); }
            }}>
              <SelectTrigger className="w-36" title="Select a preset date range"><SelectValue placeholder="Quick select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thisMonth">This Month</SelectItem>
                <SelectItem value="lastMonth">Last Month</SelectItem>
                <SelectItem value="thisYear">This Year</SelectItem>
                <SelectItem value="lastYear">Last Year</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start"><Input type="date" title="Filter by start date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" title="Filter by end date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Button size="sm" title="Run this report" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
        </div>

        {data && (() => {
          const totRevenue = data.rows.reduce((s, r) => s + r.totalRevenue, 0);
          const totJobs = data.rows.reduce((s, r) => s + r.jobCount, 0);
          const totP4p = data.rows.reduce((s, r) => s + r.totalP4pEarnings, 0);
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Stat label="Total Revenue" value={money(totRevenue)} />
              <Stat label="Total Jobs" value={String(totJobs)} />
              <Stat label="Total P4P Earned" value={money(totP4p)} />
              <Stat label="Avg Job Value" value={totJobs > 0 ? money(totRevenue / totJobs) : '—'} highlight />
            </div>
          );
        })()}
        {data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => setEmpSort(s => ({ col: 'name', dir: s.col === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))}>Technician {empSort.col === 'name' ? (empSort.dir === 'asc' ? '↑' : '↓') : ''}</TableHead>
                <SortHead col="jobCount">Jobs</SortHead>
                <SortHead col="totalRevenue">Total Revenue</SortHead>
                <SortHead col="averageJobValue">Avg Job Value</SortHead>
                <SortHead col="totalP4pEarnings">P4P Earnings</SortHead>
                <TableHead className="text-right">P4P / Revenue</TableHead>
                <TableHead className="text-right">Rev / hr</TableHead>
              </TableRow>
            </TableHeader>
            {sortedRows.length > 0 && <caption className="caption-bottom text-xs text-muted-foreground pt-2">{sortedRows.length} technician{sortedRows.length !== 1 ? 's' : ''}</caption>}
            <TableBody>
              {sortedRows.map(r => {
                const laborHours = (r as any).totalLaborHours ?? 0;
                const revPerHr = laborHours > 0 ? r.totalRevenue / laborHours : null;
                return (
                <TableRow key={r.userId}>
                  <TableCell className="font-medium"><button className="hover:underline text-primary" title={r.name} onClick={() => { window.location.href = `${import.meta.env.BASE_URL}employees?tab=accounts&userId=${r.userId}`; }}>{r.name}</button></TableCell>
                  <TableCell className="text-right" title={`${r.jobCount} job${r.jobCount !== 1 ? 's' : ''} completed`}>{r.jobCount}</TableCell>
                  <TableCell className="text-right" title={`Total revenue: ${money(r.totalRevenue)}`}>{money(r.totalRevenue)}</TableCell>
                  <TableCell className="text-right" title={`Average job value: ${money(r.averageJobValue)}`}>{money(r.averageJobValue)}</TableCell>
                  <TableCell className="text-right" title={`Total P4P earnings: ${money(r.totalP4pEarnings)}`}>{money(r.totalP4pEarnings)}</TableCell>
                  <TableCell className="text-right" title={`P4P to revenue ratio: ${r.p4pToRevenueRatioPct}%`}>{r.p4pToRevenueRatioPct}%</TableCell>
                  <TableCell className="text-right text-muted-foreground">{revPerHr != null ? <span title={`${money(revPerHr)} revenue per labor hour`}>{money(revPerHr)}</span> : <span title="No labor hours logged">—</span>}</TableCell>
                </TableRow>
                );
              })}
              {data.rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No completed jobs in this range.</TableCell></TableRow>
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
          <Button size="sm" variant="outline" className="gap-2" disabled={!data} onClick={() => {
            if (!data) return;
            const rows: Record<string, string | number>[] = [
              { category: 'Revenue', amount: data.revenue },
              { category: 'Cost of Goods Sold', amount: -data.costOfGoodsSold.total },
              { category: '  Parts', amount: -data.costOfGoodsSold.partsCost },
              { category: '  Labor (P4P)', amount: -data.costOfGoodsSold.laborCost },
              { category: '  Fuel', amount: -data.costOfGoodsSold.fuelCost },
              { category: 'Gross Profit', amount: data.grossProfit },
              { category: 'Operating Expenses', amount: -data.operatingExpenses.total },
              ...data.operatingExpenses.byCategory.map(c => ({ category: `  ${c.category}`, amount: -c.amount })),
              { category: 'Net Income', amount: data.netIncome },
            ];
            downloadCsv(`pl-statement-${startDate}-${endDate}.csv`, rows);
          }}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" title="Export as PDF" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Preset">
            <Select value="" onValueChange={v => {
              const now = new Date();
              const y = now.getFullYear();
              const m = now.getMonth();
              if (v === 'thisMonth') { setStartDate(new Date(y, m, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m + 1, 0).toISOString().slice(0, 10)); }
              else if (v === 'lastMonth') { setStartDate(new Date(y, m - 1, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m, 0).toISOString().slice(0, 10)); }
              else if (v === 'thisYear') { setStartDate(`${y}-01-01`); setEndDate(`${y}-12-31`); }
              else if (v === 'lastYear') { setStartDate(`${y - 1}-01-01`); setEndDate(`${y - 1}-12-31`); }
              else if (v === 'q1') { setStartDate(`${y}-01-01`); setEndDate(`${y}-03-31`); }
              else if (v === 'q2') { setStartDate(`${y}-04-01`); setEndDate(`${y}-06-30`); }
              else if (v === 'q3') { setStartDate(`${y}-07-01`); setEndDate(`${y}-09-30`); }
              else if (v === 'q4') { setStartDate(`${y}-10-01`); setEndDate(`${y}-12-31`); }
            }}>
              <SelectTrigger className="w-36" title="Select a preset date range"><SelectValue placeholder="Quick select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thisMonth">This Month</SelectItem>
                <SelectItem value="lastMonth">Last Month</SelectItem>
                <SelectItem value="thisYear">This Year</SelectItem>
                <SelectItem value="lastYear">Last Year</SelectItem>
                <SelectItem value="q1">Q1</SelectItem>
                <SelectItem value="q2">Q2</SelectItem>
                <SelectItem value="q3">Q3</SelectItem>
                <SelectItem value="q4">Q4</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start"><Input type="date" title="Filter by start date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" title="Filter by end date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Button size="sm" title="Run this report" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
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
      <span title={label}>{label}</span>
      <span className={value < 0 ? 'text-destructive' : ''} title={`${label}: ${value < 0 ? `(${money(Math.abs(value))})` : money(value)}`}>{value < 0 ? `(${money(Math.abs(value))})` : money(value)}</span>
    </div>
  );
}

// ── Report D: Aging Invoices ───────────────────────────────────────────────
const BUCKET_ORDER = ['current', '1-30', '31-60', '61-90', '90+'] as const;

function AgingInvoicesReport() {
  const { data, isFetching, refetch } = useGetAgingInvoicesReport();
  const [bucketFilter, setBucketFilter] = React.useState<string | null>(null);
  const [agingSearch, setAgingSearch] = React.useState('');
  const [agingSort, setAgingSort] = React.useState<{ col: 'customer' | 'total' | 'due' | 'days'; dir: 'asc' | 'desc' }>({ col: 'days', dir: 'desc' });
  const toggleAgingSort = (col: typeof agingSort['col']) => setAgingSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
  const agingSortIcon = (col: typeof agingSort['col']) => agingSort.col === col ? (agingSort.dir === 'asc' ? ' ↑' : ' ↓') : '';

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
          <CardTitle className="flex items-center gap-2">Aging Invoices {data && (data as any).totalOutstanding > 0 && <Badge variant="secondary" className="text-xs font-normal" title={`Total outstanding: $${((data as any).totalOutstanding as number).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}>${((data as any).totalOutstanding as number).toLocaleString(undefined, { minimumFractionDigits: 2 })} outstanding</Badge>}</CardTitle>
          <CardDescription>Open invoices grouped by how far past their due date they are.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <Input placeholder="Customer…" title="Filter aging invoices by customer name" value={agingSearch} onChange={e => setAgingSearch(e.target.value)} className="h-9 text-sm pl-7 w-36" />
            {agingSearch && <button onClick={() => setAgingSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
          </div>
          <Button size="sm" variant="outline" className="gap-2" title="Refresh aging invoices data" onClick={() => refetch()} disabled={isFetching}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          <Button size="sm" variant="outline" className="gap-2" title="Download as CSV" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" title="Export as PDF" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data && (
          <>
            {bucketFilter && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Showing: <Badge variant="secondary">{(data.buckets as any)[bucketFilter]?.label}</Badge>
                <button className="text-xs underline" onClick={() => setBucketFilter(null)}>Clear</button>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {BUCKET_ORDER.map(key => {
                const bucket = (data.buckets as Record<string, typeof data.buckets.current>)[key];
                if (!bucket) return null;
                const isActive = bucketFilter === key;
                return (
                  <button
                    key={key}
                    className={`text-left w-full rounded-lg border p-3 transition-all ${key === '90+' ? 'bg-primary/5 border-primary/30' : ''} ${isActive ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-muted-foreground/30'}`}
                    onClick={() => setBucketFilter(isActive ? null : key)}
                  >
                    <p className="text-xs text-muted-foreground">{bucket.label}</p>
                    <p className={`text-lg font-semibold mt-0.5 ${key === '90+' ? 'text-primary' : ''}`}>{money(bucket.total)}</p>
                  </button>
                );
              })}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead><TableHead>Invoice</TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => toggleAgingSort('customer')}>Customer{agingSortIcon('customer')}</TableHead>
                  <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleAgingSort('total')}>Total{agingSortIcon('total')}</TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => toggleAgingSort('due')}>Due Date{agingSortIcon('due')}</TableHead>
                  <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleAgingSort('days')}>Days Overdue{agingSortIcon('days')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {BUCKET_ORDER.filter(key => !bucketFilter || key === bucketFilter).flatMap(key => {
                  const bucket = (data.buckets as Record<string, typeof data.buckets.current>)[key];
                  if (!bucket) return [];
                  const bucketColor: Record<string, string> = { 'current': '', '1-30': 'bg-yellow-50/50', '31-60': 'bg-orange-50/50', '61-90': 'bg-orange-100/60', '90+': 'bg-red-50/60' };
                  return bucket.invoices.filter(inv => !agingSearch || (inv.customerName ?? '').toLowerCase().includes(agingSearch.toLowerCase())).slice().sort((a, b) => {
                    const dir = agingSort.dir === 'asc' ? 1 : -1;
                    if (agingSort.col === 'customer') return dir * (a.customerName ?? '').localeCompare(b.customerName ?? '');
                    if (agingSort.col === 'total') return dir * ((a.total ?? 0) - (b.total ?? 0));
                    if (agingSort.col === 'due') return dir * ((a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
                    return dir * ((a.daysOverdue ?? 0) - (b.daysOverdue ?? 0));
                  }).map((inv) => (
                    <TableRow key={inv.invoiceId} className={`${bucketColor[key] ?? ''} cursor-pointer hover:brightness-95`} onClick={() => { window.location.href = `${import.meta.env.BASE_URL}financials?invoiceId=${inv.invoiceId}`; }}>
                      <TableCell><Badge variant="secondary" className="font-normal" title={`Aging bucket: ${bucket.label}`}>{bucket.label}</Badge></TableCell>
                      <TableCell className="font-medium" title={`Invoice ${inv.invoiceNumber}`}>{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-muted-foreground" title={inv.customerName ?? undefined}>{inv.customerName ?? '—'}</TableCell>
                      <TableCell className="text-right" title={`Invoice total: ${money(inv.total)}`}>{money(inv.total)}</TableCell>
                      <TableCell title={inv.dueDate ? format(new Date(inv.dueDate), 'EEEE, MMMM d, yyyy') : undefined}>{inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell className="text-right" title={`${inv.daysOverdue} day${inv.daysOverdue !== 1 ? 's' : ''} overdue`}>{inv.daysOverdue}</TableCell>
                      <TableCell className="text-xs text-primary whitespace-nowrap" title="Open this invoice">View →</TableCell>
                    </TableRow>
                  ));
                })}
                {data.totalOutstanding === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No open invoices.</TableCell></TableRow>
                )}
                {data.totalOutstanding > 0 && (
                  <TableRow className="border-t-2 font-semibold bg-muted/30">
                    <TableCell colSpan={3} className="text-sm">Total Outstanding</TableCell>
                    <TableCell className="text-right text-sm" title={`Total outstanding: ${money(data.totalOutstanding)}`}>{money(data.totalOutstanding)}</TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
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
          <Button size="sm" variant="outline" className="gap-2" title="Download as CSV" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" title="Export as PDF" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => { window.location.href = '/settings?tab=operational'; }}><Settings className="w-4 h-4" /> Tax Rate</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Preset">
            <Select value="" onValueChange={v => {
              const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
              if (v === 'thisYear') { setStartDate(`${y}-01-01`); setEndDate(`${y}-12-31`); }
              else if (v === 'lastYear') { setStartDate(`${y - 1}-01-01`); setEndDate(`${y - 1}-12-31`); }
              else if (v === 'q1') { setStartDate(`${y}-01-01`); setEndDate(`${y}-03-31`); }
              else if (v === 'q2') { setStartDate(`${y}-04-01`); setEndDate(`${y}-06-30`); }
              else if (v === 'q3') { setStartDate(`${y}-07-01`); setEndDate(`${y}-09-30`); }
              else if (v === 'q4') { setStartDate(`${y}-10-01`); setEndDate(`${y}-12-31`); }
              else if (v === 'thisMonth') { setStartDate(new Date(y, m, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m + 1, 0).toISOString().slice(0, 10)); }
            }}>
              <SelectTrigger className="w-36" title="Select a preset date range"><SelectValue placeholder="Quick select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thisMonth">This Month</SelectItem>
                <SelectItem value="thisYear">This Year</SelectItem>
                <SelectItem value="lastYear">Last Year</SelectItem>
                <SelectItem value="q1">Q1</SelectItem>
                <SelectItem value="q2">Q2</SelectItem>
                <SelectItem value="q3">Q3</SelectItem>
                <SelectItem value="q4">Q4</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start"><Input type="date" title="Filter by start date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" title="Filter by end date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Button size="sm" title="Run this report" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
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
                    <TableCell className="font-medium" title={r.month}>{r.month}</TableCell>
                    <TableCell className="text-right" title={`Taxable revenue: ${money(r.taxableRevenue)}`}>{money(r.taxableRevenue)}</TableCell>
                    <TableCell className="text-right" title={`Tax collected: ${money(r.taxCollected)}`}>{money(r.taxCollected)}</TableCell>
                    <TableCell className="text-right" title={`Effective tax rate: ${r.effectiveTaxRatePct}%`}>{r.effectiveTaxRatePct}%</TableCell>
                  </TableRow>
                ))}
                {data.rows.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No paid invoices in this range.</TableCell></TableRow>
                )}
                {data.rows.length > 1 && (
                  <TableRow className="font-semibold border-t-2 bg-muted/30">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right" title={`Total taxable revenue: ${money(data.totals.taxableRevenue)}`}>{money(data.totals.taxableRevenue)}</TableCell>
                    <TableCell className="text-right" title={`Total tax collected: ${money(data.totals.taxCollected)}`}>{money(data.totals.taxCollected)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Report F: Inventory Sales ──────────────────────────────────────────────
function InventorySalesReport() {
  const { start, end } = defaultRange();
  const [startDate, setStartDate] = useState(start);
  const [endDate, setEndDate] = useState(end);
  const { data, isFetching, refetch } = useGetInventorySalesReport({ startDate, endDate });
  const [invSort, setInvSort] = React.useState<{ col: 'item' | 'units' | 'revenue' | 'margin' | 'commission'; dir: 'asc' | 'desc' }>({ col: 'revenue', dir: 'desc' });
  const [invSalesperson, setInvSalesperson] = useState('');
  const toggleInvSort = (col: typeof invSort['col']) => setInvSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
  const invSortIcon = (col: typeof invSort['col']) => invSort.col === col ? (invSort.dir === 'asc' ? ' ↑' : ' ↓') : '';

  const exportCsv = () => {
    if (!data) return;
    downloadCsv('inventory-sales.csv', data.rows.map(r => ({
      item: r.itemName, sku: r.sku, category: r.category ?? '',
      unitsSold: r.unitsSold, sellPricePerUnit: r.sellPricePerUnit,
      totalRevenue: r.totalRevenue, totalCost: r.totalCost,
      grossMargin: r.grossMargin, commissionPct: r.commissionPct,
      commissionEarned: r.commissionEarned, currentStock: r.currentStock,
      salesperson: r.salespersonName ?? '',
    })));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle>Inventory Sales</CardTitle>
          <CardDescription>Units sold, revenue, cost, margin, and commission per inventory item on completed jobs in the selected range.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <GeneratedBadge generatedAt={data?.generatedAt} cached={data?.cached} />
          <Button size="sm" variant="outline" className="gap-2" title="Download as CSV" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" title="Export as PDF" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> PDF</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Preset">
            <Select value="" onValueChange={v => {
              const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
              if (v === 'thisMonth') { setStartDate(new Date(y, m, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m + 1, 0).toISOString().slice(0, 10)); }
              else if (v === 'lastMonth') { setStartDate(new Date(y, m - 1, 1).toISOString().slice(0, 10)); setEndDate(new Date(y, m, 0).toISOString().slice(0, 10)); }
              else if (v === 'thisYear') { setStartDate(`${y}-01-01`); setEndDate(`${y}-12-31`); }
              else if (v === 'lastYear') { setStartDate(`${y - 1}-01-01`); setEndDate(`${y - 1}-12-31`); }
            }}>
              <SelectTrigger className="w-36" title="Select a preset date range"><SelectValue placeholder="Quick select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thisMonth">This Month</SelectItem>
                <SelectItem value="lastMonth">Last Month</SelectItem>
                <SelectItem value="thisYear">This Year</SelectItem>
                <SelectItem value="lastYear">Last Year</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start"><Input type="date" title="Filter by start date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" /></Field>
          <Field label="End"><Input type="date" title="Filter by end date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" /></Field>
          <Field label="Salesperson">
            <div className="relative">
              <Input placeholder="Filter…" title="Filter by salesperson name" value={invSalesperson} onChange={e => setInvSalesperson(e.target.value)} className="w-36" />
              {invSalesperson && <button onClick={() => setInvSalesperson('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
            </div>
          </Field>
          <Button size="sm" title="Run this report" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Running…' : 'Run Report'}</Button>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="Units Sold" value={String(data.totals.unitsSold)} />
              <Stat label="Total Revenue" value={money(data.totals.totalRevenue)} />
              <Stat label="Total Cost" value={money(data.totals.totalCost)} />
              <Stat label="Gross Margin" value={money(data.totals.grossMargin)} highlight />
              <Stat label="Commission Earned" value={money(data.totals.commissionEarned)} />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => toggleInvSort('item')}>Item{invSortIcon('item')}</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleInvSort('units')}>Units Sold{invSortIcon('units')}</TableHead>
                  <TableHead className="text-right">Sell Price</TableHead>
                  <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleInvSort('revenue')}>Revenue{invSortIcon('revenue')}</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleInvSort('margin')}>Margin{invSortIcon('margin')}</TableHead>
                  <TableHead className="text-right">Commission %</TableHead>
                  <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleInvSort('commission')}>Commission ${invSortIcon('commission')}</TableHead>
                  <TableHead className="text-right">Stock Left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.rows].filter(r => !invSalesperson.trim() || (r.salespersonName ?? '').toLowerCase().includes(invSalesperson.trim().toLowerCase())).sort((a, b) => {
                    const dir = invSort.dir === 'asc' ? 1 : -1;
                    if (invSort.col === 'item') return dir * a.itemName.localeCompare(b.itemName);
                    if (invSort.col === 'units') return dir * (a.unitsSold - b.unitsSold);
                    if (invSort.col === 'revenue') return dir * (a.totalRevenue - b.totalRevenue);
                    if (invSort.col === 'margin') return dir * (a.grossMargin - b.grossMargin);
                    return dir * (a.commissionEarned - b.commissionEarned);
                  }).map(r => (
                  <TableRow key={r.inventoryItemId} className="cursor-pointer hover:bg-muted/40" onClick={() => { window.location.href = `${import.meta.env.BASE_URL}inventory?highlight=${r.inventoryItemId}`; }}>
                    <TableCell className="font-medium" title={r.itemName}>{r.itemName}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={r.sku || undefined}>{r.sku}</TableCell>
                    <TableCell>{r.category ? <Badge variant="outline" title={`Category: ${r.category}`}>{r.category}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-muted-foreground" title={r.salespersonName ?? undefined}>{r.salespersonName ?? '—'}</TableCell>
                    <TableCell className="text-right" title={`${r.unitsSold} unit${r.unitsSold !== 1 ? 's' : ''} sold`}>{r.unitsSold}</TableCell>
                    <TableCell className="text-right" title={`Sell price per unit: ${money(r.sellPricePerUnit)}`}>{money(r.sellPricePerUnit)}</TableCell>
                    <TableCell className="text-right" title={`Total revenue: ${money(r.totalRevenue)}`}>{money(r.totalRevenue)}</TableCell>
                    <TableCell className="text-right text-muted-foreground" title={`Total cost: ${money(r.totalCost)}`}>{money(r.totalCost)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.grossMargin < 0 ? 'text-destructive' : 'text-emerald-600'}`} title={`Gross margin: ${money(r.grossMargin)}`}>{money(r.grossMargin)}</TableCell>
                    <TableCell className="text-right" title={r.commissionPct > 0 ? `Commission rate: ${r.commissionPct}%` : undefined}>{r.commissionPct > 0 ? `${r.commissionPct}%` : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right" title={r.commissionEarned > 0 ? `Commission earned: ${money(r.commissionEarned)}` : undefined}>{r.commissionEarned > 0 ? money(r.commissionEarned) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={r.currentStock <= 0 ? 'text-destructive font-semibold' : r.currentStock <= 5 ? 'text-amber-600 font-medium' : ''}
                        title={`${r.currentStock} unit${r.currentStock !== 1 ? 's' : ''} in stock`}
                      >
                        {r.currentStock}
                        {r.currentStock <= 5 && <span className="text-[10px] ml-1 opacity-70">units</span>}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {data.rows.length === 0 && (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No inventory items sold in completed jobs during this range.</TableCell></TableRow>
                )}
                {data.rows.length > 0 && invSalesperson.trim() && [...data.rows].filter(r => (r.salespersonName ?? '').toLowerCase().includes(invSalesperson.trim().toLowerCase())).length === 0 && (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No results match the salesperson filter.</TableCell></TableRow>
                )}
                {data.rows.length > 0 && (
                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell colSpan={4}>Totals</TableCell>
                    <TableCell className="text-right" title={`Total units sold: ${data.totals.unitsSold}`}>{data.totals.unitsSold}</TableCell>
                    <TableCell />
                    <TableCell className="text-right" title={`Total revenue: ${money(data.totals.totalRevenue)}`}>{money(data.totals.totalRevenue)}</TableCell>
                    <TableCell className="text-right" title={`Total cost: ${money(data.totals.totalCost)}`}>{money(data.totals.totalCost)}</TableCell>
                    <TableCell className={`text-right ${data.totals.grossMargin < 0 ? 'text-destructive' : 'text-emerald-600'}`} title={`Total gross margin: ${money(data.totals.grossMargin)}`}>{money(data.totals.grossMargin)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right" title={`Total commission earned: ${money(data.totals.commissionEarned)}`}>{money(data.totals.commissionEarned)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Report G: Reorder List ─────────────────────────────────────────────────
function ReorderListReportPanel() {
  const { data, isFetching, refetch } = useGetInventoryReorderList();
  const [checked, setChecked] = React.useState<Set<number>>(new Set());

  const toggleCheck = (id: number) =>
    setChecked(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const allIds = React.useMemo(() => data?.groups.flatMap(g => g.items.map(i => i.id)) ?? [], [data]);
  const allChecked = allIds.length > 0 && allIds.every(id => checked.has(id));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(allIds));

  const exportCsv = () => {
    if (!data) return;
    const rows = data.groups.flatMap(g =>
      g.items.map(i => ({
        supplier: g.supplierName,
        contact: g.contact ?? '',
        accountNumber: g.accountNumber ?? '',
        name: i.name,
        sku: i.sku,
        category: i.category ?? '',
        quantity: i.quantity,
        reorderPoint: i.reorderPoint,
        unit: i.unit,
        costPrice: i.costPrice ?? '',
        ordered: checked.has(i.id) ? 'Yes' : 'No',
      }))
    );
    downloadCsv('reorder-list.csv', rows);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            Reorder List
            {data && data.totalItems > 0 && (
              <span className="text-sm font-normal text-destructive">({data.totalItems} item{data.totalItems !== 1 ? 's' : ''} low)</span>
            )}
          </CardTitle>
          <CardDescription>Low-stock items grouped by supplier. Check off items as you order them, then export as a CSV purchase order.</CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {data && <span className="text-xs text-muted-foreground">Generated {format(new Date(data.generatedAt), 'MMM d, h:mm a')}</span>}
          <Button size="sm" variant="outline" className="gap-2" onClick={() => refetch()} disabled={isFetching}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={exportCsv} disabled={!data || data.totalItems === 0}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> Print</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isFetching && !data && (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading reorder list…</p>
        )}
        {data && data.totalItems === 0 && (
          <div className="py-12 text-center space-y-2">
            <Package className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="font-medium">All stocked up!</p>
            <p className="text-sm text-muted-foreground">No items are currently at or below their reorder points.</p>
          </div>
        )}
        {data && data.totalItems > 0 && (
          <div className="space-y-6">
            {/* Select-all row */}
            <div className="flex items-center gap-2 print:hidden">
              <button
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={toggleAll}
                title={allChecked ? 'Uncheck all items' : 'Check all items as ordered'}
              >
                {allChecked
                  ? <CheckSquare className="w-4 h-4 text-primary" />
                  : <Square className="w-4 h-4" />}
                {allChecked ? 'Uncheck all' : 'Check all'}
              </button>
              {checked.size > 0 && (
                <span className="text-xs text-muted-foreground">({checked.size} of {allIds.length} marked as ordered)</span>
              )}
            </div>

            {data.groups.map((group, gi) => (
              <div key={gi} className="rounded-lg border overflow-hidden">
                {/* Supplier header */}
                <div className="bg-muted/50 px-4 py-3 flex items-start gap-3 border-b">
                  <Building2 className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{group.supplierName}</p>
                    {group.contact && (
                      <p className="text-xs text-muted-foreground mt-0.5">{group.contact}</p>
                    )}
                    {group.accountNumber && (
                      <p className="text-xs text-muted-foreground">Acct: <span className="font-mono">{group.accountNumber}</span></p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Items table */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8 print:hidden" />
                      <TableHead>Item</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">In Stock</TableHead>
                      <TableHead className="text-right">Reorder At</TableHead>
                      <TableHead className="text-right">Unit</TableHead>
                      <TableHead className="text-right">Cost Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map(item => {
                      const isOrdered = checked.has(item.id);
                      return (
                        <TableRow
                          key={item.id}
                          className={`cursor-pointer transition-colors ${isOrdered ? 'opacity-50 bg-muted/30' : 'hover:bg-muted/20'}`}
                          onClick={() => toggleCheck(item.id)}
                        >
                          <TableCell className="print:hidden">
                            <button
                              title={isOrdered ? 'Mark as not ordered' : 'Mark as ordered'}
                              onClick={e => { e.stopPropagation(); toggleCheck(item.id); }}
                            >
                              {isOrdered
                                ? <CheckSquare className="w-4 h-4 text-primary" />
                                : <Square className="w-4 h-4 text-muted-foreground" />}
                            </button>
                          </TableCell>
                          <TableCell className={`font-medium ${isOrdered ? 'line-through' : ''}`} title={item.name}>
                            <span className="flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                              {item.name}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground" title={item.sku}>{item.sku}</TableCell>
                          <TableCell>{item.category ? <Badge variant="outline">{item.category}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-right">
                            <span className="font-bold text-destructive" title={`${item.quantity} in stock`}>{item.quantity}</span>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground" title={`Reorder at ${item.reorderPoint}`}>{item.reorderPoint}</TableCell>
                          <TableCell className="text-right text-muted-foreground" title={`Unit: ${item.unit}`}>{item.unit}</TableCell>
                          <TableCell className="text-right" title={item.costPrice != null ? `Cost price: ${money(item.costPrice)}` : 'No cost price set'}>
                            {item.costPrice != null ? money(item.costPrice) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
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
      <p className={`text-lg font-semibold mt-0.5 ${highlight ? 'text-primary' : ''}`} title={`${label}: ${value}`}>{value}</p>
    </div>
  );
}
