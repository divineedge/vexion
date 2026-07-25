import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { downloadCsv } from '@/lib/csvExport';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { customFetch, useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import {
  RadialBarChart, RadialBar, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle, Activity, Users, DollarSign, Download } from 'lucide-react';

interface TechMetric {
  userId: number;
  name: string;
  role: string;
  clockMinutes: number;
  jobSeconds: number;
  efficiencyRate: number | null;
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
  companyCallbackRatio: number;
  technicians: TechMetric[];
}

interface TrendPoint {
  date: string;
  efficiencyRate: number | null;
  clockMinutes: number;
  jobMinutes: number;
}

function EfficiencyGauge({ value, size = 120 }: { value: number | null; size?: number }) {
  const pct = value ?? 0;
  const color = pct >= 80 ? '#10B981' : pct >= 60 ? '#F59E0B' : '#EF4444';
  const gaugeData = [{ name: 'efficiency', value: Math.min(pct, 100), fill: color }];
  const bgData = [{ name: 'bg', value: 100, fill: 'hsl(var(--muted))' }];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="65%"
          outerRadius="100%"
          data={bgData}
          startAngle={220}
          endAngle={-40}
        >
          <RadialBar dataKey="value" cornerRadius={4} background={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0" style={{ top: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="65%"
            outerRadius="100%"
            data={gaugeData}
            startAngle={220}
            endAngle={220 - (260 * Math.min(pct, 100) / 100)}
          >
            <RadialBar dataKey="value" cornerRadius={4} background={false} />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums" style={{ color }}>
          {value != null ? `${pct}%` : '—'}
        </span>
      </div>
    </div>
  );
}

export default function EfficiencyPage() {
  const { isTechnician, user } = useAuth();
  const [period, setPeriod] = useState('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [techSearch, setTechSearch] = useState('');

  const periodQuery = period === 'custom' && customFrom && customTo
    ? `startDate=${customFrom}&endDate=${customTo}`
    : `period=${period}`;

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const cbThreshold = (settings as any)?.callbackWarningThresholdPct ?? 10;

  const { data: metrics, isLoading } = useQuery<EfficiencyResponse>({
    queryKey: ['efficiency', period, customFrom, customTo],
    queryFn: () => customFetch<EfficiencyResponse>(`/api/efficiency?${periodQuery}`),
    enabled: period !== 'custom' || (!!customFrom && !!customTo),
  });

  const { data: trend } = useQuery<{ trend: TrendPoint[] }>({
    queryKey: ['efficiency-trend', selectedUserId],
    queryFn: () =>
      customFetch<{ trend: TrendPoint[] }>(
        `/api/efficiency/trend?days=30${selectedUserId ? `&userId=${selectedUserId}` : ''}`,
      ),
  });

  const [techSort, setTechSort] = useState<'name' | 'efficiency' | 'completed' | 'warning' | 'callback'>('warning');

  // Technicians shown: technician only sees themselves
  const rawTechList = isTechnician
    ? (metrics?.technicians ?? []).filter(t => t.userId === user?.id)
    : (metrics?.technicians ?? []);
  const techList = [...rawTechList].filter(t => !techSearch.trim() || (t.name ?? '').toLowerCase().includes(techSearch.toLowerCase())).sort((a, b) => {
    if (techSort === 'name') return (a.name ?? '').localeCompare(b.name ?? '');
    if (techSort === 'efficiency') return (b.efficiencyRate ?? 0) - (a.efficiencyRate ?? 0);
    if (techSort === 'completed') return (b.completedJobs ?? 0) - (a.completedJobs ?? 0);
    if (techSort === 'callback') return (b.callbackRatio ?? 0) - (a.callbackRatio ?? 0);
    // 'warning': warnings first, then by efficiency desc
    if (a.hasWarning !== b.hasWarning) return a.hasWarning ? -1 : 1;
    return (b.efficiencyRate ?? 0) - (a.efficiencyRate ?? 0);
  });

  const warningTechs = techList.filter(t => t.hasWarning);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Labor Efficiency</h1>
          <p className="text-muted-foreground mt-1">
            P4P engine · Efficiency = Active job minutes ÷ Total clock minutes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {period === 'custom' && (
            <>
              <Input type="date" title="Custom range start date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-9 w-36 text-sm" />
              <span className="text-muted-foreground text-sm">–</span>
              <Input type="date" title="Custom range end date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-9 w-36 text-sm" />
            </>
          )}
          <Select value={period} onValueChange={v => { setPeriod(v); }}>
            <SelectTrigger className="w-40" title="Select the reporting period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="custom">Custom Range…</SelectItem>
            </SelectContent>
          </Select>
          <Input
            title="Filter technicians by name"
            value={techSearch}
            onChange={e => setTechSearch(e.target.value)}
            placeholder="Search technician…"
            className="h-9 text-sm w-44"
          />
          {metrics && !isTechnician && (
            <Button size="sm" variant="outline" className="h-9 gap-2" onClick={() => {
              const rows = (metrics.technicians ?? []).map(t => ({
                Name: t.name,
                Role: t.role,
                'Completed Jobs': t.completedJobs,
                'Clock Minutes': t.clockMinutes,
                'Job Minutes': Math.round(t.jobSeconds / 60),
                'Efficiency %': t.efficiencyRate != null ? (t.efficiencyRate * 100).toFixed(1) : '',
                'Callback Ratio %': (t.callbackRatio * 100).toFixed(1),
                Callbacks: t.callbacks,
                Warning: t.hasWarning ? 'Yes' : 'No',
              }));
              downloadCsv(`efficiency-${period}.csv`, rows);
            }} title="Download efficiency data as a CSV file">
              <Download className="w-4 h-4" /> CSV
            </Button>
          )}
        </div>
      </div>

      {/* Company KPIs */}
      {!isTechnician && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-5 flex items-center gap-4">
              <EfficiencyGauge value={metrics?.companyEfficiencyRate ?? null} size={80} />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Company Efficiency</p>
                <p className="text-xs text-muted-foreground mt-0.5">All techs · {period}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center bg-primary/10">
                <CheckCircle className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Completed Jobs</p>
                <p className="text-2xl font-bold text-foreground" title={`${metrics?.technicians?.reduce((s, t) => s + (t.completedJobs ?? 0), 0) ?? 0} jobs completed this period`}>{metrics?.technicians?.reduce((s, t) => s + (t.completedJobs ?? 0), 0) ?? 0}</p>
                <p className="text-xs text-muted-foreground">{period}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${(metrics?.companyCallbackRatio ?? 0) > 10 ? 'bg-destructive/10' : 'bg-emerald-50'}`}>
                <span className={`text-lg font-bold ${(metrics?.companyCallbackRatio ?? 0) > 10 ? 'text-destructive' : 'text-emerald-600'}`} title={`Company-wide callback ratio: ${metrics?.companyCallbackRatio ?? 0}%`}>
                  {metrics?.companyCallbackRatio ?? 0}%
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Callback Ratio</p>
                <p className="text-xs text-muted-foreground mt-0.5">All time · {(metrics?.companyCallbackRatio ?? 0) > 10 ? '⚠ High' : '✓ Good'}</p>
              </div>
            </CardContent>
          </Card>
          <Card className={warningTechs.length > 0 ? 'border-destructive/50' : ''}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${warningTechs.length > 0 ? 'bg-destructive/10' : 'bg-muted'}`}>
                {warningTechs.length > 0
                  ? <AlertTriangle className="w-7 h-7 text-destructive" />
                  : <CheckCircle className="w-7 h-7 text-emerald-500" />}
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Quality Warnings</p>
                <p className={`text-2xl font-bold ${warningTechs.length > 0 ? 'text-destructive' : 'text-emerald-600'}`} title={warningTechs.length > 0 ? `${warningTechs.length} technician${warningTechs.length !== 1 ? 's' : ''} above ${cbThreshold}% callback threshold` : 'All technicians within callback threshold'}>{warningTechs.length}</p>
                <p className="text-xs text-muted-foreground">{warningTechs.length > 0 ? `Techs above ${cbThreshold}% callback rate` : 'All techs within threshold'}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Technician sort bar */}
      {!isTechnician && techList.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">Sort:</span>
          {(['warning', 'efficiency', 'completed', 'callback', 'name'] as const).map(s => (
            <button
              key={s}
              onClick={() => setTechSort(s)}
              className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${techSort === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
            >
              {s === 'warning' ? 'Warnings First' : s === 'efficiency' ? 'Efficiency' : s === 'completed' ? 'Jobs Done' : s === 'callback' ? 'Callback Ratio' : 'Name'}
            </button>
          ))}
        </div>
      )}

      {/* Technician cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="animate-pulse"><CardContent className="p-6 h-40" /></Card>
            ))
          : techList.length === 0
          ? (
              <div className="col-span-3 py-16 text-center text-muted-foreground">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No clock-in data for this period.</p>
                <p className="text-sm mt-1">Technicians need to use the Time Tracking clock to generate efficiency data.</p>
              </div>
            )
          : techList.map(tech => (
              <Card
                key={tech.userId}
                className={`cursor-pointer hover:shadow-md transition-shadow ${tech.hasWarning ? 'border-amber-300' : ''} ${selectedUserId === tech.userId ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setSelectedUserId(s => s === tech.userId ? null : tech.userId)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base" title={tech.name}>{tech.name}</CardTitle>
                      <CardDescription className="capitalize" title={`Role: ${tech.role.replace(/_/g, ' ')}`}>{tech.role.replace(/_/g, ' ')}</CardDescription>
                    </div>
                    <div className="flex gap-1.5">
                      {tech.hasWarning && (
                        <Badge variant="destructive" className="gap-1 text-xs">
                          <AlertTriangle className="w-3 h-3" /> CB Warning
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="flex items-center gap-4">
                    <EfficiencyGauge value={tech.efficiencyRate} size={80} />
                    <div className="space-y-2 text-sm flex-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Clock-in</span>
                        <span className="font-medium" title={`${tech.clockMinutes} minutes clocked in`}>{tech.clockMinutes} min</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> Job time</span>
                        <span className="font-medium" title={`${Math.round(tech.jobSeconds / 60)} minutes of active job time`}>{Math.round(tech.jobSeconds / 60)} min</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Jobs done</span>
                        {tech.completedJobs > 0 ? (
                          <button className="font-medium text-primary hover:underline text-sm" title={`${tech.completedJobs} job${tech.completedJobs !== 1 ? 's' : ''} completed — click to view in schedule`} onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}schedule?assignee=${tech.userId}`; }}>{tech.completedJobs}</button>
                        ) : <span className="font-medium" title="No jobs completed">{tech.completedJobs}</span>}
                      </div>
                      {tech.completedJobs > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Avg/job</span>
                          <span className="font-medium" title={`Average ${Math.round(tech.jobSeconds / 60 / tech.completedJobs)} minutes per job`}>{Math.round(tech.jobSeconds / 60 / tech.completedJobs)} min</span>
                        </div>
                      )}
                      {(tech as any).totalRevenue != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" /> Revenue</span>
                          <span className="font-medium" title={`Total revenue: $${(tech as any).totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}>${(tech as any).totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className={`flex items-center gap-1 ${tech.hasWarning ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          <AlertTriangle className="w-3.5 h-3.5" /> CB ratio
                        </span>
                        <span className={`font-medium ${tech.hasWarning ? 'text-destructive' : ''}`} title={`Callback ratio: ${tech.callbackRatio}%${tech.hasWarning ? ' — above threshold' : ''}`}>{tech.callbackRatio}%</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
                <div className="px-4 pb-3 pt-0">
                  <div className="flex items-center gap-3">
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}settings?tab=users&userId=${tech.userId}`; }}
                    >
                      View employee →
                    </button>
                    <button
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}callbacks?assignee=${tech.userId}`; }}
                    >
                      View callbacks →
                    </button>
                  </div>
                </div>
              </Card>
            ))}
      </div>

      {/* Trend sparkline */}
      {trend && trend.trend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              30-Day Efficiency Trend
              {selectedUserId && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  — {techList.find(t => t.userId === selectedUserId)?.name ?? 'Selected technician'}
                </span>
              )}
              {!selectedUserId && <span className="text-sm font-normal text-muted-foreground ml-1">— Company average (click a card to filter)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  />
                  <YAxis
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={v => `${v}%`}
                    domain={[0, 120]}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    formatter={(v: number) => [`${v}%`, 'Efficiency']}
                    labelFormatter={l => new Date(l as string).toLocaleDateString()}
                  />
                  {/* 80% target line */}
                  <Line type="monotone" dataKey={() => 80} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" strokeWidth={1} dot={false} name="Target (80%)" />
                  <Line type="monotone" dataKey="efficiencyRate" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Dashed line = 80% P4P target. Scores above 100% indicate overtime job time logged.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
