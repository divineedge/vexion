import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { downloadCsv } from '@/lib/csvExport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { customFetch, useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import {
  RadialBarChart, RadialBar, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, AlertTriangle, Clock, CheckCircle, Activity,
  Download, Users, Layers, BarChart2, Building2,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface TechMetric {
  userId: number;
  name: string;
  role: string;
  clockMinutes: number;
  jobSeconds: number;
  budgetMinutes: number;
  budgetJobCount: number;
  clockEfficiency: number | null;
  budgetEfficiency: number | null;
  efficiencyRate: number | null; // alias for clockEfficiency (legacy)
  callbacks: number;
  completedJobs: number;
  callbackRatio: number;
  hasWarning: boolean;
}

interface EfficiencyResponse {
  period: string;
  rangeStart: string;
  rangeEnd: string;
  companyEfficiencyRate: number | null;
  companyBudgetEfficiency: number | null;
  companyCallbackRatio: number;
  totalBudgetMinutes: number;
  totalJobSeconds: number;
  technicians: TechMetric[];
}

interface CrewMetric {
  crewId: number;
  name: string;
  budgetMinutes: number;
  jobSeconds: number;
  completedJobs: number;
  callbacks: number;
  callbackRatio: number;
  budgetEfficiency: number | null;
}

interface CrewResponse {
  crews: CrewMetric[];
}

interface ServiceMetric {
  serviceId: number | null;
  serviceName: string;
  budgetMinutes: number;
  jobSeconds: number;
  completedJobs: number;
  callbacks: number;
  callbackRatio: number;
  budgetEfficiency: number | null;
}

interface ServiceResponse {
  services: ServiceMetric[];
}

interface TrendPoint {
  date: string;
  efficiencyRate: number | null;
  budgetEfficiency: number | null;
  clockMinutes: number;
  jobMinutes: number;
  budgetMinutes: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EfficiencyGauge({ value, size = 120 }: { value: number | null; size?: number }) {
  const pct = Math.min(value ?? 0, 100);
  const color = pct >= 100 ? '#10B981' : pct >= 80 ? '#F59E0B' : '#EF4444';
  const gaugeData = [{ name: 'eff', value: pct, fill: color }];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Background track */}
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="65%" outerRadius="100%" data={[{ value: 100, fill: 'hsl(var(--muted))' }]} startAngle={220} endAngle={-40}>
          <RadialBar dataKey="value" cornerRadius={4} background={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      {/* Filled arc */}
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="65%" outerRadius="100%"
            data={gaugeData}
            startAngle={220}
            endAngle={220 - (260 * pct / 100)}
          >
            <RadialBar dataKey="value" cornerRadius={4} background={false} />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold tabular-nums" style={{ fontSize: size * 0.17, color }}>
          {value != null ? (value > 100 ? `${value}%` : `${value}%`) : '—'}
        </span>
      </div>
    </div>
  );
}

