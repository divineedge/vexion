import React, { useState } from 'react';
import { PayrollApprovals } from '@/components/payroll-approvals';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { customFetch, useGetTenantSettings } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { DollarSign, ChevronDown, ChevronRight, Package, Wrench, Users, TrendingUp, Info, ClipboardList, Clock, Download } from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────────────────────────── */

interface TechSummary {
  userId: number;
  name: string;
  role: string;
  p4pEarnings: number;
  jobCount: number;
  totalRevenue: number;
  totalMaterialCost: number;
  netLaborRevenue: number;
  /** Configured users.hourlyRate; null = not configured (never treat as $0). */
  baseHourlyRate?: number | null;
  /** Closed effective master-clock hours clipped to the selected range. */
  clockHours?: number;
  basePay?: number | null;
  /** max(basePay, p4pEarnings): hourly guarantee OR P4P, never the sum. */
  grossPay?: number | null;
  /** Earned acquisition rewards (first paid invoice), separate from P4P; included in grossPay. */
  acquisitionBonusPay?: number | null;
}

interface TechSplitRow {
  userId: number;
  name: string;
  techSeconds: number;
  totalSeconds: number;
  contributionPct: number;
  earnings: number;
}

interface JobBreakdown {
  jobId: number;
  jobTitle: string;
  customerName: string | null;
  blueprintName: string | null;
  completedAt: string;
  totalAmount: number;
  materialCost: number;
  netLaborRevenue: number;
  p4pPct: number;
  p4pPool: number;
  usingGlobalRate: boolean;
  splits: TechSplitRow[];
}

interface SummaryResponse {
  period: string;
  rangeStart: string;
  rangeEnd: string;
  globalP4pPct: number;
  technicians: TechSummary[];
}

interface DailyTaskUserSummary {
  userId: number;
  userName: string | null;
  totalSeconds: number;
  totalMinutes: number;
  runCount: number;
}

interface ClockInUserSummary {
  userId: number;
  userName: string | null;
  totalMinutes: number;
}

