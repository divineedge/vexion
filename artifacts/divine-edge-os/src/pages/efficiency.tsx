import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import {
  RadialBarChart, RadialBar, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle, Activity, Users } from 'lucide-react';

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
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const { data: metrics, isLoading } = useQuery<EfficiencyResponse>({
    queryKey: ['efficiency', period],
    queryFn: () => customFetch<EfficiencyResponse>(`/api/efficiency?period=${period}`),
  });

  const { data: trend } = useQuery<{ trend: TrendPoint[] }>({
    queryKey: ['efficiency-trend', selectedUserId],
    queryFn: () =>
      customFetch<{ trend: TrendPoint[] }>(
        `/api/efficiency/trend?days=30${selectedUserId ? `&userId=${selectedUserId}` : ''}`,
      ),
  });

  // Technicians shown: technician only sees themselves
  const techList = isTechnician
    ? (metrics?.technicians ?? []).filter(t => t.userId === user?.id)
    : (metrics?.technicians ?? []);

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

      {/* Company KPIs */}
      {!isTechnician && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${(metrics?.companyCallbackRatio ?? 0) > 10 ? 'bg-destructive/10' : 'bg-emerald-50'}`}>
                <span className={`text-lg font-bold ${(metrics?.companyCallbackRatio ?? 0) > 10 ? 'text-destructive' : 'text-emerald-600'}`}>
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
                <p className={`text-2xl font-bold ${warningTechs.length > 0 ? 'text-destructive' : 'text-emerald-600'}`}>{warningTechs.length}</p>
                <p className="text-xs text-muted-foreground">{warningTechs.length > 0 ? 'Techs above 10% callback rate' : 'All techs within threshold'}</p>
              </div>
            </CardContent>
          </Card>
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
                      <CardTitle className="text-base">{tech.name}</CardTitle>
                      <CardDescription className="capitalize">{tech.role.replace(/_/g, ' ')}</CardDescription>
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
                        <span className="font-medium">{tech.clockMinutes} min</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> Job time</span>
                        <span className="font-medium">{Math.round(tech.jobSeconds / 60)} min</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Jobs done</span>
                        <span className="font-medium">{tech.completedJobs}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={`flex items-center gap-1 ${tech.hasWarning ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          <AlertTriangle className="w-3.5 h-3.5" /> CB ratio
                        </span>
                        <span className={`font-medium ${tech.hasWarning ? 'text-destructive' : ''}`}>{tech.callbackRatio}%</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
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