/** Horizontal budget-vs-actual bar  */
function BudgetBar({ budgetMinutes, actualMinutes, label = true }: { budgetMinutes: number; actualMinutes: number; label?: boolean }) {
  if (budgetMinutes <= 0 && actualMinutes <= 0) return null;
  const max = Math.max(budgetMinutes, actualMinutes, 1);
  const budgetPct = Math.min((budgetMinutes / max) * 100, 100);
  const actualPct = Math.min((actualMinutes / max) * 100, 100);
  const overBudget = actualMinutes > budgetMinutes && budgetMinutes > 0;

  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const min = Math.round(m % 60);
    return h > 0 ? `${h}h ${min}m` : `${min}m`;
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Budget vs Actual</span>
          <span className={overBudget ? 'text-destructive font-medium' : 'text-emerald-600 font-medium'}>
            {budgetMinutes > 0 && actualMinutes > 0
              ? overBudget
                ? `+${fmt(actualMinutes - budgetMinutes)} over`
                : `${fmt(budgetMinutes - actualMinutes)} under`
              : ''}
          </span>
        </div>
      )}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-12 shrink-0">Budget</span>
          <div className="flex-1 bg-muted rounded-full h-2">
            <div className="bg-blue-400 h-2 rounded-full transition-all" style={{ width: `${budgetPct}%` }} />
          </div>
          <span className="text-xs font-mono w-14 text-right">{budgetMinutes > 0 ? fmt(budgetMinutes) : '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-12 shrink-0">Actual</span>
          <div className="flex-1 bg-muted rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${overBudget ? 'bg-destructive' : 'bg-emerald-500'}`} style={{ width: `${actualPct}%` }} />
          </div>
          <span className="text-xs font-mono w-14 text-right">{actualMinutes > 0 ? fmt(actualMinutes) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

function effColor(rate: number | null) {
  if (rate == null) return '#6B7280';
  return rate >= 100 ? '#10B981' : rate >= 80 ? '#F59E0B' : '#EF4444';
}

function effLabel(rate: number | null) {
  if (rate == null) return 'No data';
  if (rate >= 100) return 'Under Budget ✓';
  if (rate >= 80) return 'Near Budget';
  return 'Over Budget';
}

// ── Main component ────────────────────────────────────────────────────────────

type ViewTab = 'company' | 'employee' | 'crew' | 'service';

export default function EfficiencyPage() {
  const { isTechnician, user } = useAuth();
  const [period, setPeriod] = useState('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [techSearch, setTechSearch] = useState('');
  const [view, setView] = useState<ViewTab>('employee');
  const [techSort, setTechSort] = useState<'name' | 'budget' | 'clock' | 'completed' | 'callback'>('budget');

  const periodQuery = period === 'custom' && customFrom && customTo
    ? `startDate=${customFrom}&endDate=${customTo}`
    : `period=${period}`;

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const cbThreshold = (settings as any)?.callbackWarningThresholdPct ?? 10;

  const enabled = period !== 'custom' || (!!customFrom && !!customTo);

  const { data: metrics, isLoading } = useQuery<EfficiencyResponse>({
    queryKey: ['efficiency', period, customFrom, customTo],
    queryFn: () => customFetch<EfficiencyResponse>(`/api/efficiency?${periodQuery}`),
    enabled,
  });

  const { data: crewData, isLoading: crewLoading } = useQuery<CrewResponse>({
    queryKey: ['efficiency-crew', period, customFrom, customTo],
    queryFn: () => customFetch<CrewResponse>(`/api/efficiency/by-crew?${periodQuery}`),
    enabled: enabled && !isTechnician,
  });

  const { data: serviceData, isLoading: serviceLoading } = useQuery<ServiceResponse>({
    queryKey: ['efficiency-service', period, customFrom, customTo],
    queryFn: () => customFetch<ServiceResponse>(`/api/efficiency/by-service?${periodQuery}`),
    enabled: enabled && !isTechnician,
  });

  const { data: trend } = useQuery<{ trend: TrendPoint[] }>({
    queryKey: ['efficiency-trend', selectedUserId],
    queryFn: () =>
      customFetch<{ trend: TrendPoint[] }>(
        `/api/efficiency/trend?days=30${selectedUserId ? `&userId=${selectedUserId}` : ''}`,
      ),
  });

  // Technician list — technicians only see themselves
  const rawTechList = isTechnician
    ? (metrics?.technicians ?? []).filter(t => t.userId === user?.id)
    : (metrics?.technicians ?? []);
  const techList = [...rawTechList]
    .filter(t => !techSearch.trim() || (t.name ?? '').toLowerCase().includes(techSearch.toLowerCase()))
    .sort((a, b) => {
      if (techSort === 'name') return (a.name ?? '').localeCompare(b.name ?? '');
      if (techSort === 'clock') return (b.clockEfficiency ?? 0) - (a.clockEfficiency ?? 0);
      if (techSort === 'completed') return b.completedJobs - a.completedJobs;
      if (techSort === 'callback') return b.callbackRatio - a.callbackRatio;
      // 'budget': budget efficiency, nulls last
      if ((a.budgetEfficiency == null) !== (b.budgetEfficiency == null))
        return a.budgetEfficiency == null ? 1 : -1;
      return (b.budgetEfficiency ?? 0) - (a.budgetEfficiency ?? 0);
    });

  const warningTechs = (metrics?.technicians ?? []).filter(t => t.hasWarning);
  const totalCompletedJobs = (metrics?.technicians ?? []).reduce((s, t) => s + t.completedJobs, 0);
  const totalCallbacks = (metrics?.technicians ?? []).reduce((s, t) => s + t.callbacks, 0);

  // ── CSV export helpers ─────────────────────────────────────────────────────
  function exportEmployee() {
    const rows = (metrics?.technicians ?? []).map(t => ({
      Name: t.name,
      Role: t.role,
      'Completed Jobs': t.completedJobs,
      'Budget Minutes': t.budgetMinutes,
      'Actual Job Minutes': Math.round(t.jobSeconds / 60),
      'Budget Efficiency %': t.budgetEfficiency ?? '',
      'Clock Minutes': t.clockMinutes,
      'Clock Efficiency %': t.clockEfficiency ?? '',
      'Yellow Slips (Callbacks)': t.callbacks,
      'Callback Ratio %': t.callbackRatio,
      'Quality Warning': t.hasWarning ? 'Yes' : 'No',
    }));
    downloadCsv(`p4p-employee-${period}.csv`, rows);
  }
  function exportCrew() {
    const rows = (crewData?.crews ?? []).map(c => ({
      Crew: c.name,
      'Completed Jobs': c.completedJobs,
      'Budget Minutes': c.budgetMinutes,
      'Actual Job Minutes': Math.round(c.jobSeconds / 60),
      'Budget Efficiency %': c.budgetEfficiency ?? '',
      'Yellow Slips (Callbacks)': c.callbacks,
      'Callback Ratio %': c.callbackRatio,
    }));
    downloadCsv(`p4p-crew-${period}.csv`, rows);
  }
  function exportService() {
    const rows = (serviceData?.services ?? []).map(s => ({
      Service: s.serviceName,
      'Completed Jobs': s.completedJobs,
      'Budget Minutes': s.budgetMinutes,
      'Actual Job Minutes': Math.round(s.jobSeconds / 60),
      'Budget Efficiency %': s.budgetEfficiency ?? '',
      'Yellow Slips (Callbacks)': s.callbacks,
      'Callback Ratio %': s.callbackRatio,
    }));
    downloadCsv(`p4p-service-${period}.csv`, rows);
  }

  // ── View tab config ────────────────────────────────────────────────────────
  const tabs: { key: ViewTab; label: string; icon: React.ReactNode }[] = isTechnician
    ? [{ key: 'employee', label: 'My Stats', icon: <Users className="w-3.5 h-3.5" /> }]
    : [
        { key: 'company', label: 'Company', icon: <Building2 className="w-3.5 h-3.5" /> },
        { key: 'employee', label: 'Employee', icon: <Users className="w-3.5 h-3.5" /> },
        { key: 'crew', label: 'Crew', icon: <Layers className="w-3.5 h-3.5" /> },
        { key: 'service', label: 'Service Type', icon: <BarChart2 className="w-3.5 h-3.5" /> },
      ];

  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const min = Math.round(m % 60);
    return h > 0 ? `${h}h ${min}m` : `${min}m`;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">P4P Efficiency</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Budget Efficiency = Budget hrs ÷ Actual hrs · Yellow slips = callbacks
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {period === 'custom' && (
            <>
              <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-9 w-34 text-sm" />
              <span className="text-muted-foreground text-sm">–</span>
              <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-9 w-34 text-sm" />
            </>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-38 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="custom">Custom Range…</SelectItem>
            </SelectContent>
          </Select>
          {view === 'employee' && (
            <Input
              value={techSearch} onChange={e => setTechSearch(e.target.value)}
              placeholder="Search…" className="h-9 text-sm w-36"
            />
          )}
          {view === 'employee' && metrics && !isTechnician && (
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={exportEmployee}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
          )}
          {view === 'crew' && crewData && (
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={exportCrew}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
          )}
          {view === 'service' && serviceData && (
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={exportService}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
          )}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-1.5 border-b pb-0">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px
              ${view === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── COMPANY view ─────────────────────────────────────────────────── */}
      {view === 'company' && (
        <div className="space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Budget efficiency */}
            <Card>
              <CardContent className="p-5 flex items-center gap-3">
                <EfficiencyGauge value={metrics?.companyBudgetEfficiency ?? null} size={72} />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Budget Efficiency</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Budget ÷ Actual hrs</p>
                  <p className="text-xs mt-1 font-medium" style={{ color: effColor(metrics?.companyBudgetEfficiency ?? null) }}>
                    {effLabel(metrics?.companyBudgetEfficiency ?? null)}
                  </p>
                </div>
              </CardContent>
            </Card>
            {/* Clock efficiency */}
            <Card>
              <CardContent className="p-5 flex items-center gap-3">
                <EfficiencyGauge value={metrics?.companyEfficiencyRate ?? null} size={72} />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Clock Efficiency</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Job time ÷ Clock time</p>
                </div>
              </CardContent>
            </Card>
            {/* Budget vs actual */}
            <Card className="col-span-2">
              <CardContent className="p-5 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Company Budget vs Actual</p>
                <BudgetBar
                  budgetMinutes={metrics?.totalBudgetMinutes ?? 0}
                  actualMinutes={metrics ? Math.round(metrics.totalJobSeconds / 60) : 0}
                  label
                />
                <div className="flex gap-4 text-xs text-muted-foreground pt-1">
                  <span>
                    <span className="font-medium text-foreground">{totalCompletedJobs}</span> completed jobs
                  </span>
                  <span>
                    <span className={`font-medium ${totalCallbacks > 0 ? 'text-amber-600' : 'text-foreground'}`}>{totalCallbacks}</span> yellow slips
                  </span>
                  <span>
                    <span className={`font-medium ${(metrics?.companyCallbackRatio ?? 0) > cbThreshold ? 'text-destructive' : 'text-foreground'}`}>
                      {metrics?.companyCallbackRatio ?? 0}%
                    </span> callback rate
                  </span>
                  <span>
                    <span className={`font-medium ${warningTechs.length > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                      {warningTechs.length}
                    </span> quality warnings
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Company bar chart — employee comparison */}
          {(metrics?.technicians ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Employee Budget Efficiency Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(metrics?.technicians ?? [])
                        .filter(t => t.budgetEfficiency != null || t.budgetMinutes > 0)
                        .map(t => ({ name: t.name.split(' ')[0], efficiency: t.budgetEfficiency, callbacks: t.callbacks, completedJobs: t.completedJobs }))}
                      margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} domain={[0, 150]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 12 }}
                        formatter={(v: number, name: string) => name === 'efficiency' ? [`${v}%`, 'Budget Efficiency'] : [v, name === 'callbacks' ? 'Yellow Slips' : 'Jobs']}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === 'efficiency' ? 'Budget Efficiency' : v === 'callbacks' ? 'Yellow Slips' : 'Jobs Done'} />
                      {/* 100% line */}
                      <Line type="monotone" dataKey={() => 100} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1} dot={false} name="Target" />
                      <Bar dataKey="efficiency" name="efficiency" radius={[4, 4, 0, 0]}>
                        {(metrics?.technicians ?? [])
                          .filter(t => t.budgetEfficiency != null || t.budgetMinutes > 0)
                          .map((t, i) => (
                            <Cell key={i} fill={effColor(t.budgetEfficiency)} />
                          ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Green = under budget (≥100%). Requires jobs to have estimated hours set.</p>
              </CardContent>
            </Card>
          )}

          {/* Trend */}
          {trend && trend.trend.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5" /> 30-Day Company Efficiency Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend.trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false}
                        tickFormatter={d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} domain={[0, 150]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 12 }}
                        formatter={(v: number, name: string) => [`${v}%`, name === 'budgetEfficiency' ? 'Budget Eff.' : 'Clock Eff.']}
                        labelFormatter={l => new Date(l as string).toLocaleDateString()}
                      />
                      <Line type="monotone" dataKey={() => 100} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1} dot={false} name="Target 100%" />
                      <Line type="monotone" dataKey="budgetEfficiency" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls name="budgetEfficiency" />
                      <Line type="monotone" dataKey="efficiencyRate" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} dot={false} strokeDasharray="3 2" connectNulls name="efficiencyRate" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Solid = Budget Efficiency · Dashed = Clock Efficiency · Green line = 100% (on budget)</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── EMPLOYEE view ────────────────────────────────────────────────── */}
      {view === 'employee' && (
        <div className="space-y-4">
          {/* Sort bar */}
          {!isTechnician && techList.length > 1 && (
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground shrink-0 text-xs">Sort:</span>
              {([
                { key: 'budget', label: 'Budget Eff.' },
                { key: 'clock', label: 'Clock Eff.' },
                { key: 'completed', label: 'Jobs Done' },
                { key: 'callback', label: 'Yellow Slips' },
                { key: 'name', label: 'Name' },
              ] as const).map(s => (
                <button key={s.key} onClick={() => setTechSort(s.key)}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${techSort === s.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="animate-pulse"><CardContent className="p-6 h-48" /></Card>
                ))
              : techList.length === 0
              ? (
                  <div className="col-span-3 py-16 text-center text-muted-foreground">
                    <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>No clock-in data for this period.</p>
                  </div>
                )
              : techList.map(tech => (
                  <Card
                    key={tech.userId}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${tech.hasWarning ? 'border-amber-300' : ''} ${selectedUserId === tech.userId ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => { setSelectedUserId(s => s === tech.userId ? null : tech.userId); setView('employee'); }}
                  >
                    <CardContent className="p-4 space-y-3">
                      {/* Name + badges */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm leading-tight">{tech.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{tech.role.replace(/_/g, ' ')}</p>
                        </div>
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          {tech.hasWarning && (
                            <Badge variant="destructive" className="gap-1 text-xs py-0.5">
                              <AlertTriangle className="w-3 h-3" /> Yellow Slip
                            </Badge>
                          )}
                          {tech.budgetEfficiency != null && (
                            <Badge variant="outline" className="text-xs py-0.5" style={{ color: effColor(tech.budgetEfficiency), borderColor: effColor(tech.budgetEfficiency) + '60' }}>
                              {tech.budgetEfficiency}%
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Gauges */}
                      <div className="flex items-center gap-3">
                        <div className="text-center">
                          <EfficiencyGauge value={tech.budgetEfficiency} size={64} />
                          <p className="text-[10px] text-muted-foreground mt-0.5">Budget</p>
                        </div>
                        <div className="text-center">
                          <EfficiencyGauge value={tech.clockEfficiency} size={64} />
                          <p className="text-[10px] text-muted-foreground mt-0.5">Clock</p>
                        </div>
                        <div className="flex-1 space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Jobs</span>
                            <span className="font-medium">{tech.completedJobs}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Clock</span>
                            <span className="font-medium">{fmt(tech.clockMinutes)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className={`flex items-center gap-1 ${tech.hasWarning ? 'text-destructive' : 'text-muted-foreground'}`}>
                              <AlertTriangle className="w-3 h-3" /> Slips
                            </span>
                            <span className={`font-medium ${tech.hasWarning ? 'text-destructive' : ''}`}>
                              {tech.callbacks} ({tech.callbackRatio}%)
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Budget bar */}
                      <BudgetBar
                        budgetMinutes={tech.budgetMinutes}
                        actualMinutes={Math.round(tech.jobSeconds / 60)}
                      />

                      {/* Links */}
                      <div className="flex gap-3 pt-0.5">
                        <button className="text-xs text-primary hover:underline"
                          onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}settings?tab=users&userId=${tech.userId}`; }}>
                          Employee →
                        </button>
                        <button className="text-xs text-muted-foreground hover:underline"
                          onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}callbacks?assignee=${tech.userId}`; }}>
                          View yellow slips →
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
          </div>

          {/* Trend sparkline */}
          {trend && trend.trend.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5" />
                  30-Day Trend
                  {selectedUserId
                    ? <span className="font-normal text-muted-foreground">— {techList.find(t => t.userId === selectedUserId)?.name}</span>
                    : <span className="font-normal text-muted-foreground">— Company average (click a card to filter)</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend.trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false}
                        tickFormatter={d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} domain={[0, 150]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 12 }}
                        formatter={(v: number, name: string) => [`${v}%`, name === 'budgetEfficiency' ? 'Budget Eff.' : 'Clock Eff.']}
                        labelFormatter={l => new Date(l as string).toLocaleDateString()}
                      />
                      <Line type="monotone" dataKey={() => 100} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1} dot={false} name="100% target" />
                      <Line type="monotone" dataKey="budgetEfficiency" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} connectNulls name="budgetEfficiency" />
                      <Line type="monotone" dataKey="efficiencyRate" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="3 2" dot={false} connectNulls name="efficiencyRate" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Solid = Budget Efficiency · Dashed = Clock Efficiency · 100% = finished exactly on budget</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── CREW view ─────────────────────────────────────────────────────── */}
      {view === 'crew' && (
        <div className="space-y-4">
          {crewLoading
            ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="animate-pulse"><CardContent className="p-6 h-40" /></Card>)}</div>
            : !crewData || crewData.crews.length === 0
            ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No crew data for this period.</p>
                  <p className="text-sm mt-1">Assign jobs to a crew and mark them complete to see results.</p>
                </div>
              )
            : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {crewData.crews.map(crew => (
                    <Card key={crew.crewId}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm">{crew.name}</p>
                          {crew.budgetEfficiency != null && (
                            <Badge variant="outline" className="text-xs py-0.5" style={{ color: effColor(crew.budgetEfficiency), borderColor: effColor(crew.budgetEfficiency) + '60' }}>
                              {crew.budgetEfficiency}%
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-center">
                            <EfficiencyGauge value={crew.budgetEfficiency} size={64} />
                            <p className="text-[10px] text-muted-foreground mt-0.5">Budget Eff.</p>
                          </div>
                          <div className="flex-1 space-y-1.5 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Jobs</span>
                              <span className="font-medium">{crew.completedJobs}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Actual</span>
                              <span className="font-medium">{fmt(Math.round(crew.jobSeconds / 60))}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className={`flex items-center gap-1 ${crew.callbackRatio > cbThreshold ? 'text-destructive' : 'text-muted-foreground'}`}>
                                <AlertTriangle className="w-3 h-3" /> Slips
                              </span>
                              <span className={`font-medium ${crew.callbackRatio > cbThreshold ? 'text-destructive' : ''}`}>
                                {crew.callbacks} ({crew.callbackRatio}%)
                              </span>
                            </div>
                          </div>
                        </div>

                        <BudgetBar
                          budgetMinutes={crew.budgetMinutes}
                          actualMinutes={Math.round(crew.jobSeconds / 60)}
                        />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

          {/* Crew comparison bar chart */}
          {crewData && crewData.crews.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Crew Budget Efficiency Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={crewData.crews.map(c => ({ name: c.name, efficiency: c.budgetEfficiency, slips: c.callbacks }))}
                      margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} domain={[0, 150]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 12 }}
                        formatter={(v: number, name: string) => [name === 'efficiency' ? `${v}%` : v, name === 'efficiency' ? 'Budget Efficiency' : 'Yellow Slips']}
                      />
                      <Bar dataKey="efficiency" name="efficiency" radius={[4, 4, 0, 0]}>
                        {crewData.crews.map((c, i) => <Cell key={i} fill={effColor(c.budgetEfficiency)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── SERVICE TYPE view ─────────────────────────────────────────────── */}
      {view === 'service' && (
        <div className="space-y-4">
          {serviceLoading
            ? <Card className="animate-pulse"><CardContent className="p-6 h-40" /></Card>
            : !serviceData || serviceData.services.length === 0
            ? (
                <div className="py-16 text-center text-muted-foreground">
                  <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No service-type data for this period.</p>
                  <p className="text-sm mt-1">Complete jobs with a service assigned and estimated hours set to see results.</p>
                </div>
              )
            : (
                <>
                  {/* Bar chart at top */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Budget Efficiency by Service Type</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={serviceData.services.map(s => ({
                              name: s.serviceName.length > 14 ? s.serviceName.slice(0, 12) + '…' : s.serviceName,
                              fullName: s.serviceName,
                              efficiency: s.budgetEfficiency,
                              jobs: s.completedJobs,
                              slips: s.callbacks,
                            }))}
                            margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                            <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} domain={[0, 150]} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 12 }}
                              formatter={(v: number, name: string) => [
                                name === 'efficiency' ? (v != null ? `${v}%` : '—') : v,
                                name === 'efficiency' ? 'Budget Efficiency' : name === 'slips' ? 'Yellow Slips' : 'Jobs'
                              ]}
                              labelFormatter={(_, p) => (p?.[0]?.payload as any)?.fullName ?? ''}
                            />
                            <Bar dataKey="efficiency" name="efficiency" radius={[4, 4, 0, 0]}>
                              {serviceData.services.map((s, i) => <Cell key={i} fill={effColor(s.budgetEfficiency)} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Detail table */}
                  <Card>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="px-4 py-2.5 font-medium">Service Type</th>
                            <th className="px-4 py-2.5 font-medium text-right">Jobs</th>
                            <th className="px-4 py-2.5 font-medium text-right">Budget</th>
                            <th className="px-4 py-2.5 font-medium text-right">Actual</th>
                            <th className="px-4 py-2.5 font-medium text-right">Budget Eff.</th>
                            <th className="px-4 py-2.5 font-medium text-right">Yellow Slips</th>
                            <th className="px-4 py-2.5 font-medium text-right">Slip Rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {serviceData.services.map(s => (
                            <tr key={s.serviceId ?? 'none'} className="hover:bg-muted/40 transition-colors">
                              <td className="px-4 py-2.5 font-medium">{s.serviceName}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{s.completedJobs}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{s.budgetMinutes > 0 ? fmt(s.budgetMinutes) : '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{s.jobSeconds > 0 ? fmt(Math.round(s.jobSeconds / 60)) : '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium" style={{ color: effColor(s.budgetEfficiency) }}>
                                {s.budgetEfficiency != null ? `${s.budgetEfficiency}%` : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                <span className={s.callbacks > 0 ? 'text-amber-600 font-medium' : ''}>{s.callbacks}</span>
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                <span className={s.callbackRatio > cbThreshold ? 'text-destructive font-medium' : ''}>{s.callbackRatio}%</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}
        </div>
      )}

      {/* Budget hours note */}
      <p className="text-xs text-muted-foreground">
        Budget efficiency requires "Estimated hours" to be set on each job. Set them on the job detail page or have them carry over from accepted estimates.
        Yellow slips (callbacks) are tracked separately on the Callbacks page.
      </p>
    </div>
  );
}