/* ─── Helpers ────────────────────────────────────────────────────────────────── */

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function fmtMinutes(minutes: number) {
  if (minutes === 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function minutesToDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

function exportTimesheetCsv(rows: TimesheetRow[], period: string) {
  const headers = ['Employee', 'Clock-In Hours', 'Task Hours', 'Total Hours'];
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      JSON.stringify(r.name),
      minutesToDecimalHours(r.clockInMinutes),
      minutesToDecimalHours(r.taskMinutes),
      minutesToDecimalHours(r.clockInMinutes + r.taskMinutes),
    ].join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `timesheet-${period}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface TimesheetRow {
  userId: number;
  name: string;
  clockInMinutes: number;
  taskMinutes: number;
}

/** Convert the period selector value to dateFrom / dateTo query params. */
function periodToRange(period: string): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (period === 'today') return { dateFrom: today, dateTo: today };
  if (period === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay()); // Sunday
    return { dateFrom: fmt(start), dateTo: today };
  }
  if (period === 'month') {
    return { dateFrom: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, dateTo: today };
  }
  // 30d (default)
  const start = new Date(now); start.setDate(now.getDate() - 30);
  return { dateFrom: fmt(start), dateTo: today };
}

function pctBadge(pct: number, usingGlobal: boolean) {
  return (
    <Badge variant="outline" title={`P4P rate: ${pct}% ${usingGlobal ? '(from global default)' : '(service-specific override)'}`} className={`text-xs gap-1 ${usingGlobal ? 'text-muted-foreground' : 'text-primary border-primary/40'}`}>
      {pct}%{usingGlobal ? ' (global)' : ' (service)'}
    </Badge>
  );
}

/* ─── Job Row ────────────────────────────────────────────────────────────────── */
function JobRow({ job, highlightUserId }: { job: JobBreakdown; highlightUserId?: number }) {
  const [open, setOpen] = useState(false);
  const myEarnings = highlightUserId ? job.splits.find(s => s.userId === highlightUserId)?.earnings ?? 0 : job.p4pPool;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <TableRow className="cursor-pointer hover:bg-muted/50">
          <TableCell className="w-6">
            {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
          </TableCell>
          <TableCell>
            <p className="font-medium text-sm">{job.jobTitle}</p>
            {job.customerName && <p className="text-xs text-muted-foreground">{job.customerName}</p>}
          </TableCell>
          <TableCell className="text-right text-sm">{fmt(job.totalAmount)}</TableCell>
          <TableCell className="text-right">
            <span className="text-sm text-destructive" title={`Customer sell-price material amount deducted: −${fmt(job.materialCost)}`}>−{fmt(job.materialCost)}</span>
          </TableCell>
          <TableCell className="text-right text-sm font-medium">{fmt(job.netLaborRevenue)}</TableCell>
          <TableCell className="text-right">{pctBadge(job.p4pPct, job.usingGlobalRate)}</TableCell>
          <TableCell className="text-right text-sm font-semibold text-emerald-700" title={`P4P earnings: ${fmt(myEarnings)}`}>{fmt(myEarnings)}</TableCell>
        </TableRow>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={7} className="p-0 bg-muted/20 border-b">
            <div className="px-6 py-3 space-y-2">
              {/* Material deduction breakdown */}
              {job.materialCost > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Package className="w-3.5 h-3.5 shrink-0" />
                  <span>Customer sell-price amount deducted before P4P: <span className="font-semibold text-foreground">{fmt(job.materialCost)}</span></span>
                </div>
              )}
              {/* P4P formula */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Wrench className="w-3.5 h-3.5 shrink-0" />
                <span>
                  P4P Pool: <span className="font-mono text-foreground">{fmt(job.netLaborRevenue)} × {job.p4pPct}% = <span className="text-emerald-700 font-semibold">{fmt(job.p4pPool)}</span></span>
                </span>
              </div>
              {/* Multi-tech splits */}
              {job.splits.length > 1 && (
                <div className="space-y-1 mt-1">
                  <p className="text-xs text-muted-foreground font-medium">Split by sub-timer contribution:</p>
                  <div className="flex flex-wrap gap-2">
                    {job.splits.map(s => (
                      <div key={s.userId} className={`text-xs px-2 py-1 rounded border ${highlightUserId === s.userId ? 'bg-primary/5 border-primary/30 font-semibold' : 'bg-muted border-border'}`}>
                        {s.name}: {s.contributionPct}% → <span className="text-emerald-700">{fmt(s.earnings)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ─── Timesheet Section ──────────────────────────────────────────────────────── */
function TimesheetSection({
  clockInSummary,
  taskHoursSummary,
  period,
  dateFrom,
  dateTo,
}: {
  clockInSummary: ClockInUserSummary[];
  taskHoursSummary: DailyTaskUserSummary[];
  period: string;
  dateFrom: string;
  dateTo: string;
}) {
  // Build a unified set of user ids from both sources
  const userIds = new Set([
    ...clockInSummary.map(r => r.userId),
    ...taskHoursSummary.map(r => r.userId),
  ]);

  const clockInMap = new Map(clockInSummary.map(r => [r.userId, r]));
  const taskMap = new Map(taskHoursSummary.map(r => [r.userId, r]));

  const rows: TimesheetRow[] = Array.from(userIds).map(uid => {
    const ci = clockInMap.get(uid);
    const tk = taskMap.get(uid);
    return {
      userId: uid,
      name: ci?.userName ?? tk?.userName ?? `User ${uid}`,
      clockInMinutes: ci?.totalMinutes ?? 0,
      taskMinutes: tk?.totalMinutes ?? 0,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const totalClockIn = rows.reduce((s, r) => s + r.clockInMinutes, 0);
  const totalTask = rows.reduce((s, r) => s + r.taskMinutes, 0);
  const totalCombined = totalClockIn + totalTask;

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Timesheet Summary
          </CardTitle>
          <CardDescription>
            Clock-in hours + daily task hours per employee for {dateFrom} to {dateTo}.
            Export as CSV for payroll processing.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          title="Export timesheet data as CSV for payroll processing"
          onClick={() => exportTimesheetCsv(rows, period)}
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <Clock className="w-3.5 h-3.5" /> Clock-In Hours
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <ClipboardList className="w-3.5 h-3.5" /> Task Hours
                </span>
              </TableHead>
              <TableHead className="text-right font-semibold">Total Hours</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => {
              const total = r.clockInMinutes + r.taskMinutes;
              return (
                <TableRow key={r.userId}>
                  <TableCell className="font-medium" title={r.name}>{r.name}</TableCell>
                  <TableCell className="text-right text-sm" title={r.clockInMinutes > 0 ? `Job clock-in time: ${fmtMinutes(r.clockInMinutes)} (${minutesToDecimalHours(r.clockInMinutes)}h)` : 'No job clock-in time'}>
                    {r.clockInMinutes > 0
                      ? <span className="text-foreground">{fmtMinutes(r.clockInMinutes)}<span className="text-muted-foreground ml-1 text-xs">({minutesToDecimalHours(r.clockInMinutes)}h)</span></span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm" title={r.taskMinutes > 0 ? `Daily task time: ${fmtMinutes(r.taskMinutes)} (${minutesToDecimalHours(r.taskMinutes)}h)` : 'No daily task time'}>
                    {r.taskMinutes > 0
                      ? <span className="text-blue-700">{fmtMinutes(r.taskMinutes)}<span className="text-muted-foreground ml-1 text-xs">({minutesToDecimalHours(r.taskMinutes)}h)</span></span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-semibold" title={`Total hours: ${fmtMinutes(total)} (${minutesToDecimalHours(total)}h)`}>
                    {fmtMinutes(total)}
                    <span className="text-muted-foreground ml-1 text-xs font-normal">({minutesToDecimalHours(total)}h)</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <tfoot>
            <tr className="border-t-2 bg-muted/30">
              <td className="px-4 py-3 text-sm font-semibold" title={`${rows.length} employee${rows.length !== 1 ? 's' : ''}`}>{rows.length} employee{rows.length !== 1 ? 's' : ''}</td>
              <td className="px-4 py-3 text-right text-sm font-semibold" title={`Total job clock-in time: ${fmtMinutes(totalClockIn)}`}>{fmtMinutes(totalClockIn)}</td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-blue-700" title={`Total daily task time: ${fmtMinutes(totalTask)}`}>{fmtMinutes(totalTask)}</td>
              <td className="px-4 py-3 text-right text-sm font-bold" title={`Total combined hours: ${fmtMinutes(totalCombined)}`}>{fmtMinutes(totalCombined)}</td>
            </tr>
          </tfoot>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────────── */
export default function PayrollPage() {
  const { isTechnician, user, isOwner, canManageOffice } = useAuth();
  const [approvalView, setApprovalView] = useState(false);
  const [period, setPeriod] = useState('30d');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [selectedTechId, setSelectedTechId] = useState<number | null>(null);

  const { data: tenantSettings } = useGetTenantSettings();
  const dailyTaskHourlyRate: number = tenantSettings?.dailyTaskHourlyRate ?? 0;

  // Technicians cannot call /p4p/summary (403); their stats come via /p4p/jobs
  // Admin: daily task hours per technician for the same period
  const { dateFrom, dateTo } = period === 'custom' && customDateFrom && customDateTo
    ? { dateFrom: customDateFrom, dateTo: customDateTo }
    : periodToRange(period);

  const periodQuery = period === 'custom' && customDateFrom && customDateTo
    ? `dateFrom=${customDateFrom}&dateTo=${customDateTo}`
    : `period=${period}`;

  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryResponse>({
    queryKey: ['p4p-summary', period, dateFrom, dateTo],
    queryFn: () => customFetch<SummaryResponse>(`/api/p4p/summary?${periodQuery}`),
    enabled: !isTechnician,
    retry: false,
  });

  const viewUserId = isTechnician ? user?.id : (selectedTechId ?? undefined);

  const { data: jobs, isLoading: jobsLoading } = useQuery<JobBreakdown[]>({
    queryKey: ['p4p-jobs', period, dateFrom, dateTo, viewUserId],
    queryFn: () =>
      customFetch<JobBreakdown[]>(
        `/api/p4p/jobs?${periodQuery}${viewUserId ? `&userId=${viewUserId}` : ''}`,
      ),
  });
  const { data: taskHoursSummary } = useQuery<DailyTaskUserSummary[]>({
    queryKey: ['daily-task-hours-summary', period],
    queryFn: () =>
      customFetch<DailyTaskUserSummary[]>(
        `/api/time-tracking/daily-task-hours/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: !isTechnician,
    retry: false,
  });

  // Technician: their own daily task hours for the period
  const { data: myTaskHours } = useQuery<DailyTaskUserSummary[]>({
    queryKey: ['daily-task-hours-summary-self', period],
    queryFn: () =>
      customFetch<DailyTaskUserSummary[]>(
        `/api/time-tracking/daily-task-hours/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: isTechnician,
    retry: false,
  });

  // Admin: clock-in hours per employee for the same period
  const { data: clockInSummary } = useQuery<ClockInUserSummary[]>({
    queryKey: ['clock-in-hours-summary', period],
    queryFn: () =>
      customFetch<ClockInUserSummary[]>(
        `/api/time-tracking/clock-in-hours/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: !isTechnician,
    retry: false,
  });

  const taskHoursMap = new Map((taskHoursSummary ?? []).map(t => [t.userId, t]));
  const myTaskMinutes = isTechnician
    ? (myTaskHours?.find(t => t.userId === user?.id)?.totalMinutes ?? 0)
    : (selectedTechId != null ? (taskHoursMap.get(selectedTechId)?.totalMinutes ?? 0) : 0);
  const myTaskRuns = isTechnician
    ? (myTaskHours?.find(t => t.userId === user?.id)?.runCount ?? 0)
    : (selectedTechId != null ? (taskHoursMap.get(selectedTechId)?.runCount ?? 0) : 0);

  const totalP4P = summary?.technicians.reduce((s, t) => s + t.p4pEarnings, 0) ?? 0;
  const totalNetLabor = summary?.technicians.reduce((s, t) => s + t.netLaborRevenue, 0) ?? 0;
  const totalMaterials = summary?.technicians.reduce((s, t) => s + t.totalMaterialCost, 0) ?? 0;
  const totalTaskMinutes = Array.from(taskHoursMap.values()).reduce((s, t) => s + t.totalMinutes, 0);
  const totalTaskPay = dailyTaskHourlyRate > 0 ? (totalTaskMinutes / 60) * dailyTaskHourlyRate : 0;

  // Per-technician task pay helpers
  const taskPayForMinutes = (minutes: number) =>
    dailyTaskHourlyRate > 0 ? (minutes / 60) * dailyTaskHourlyRate : 0;
  const myTaskPay = taskPayForMinutes(myTaskMinutes);

  const myStats = isTechnician
    ? summary?.technicians.find(t => t.userId === user?.id)
    : selectedTechId
      ? summary?.technicians.find(t => t.userId === selectedTechId)
      : null;

  const displayJobs = jobs ?? [];

  if (approvalView && !isTechnician) return <PayrollApprovals onBack={() => setApprovalView(false)} />;

  if (!isTechnician && summaryLoading && !summary) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">P4P Payroll</h1>
          <p className="text-muted-foreground mt-1">Run P4P payroll — review per-technician earnings before issuing bonuses.</p>
        </div>
        <div className="py-16 text-center text-muted-foreground">Loading payroll data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">P4P Payroll</h1>
          <p className="text-muted-foreground mt-1">
            {isTechnician
              ? 'Your Pay-for-Performance earnings — labor revenue after customer sell-price material deductions.'
              : 'Run P4P payroll — review per-technician earnings before issuing bonuses.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isTechnician && <Button variant="outline" onClick={() => setApprovalView(true)}>Finalize / history</Button>}
          {!isTechnician && (
            <Select value={selectedTechId ? String(selectedTechId) : '__all__'} onValueChange={v => setSelectedTechId(v === '__all__' ? null : parseInt(v, 10))}>
              <SelectTrigger className="w-44" title="Filter payroll by technician"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All technicians</SelectItem>
                {summary?.technicians.map(t => (
                  <SelectItem key={t.userId} value={String(t.userId)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36" title="Select the payroll period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
          {period === 'custom' && (
            <>
              <input type="date" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)} className="h-8 text-xs px-2 rounded-md border border-input bg-background w-36" title="From date" />
              <input type="date" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)} className="h-8 text-xs px-2 rounded-md border border-input bg-background w-36" title="To date" />
            </>
          )}
        </div>
      </div>

      {/* Global rate notice */}
      {summary && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg border">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Global P4P master rate: <span className="font-semibold text-foreground">{summary.globalP4pPct}%</span>.
          Live estimate only — open Finalize / history for locked approved payroll. Rates are applied as of the work date; changes take effect when saved.
          {summary.globalP4pPct === 0 && <span className="text-amber-600 font-medium ml-1"> The company default is 0%. Service or blueprint overrides can still earn P4P; hourly base pay is separate.</span>}
        </div>
      )}

      {/* Admin summary KPIs */}
      {!isTechnician && !selectedTechId && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-bold text-emerald-700" title={`Total P4P payout: ${fmt(totalP4P)}`}>{fmt(totalP4P)}</p>
                <p className="text-xs text-muted-foreground">Total P4P Payout</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-bold" title={`Total net labor revenue: ${fmt(totalNetLabor)}`}>{fmt(totalNetLabor)}</p>
                <p className="text-xs text-muted-foreground">Net Labor Revenue</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-bold" title={`Total customer sell-price material amount deducted: ${fmt(totalMaterials)}`}>{fmt(totalMaterials)}</p>
                <p className="text-xs text-muted-foreground">Customer Sell-Price Materials Deducted</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-bold" title={`${summary?.technicians.filter(t => t.p4pEarnings > 0).length ?? 0} technician${(summary?.technicians.filter(t => t.p4pEarnings > 0).length ?? 0) !== 1 ? 's' : ''} with P4P earnings this period`}>{summary?.technicians.filter(t => t.p4pEarnings > 0).length ?? 0}</p>
                <p className="text-xs text-muted-foreground">Active Techs w/ Earnings</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div>
                {dailyTaskHourlyRate > 0 ? (
                  <>
                    <p className="text-xl font-bold text-blue-700" title={`Total task pay: ${fmt(totalTaskPay)} for ${fmtMinutes(totalTaskMinutes)} @ $${dailyTaskHourlyRate}/hr`}>{fmt(totalTaskPay)}</p>
                    <p className="text-xs text-muted-foreground">Total Task Pay</p>
                    <p className="text-xs text-muted-foreground">{fmtMinutes(totalTaskMinutes)} @ ${dailyTaskHourlyRate}/hr</p>
                  </>
                ) : (
                  <>
                    <p className="text-xl font-bold text-blue-700" title={`Total daily task time: ${fmtMinutes(totalTaskMinutes)}`}>{fmtMinutes(totalTaskMinutes)}</p>
                    <p className="text-xs text-muted-foreground">Daily Task Hours</p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Individual tech stats (when drilling in or tech viewing own) */}
      {(myStats || isTechnician) && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Base Hourly', value: myStats ? (myStats.baseHourlyRate == null ? 'Not configured' : `${fmt(myStats.baseHourlyRate)}/hr`) : '—', accent: '' },
            { label: 'Clock Hours', value: myStats?.clockHours != null ? `${myStats.clockHours.toFixed(2)}h` : '—', accent: '' },
            { label: 'Base Guaranteed Pay', value: myStats ? (myStats.basePay == null ? 'Not configured' : fmt(myStats.basePay)) : '—', accent: '' },
            { label: 'P4P Earnings', value: myStats ? fmt(myStats.p4pEarnings) : '—', accent: 'text-emerald-700' },
            { label: 'Acquisition Bonus (earned, separate)', value: myStats ? fmt(myStats.acquisitionBonusPay ?? 0) : '—', accent: 'text-violet-700' },
            { label: 'Gross Pay (greater of + bonus)', value: myStats ? (myStats.grossPay == null ? fmt(myStats.p4pEarnings) : fmt(myStats.grossPay)) : '—', accent: 'text-primary' },
            { label: 'Net Labor Revenue', value: myStats ? fmt(myStats.netLaborRevenue) : '—', accent: '' },
            { label: 'Customer Sell-Price Materials Deducted', value: myStats ? fmt(myStats.totalMaterialCost) : '—', accent: 'text-amber-600' },
            { label: 'Jobs Counted', value: myStats?.jobCount ?? '—', accent: '' },
            {
              label: dailyTaskHourlyRate > 0 ? 'Task Pay' : 'Daily Task Hours',
              value: dailyTaskHourlyRate > 0 ? fmt(myTaskPay) : fmtMinutes(myTaskMinutes),
              accent: 'text-blue-700',
              sub: dailyTaskHourlyRate > 0
                ? `${fmtMinutes(myTaskMinutes)} @ ${dailyTaskHourlyRate}/hr`
                : (myTaskRuns > 0 ? `${myTaskRuns} run${myTaskRuns !== 1 ? 's' : ''}` : undefined),
            },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <p className={`text-xl font-bold ${stat.accent}`}>{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                {'sub' in stat && stat.sub && <p className="text-xs text-muted-foreground">{stat.sub}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Admin tech leaderboard (full-width, no tech filter) */}
      {!isTechnician && !selectedTechId && (summary?.technicians.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Technician P4P Summary</CardTitle>
            <CardDescription>
              Click a technician row to drill into their job-level breakdown. Gross pay is the <strong>greater of</strong> the hourly guarantee (base rate × clock hours) or P4P earnings, not the sum.
              P4P earnings only build from completed jobs with a price; staff with no completed priced jobs show $0 P4P and are paid their base guarantee. Daily Task Hours are compliance/admin time, not revenue-generating.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Technician</TableHead>
                  <TableHead className="text-right">Jobs</TableHead>
                  <TableHead className="text-right">Gross Revenue</TableHead>
                  <TableHead className="text-right">Customer Sell-Price Materials</TableHead>
                  <TableHead className="text-right">Net Labor</TableHead>
                  <TableHead className="text-right">P4P Earnings</TableHead>
                  <TableHead className="text-right">Base Rate</TableHead>
                  <TableHead className="text-right">Clock Hrs</TableHead>
                  <TableHead className="text-right">Base Pay</TableHead>
                  <TableHead className="text-right" title="Earned employee acquisition rewards, separate from P4P">Acq. Bonus</TableHead>
                  <TableHead className="text-right">Gross Pay</TableHead>
                  <TableHead className="text-right">
                    <span className="flex items-center justify-end gap-1">
                      <ClipboardList className="w-3.5 h-3.5" />
                      {dailyTaskHourlyRate > 0 ? 'Task Pay' : 'Task Hours'}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryLoading ? (
                  <TableRow><TableCell colSpan={12} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
                ) : (
                  summary?.technicians.map(t => {
                    const taskData = taskHoursMap.get(t.userId);
                    return (
                      <TableRow
                        key={t.userId}
                        title={`Click to view detailed payroll breakdown for ${t.name}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedTechId(t.userId)}
                      >
                        <TableCell>
                          <p className="font-medium" title={t.name}>{t.name}</p>
                          <p className="text-xs text-muted-foreground capitalize" title={`Role: ${(t.role ?? '').replace(/_/g, ' ')}`}>{(t.role ?? '').replace(/_/g, ' ')}</p>
                        </TableCell>
                        <TableCell className="text-right" title={`${t.jobCount} job${t.jobCount !== 1 ? 's' : ''} completed`}>{t.jobCount}</TableCell>
                        <TableCell className="text-right" title={`Gross revenue: ${fmt(t.totalRevenue)}`}>{fmt(t.totalRevenue)}</TableCell>
                        <TableCell className="text-right text-destructive" title={`Customer sell-price material amount deducted: −${fmt(t.totalMaterialCost)}`}>−{fmt(t.totalMaterialCost)}</TableCell>
                        <TableCell className="text-right font-medium" title={`Net labor revenue: ${fmt(t.netLaborRevenue)}`}>{fmt(t.netLaborRevenue)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`font-bold ${t.p4pEarnings > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`} title={`P4P earnings: ${fmt(t.p4pEarnings)}`}>
                            {fmt(t.p4pEarnings)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {t.baseHourlyRate == null ? <span className="text-xs text-amber-700" title="No hourly rate set for this user (Team settings)">Not configured</span> : `${fmt(t.baseHourlyRate)}/hr`}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{t.clockHours != null ? t.clockHours.toFixed(2) : '—'}</TableCell>
                        <TableCell className="text-right text-sm">{t.basePay == null ? <span className="text-muted-foreground">—</span> : fmt(t.basePay)}</TableCell>
                        <TableCell className="text-right text-sm" data-testid={`text-acq-bonus-${t.userId}`}>
                          {(t.acquisitionBonusPay ?? 0) > 0 ? <span className="font-medium text-violet-700" title="Earned acquisition reward, not part of P4P">{fmt(t.acquisitionBonusPay ?? 0)}</span> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {(() => {
                            const gross = t.grossPay ?? t.p4pEarnings;
                            const source = t.basePay == null ? 'P4P (no base rate)' : (t.basePay >= t.p4pEarnings ? 'Hourly guarantee' : 'P4P');
                            return (
                              <span title={`Greater of base ${t.basePay == null ? 'n/a' : fmt(t.basePay)} or P4P ${fmt(t.p4pEarnings)}${(t.acquisitionBonusPay ?? 0) > 0 ? `, plus acquisition bonus ${fmt(t.acquisitionBonusPay ?? 0)}` : ''}`}>
                                <span className="font-bold">{fmt(gross)}</span>
                                <span className="block text-[10px] text-muted-foreground">{source}</span>
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          {taskData ? (
                            <span className="text-blue-700 font-medium text-sm" title={dailyTaskHourlyRate > 0 ? `Task pay: ${fmt(taskPayForMinutes(taskData.totalMinutes))} for ${fmtMinutes(taskData.totalMinutes)}` : `Task time: ${fmtMinutes(taskData.totalMinutes)} (${taskData.runCount} run${taskData.runCount !== 1 ? 's' : ''})`}>
                              {dailyTaskHourlyRate > 0 ? (
                                <>
                                  {fmt(taskPayForMinutes(taskData.totalMinutes))}
                                  <span className="text-xs text-muted-foreground ml-1">({fmtMinutes(taskData.totalMinutes)})</span>
                                </>
                              ) : (
                                <>
                                  {fmtMinutes(taskData.totalMinutes)}
                                  <span className="text-xs text-muted-foreground ml-1">({taskData.runCount})</span>
                                </>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Timesheet section — admin only, all-employee view */}
      {!isTechnician && !selectedTechId && (
        <TimesheetSection
          clockInSummary={clockInSummary ?? []}
          taskHoursSummary={taskHoursSummary ?? []}
          period={period}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      )}

      {/* Per-job breakdown table */}
      {(selectedTechId != null || isTechnician) && (
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Job-Level P4P Breakdown
                {myStats && <span className="text-muted-foreground font-normal ml-2">— {myStats.name}</span>}
              </CardTitle>
              <CardDescription>
                Formula per job: (Customer Total − Customer Sell-Price Materials) × Service P4P% = Earnings.
                Material amounts are recorded sell-price snapshots, deducted once; expand a row for details and multi-tech splits.
              </CardDescription>
            </div>
            {!isTechnician && selectedTechId && (
              <Button variant="ghost" size="sm" title="Return to the full payroll summary for all technicians" onClick={() => setSelectedTechId(null)}>← Back to all</Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {jobsLoading ? (
              <div className="py-10 text-center text-muted-foreground">Loading jobs...</div>
            ) : displayJobs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p>No completed jobs with P4P data for this period.</p>
                {summary?.globalP4pPct === 0 && (
                  <p className="text-sm text-amber-600 mt-2">P4P master rate is 0%. Set a rate in Settings → Operational → Global P4P Master %.</p>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6" />
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">−Customer Sell-Price Materials</TableHead>
                    <TableHead className="text-right">Net Labor</TableHead>
                    <TableHead className="text-right">P4P Rate</TableHead>
                    <TableHead className="text-right">Earnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayJobs.map(job => (
                    <JobRow key={job.jobId} job={job} highlightUserId={viewUserId} />
                  ))}
                </TableBody>
                <tfoot>
                  <tr className="border-t-2">
                    <td />
                    <td className="px-4 py-3 text-sm font-semibold" title={`${displayJobs.length} job${displayJobs.length !== 1 ? 's' : ''} total`}>{displayJobs.length} job{displayJobs.length !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold" title={`Total gross revenue: ${fmt(displayJobs.reduce((s, j) => s + j.totalAmount, 0))}`}>
                      {fmt(displayJobs.reduce((s, j) => s + j.totalAmount, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-destructive" title={`Total customer sell-price materials deducted: −${fmt(displayJobs.reduce((s, j) => s + j.materialCost, 0))}`}>
                      −{fmt(displayJobs.reduce((s, j) => s + j.materialCost, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold" title={`Total net labor revenue: ${fmt(displayJobs.reduce((s, j) => s + j.netLaborRevenue, 0))}`}>
                      {fmt(displayJobs.reduce((s, j) => s + j.netLaborRevenue, 0))}
                    </td>
                    <td />
                    <td className="px-4 py-3 text-right text-sm font-bold text-emerald-700">
                      {fmt(displayJobs.reduce((s, j) => {
                        const myEarnings = viewUserId
                          ? (j.splits.find(sp => sp.userId === viewUserId)?.earnings ?? 0)
                          : j.p4pPool;
                        return s + myEarnings;
                      }, 0))}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* If nothing is selected (admin) and no techs, show empty state */}
      {!isTechnician && !selectedTechId && !summaryLoading && (summary?.technicians.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="font-medium text-lg mb-2">No P4P data yet</p>
            <p className="text-muted-foreground text-sm">Complete some jobs and set a P4P master percentage in Settings → Operational to see payroll data here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
