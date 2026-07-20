import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { DollarSign, ChevronDown, ChevronRight, Package, Wrench, Users, TrendingUp, Info, ClipboardList } from 'lucide-react';

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
    <Badge variant="outline" className={`text-xs gap-1 ${usingGlobal ? 'text-muted-foreground' : 'text-primary border-primary/40'}`}>
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
            <span className="text-sm text-destructive">−{fmt(job.materialCost)}</span>
          </TableCell>
          <TableCell className="text-right text-sm font-medium">{fmt(job.netLaborRevenue)}</TableCell>
          <TableCell className="text-right">{pctBadge(job.p4pPct, job.usingGlobalRate)}</TableCell>
          <TableCell className="text-right text-sm font-semibold text-emerald-700">{fmt(myEarnings)}</TableCell>
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
                  <span>Materials deducted before P4P calculation: <span className="font-semibold text-foreground">{fmt(job.materialCost)}</span></span>
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

/* ─── Page ───────────────────────────────────────────────────────────────────── */
export default function PayrollPage() {
  const { isTechnician, user, isOwner, canManageOffice } = useAuth();
  const [period, setPeriod] = useState('30d');
  const [selectedTechId, setSelectedTechId] = useState<number | null>(null);

  // Technicians cannot call /p4p/summary (403); their stats come via /p4p/jobs
  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryResponse>({
    queryKey: ['p4p-summary', period],
    queryFn: () => customFetch<SummaryResponse>(`/api/p4p/summary?period=${period}`),
    enabled: !isTechnician,
    retry: false,
  });

  const viewUserId = isTechnician ? user?.id : (selectedTechId ?? undefined);

  const { data: jobs, isLoading: jobsLoading } = useQuery<JobBreakdown[]>({
    queryKey: ['p4p-jobs', period, viewUserId],
    queryFn: () =>
      customFetch<JobBreakdown[]>(
        `/api/p4p/jobs?period=${period}${viewUserId ? `&userId=${viewUserId}` : ''}`,
      ),
  });

  // Admin: daily task hours per technician for the same period
  const { dateFrom, dateTo } = periodToRange(period);
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

  const myStats = isTechnician
    ? summary?.technicians.find(t => t.userId === user?.id)
    : selectedTechId
      ? summary?.technicians.find(t => t.userId === selectedTechId)
      : null;

  const displayJobs = jobs ?? [];

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
              ? 'Your Pay-for-Performance earnings — labor revenue after material deductions.'
              : 'Run P4P payroll — review per-technician earnings before issuing bonuses.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isTechnician && (
            <Select value={selectedTechId ? String(selectedTechId) : '__all__'} onValueChange={v => setSelectedTechId(v === '__all__' ? null : parseInt(v, 10))}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All technicians</SelectItem>
                {summary?.technicians.map(t => (
                  <SelectItem key={t.userId} value={String(t.userId)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Global rate notice */}
      {summary && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg border">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Global P4P master rate: <span className="font-semibold text-foreground">{summary.globalP4pPct}%</span>.
          Services with a blueprint-level override will use that rate instead.
          {summary.globalP4pPct === 0 && <span className="text-amber-600 font-medium ml-1"> P4P is disabled — set a master % in Settings → Operational to activate.</span>}
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
                <p className="text-xl font-bold text-emerald-700">{fmt(totalP4P)}</p>
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
                <p className="text-xl font-bold">{fmt(totalNetLabor)}</p>
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
                <p className="text-xl font-bold">{fmt(totalMaterials)}</p>
                <p className="text-xs text-muted-foreground">Materials Stripped Out</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-bold">{summary?.technicians.filter(t => t.p4pEarnings > 0).length ?? 0}</p>
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
                <p className="text-xl font-bold text-blue-700">{fmtMinutes(totalTaskMinutes)}</p>
                <p className="text-xs text-muted-foreground">Daily Task Hours</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Individual tech stats (when drilling in or tech viewing own) */}
      {(myStats || isTechnician) && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'P4P Earnings', value: myStats ? fmt(myStats.p4pEarnings) : '—', accent: 'text-emerald-700' },
            { label: 'Net Labor Revenue', value: myStats ? fmt(myStats.netLaborRevenue) : '—', accent: '' },
            { label: 'Materials Deducted', value: myStats ? fmt(myStats.totalMaterialCost) : '—', accent: 'text-amber-600' },
            { label: 'Jobs Counted', value: myStats?.jobCount ?? '—', accent: '' },
            { label: 'Daily Task Hours', value: fmtMinutes(myTaskMinutes), accent: 'text-blue-700', sub: myTaskRuns > 0 ? `${myTaskRuns} run${myTaskRuns !== 1 ? 's' : ''}` : undefined },
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
            <CardDescription>Click a technician row to drill into their job-level breakdown. Daily Task Hours are compliance/admin time, not revenue-generating.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Technician</TableHead>
                  <TableHead className="text-right">Jobs</TableHead>
                  <TableHead className="text-right">Gross Revenue</TableHead>
                  <TableHead className="text-right">Materials Out</TableHead>
                  <TableHead className="text-right">Net Labor</TableHead>
                  <TableHead className="text-right">P4P Earnings</TableHead>
                  <TableHead className="text-right">
                    <span className="flex items-center justify-end gap-1">
                      <ClipboardList className="w-3.5 h-3.5" /> Task Hours
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryLoading ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
                ) : (
                  summary?.technicians.map(t => {
                    const taskData = taskHoursMap.get(t.userId);
                    return (
                      <TableRow
                        key={t.userId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedTechId(t.userId)}
                      >
                        <TableCell>
                          <p className="font-medium">{t.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{(t.role ?? '').replace(/_/g, ' ')}</p>
                        </TableCell>
                        <TableCell className="text-right">{t.jobCount}</TableCell>
                        <TableCell className="text-right">{fmt(t.totalRevenue)}</TableCell>
                        <TableCell className="text-right text-destructive">−{fmt(t.totalMaterialCost)}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(t.netLaborRevenue)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`font-bold ${t.p4pEarnings > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                            {fmt(t.p4pEarnings)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {taskData ? (
                            <span className="text-blue-700 font-medium text-sm">
                              {fmtMinutes(taskData.totalMinutes)}
                              <span className="text-xs text-muted-foreground ml-1">({taskData.runCount})</span>
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
                Formula per job: (Total Revenue − Materials) × Service P4P% = Earnings.
                Expand a row to see material deductions and multi-tech splits.
              </CardDescription>
            </div>
            {!isTechnician && selectedTechId && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedTechId(null)}>← Back to all</Button>
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
                    <TableHead className="text-right">−Materials</TableHead>
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
                    <td className="px-4 py-3 text-sm font-semibold">{displayJobs.length} job{displayJobs.length !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold">
                      {fmt(displayJobs.reduce((s, j) => s + j.totalAmount, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-destructive">
                      −{fmt(displayJobs.reduce((s, j) => s + j.materialCost, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold">
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
