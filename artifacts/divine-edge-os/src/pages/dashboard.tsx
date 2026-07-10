import React from 'react';
import { 
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useGetJobsByStatus, getGetJobsByStatusQueryKey,
  useGetRevenueTrend, getGetRevenueTrendQueryKey,
  useGetRecentActivity, getGetRecentActivityQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Briefcase, FileText, DollarSign, Clock, CheckCircle, Gauge, PhoneCall, Trophy, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface EfficiencyResponse { companyEfficiencyRate: number | null; companyCallbackRatio: number; technicians: { hasWarning: boolean }[] }
interface RoasEntry { name: string; roas: number | null }

export default function DashboardPage() {
  const { data: summary } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() }});
  const { data: jobsByStatus } = useGetJobsByStatus({ query: { queryKey: getGetJobsByStatusQueryKey() }});
  const { data: revenueTrend } = useGetRevenueTrend({ query: { queryKey: getGetRevenueTrendQueryKey() }});
  const { data: recentActivity } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() }});
  const { data: efficiency } = useQuery<EfficiencyResponse>({
    queryKey: ['efficiency', 'today'],
    queryFn: () => customFetch<EfficiencyResponse>('/api/efficiency?period=today'),
  });
  const { data: roasLeaderboard } = useQuery<RoasEntry[]>({
    queryKey: ['marketing-roas'],
    queryFn: () => customFetch<RoasEntry[]>('/api/marketing/roas'),
  });

  const topRoas = roasLeaderboard?.[0];
  const qualityWarnings = efficiency?.technicians.filter(t => t.hasWarning).length ?? 0;

  const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#F43F5E', '#6B7280'];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your business operations today.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Customers" value={summary?.totalCustomers} icon={Users} />
        <MetricCard title="Active Jobs" value={summary?.activeJobs} icon={Briefcase} />
        <MetricCard title="Pending Invoices" value={`${summary?.pendingInvoicesTotal?.toLocaleString() || 0}`} subtitle={`${summary?.pendingInvoicesCount || 0} invoices`} icon={FileText} />
        <MetricCard title="Revenue (MTD)" value={`${summary?.revenueThisMonth?.toLocaleString() || 0}`} icon={DollarSign} />
        <MetricCard title="Completed Jobs (MTD)" value={summary?.completedJobsThisMonth} icon={CheckCircle} />
        <MetricCard title="Techs Clocked In" value={summary?.techniciansClockedIn} icon={Clock} />
      </div>

      {/* P4P & Quality row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Crew Efficiency (Today)"
          value={efficiency?.companyEfficiencyRate != null ? `${efficiency.companyEfficiencyRate}%` : '—'}
          subtitle="Active job time ÷ total clock time"
          icon={Gauge}
          accent={efficiency?.companyEfficiencyRate != null ? (efficiency.companyEfficiencyRate >= 80 ? 'green' : efficiency.companyEfficiencyRate >= 60 ? 'amber' : 'red') : undefined}
        />
        <MetricCard
          title="Company Callback Ratio"
          value={efficiency?.companyCallbackRatio != null ? `${efficiency.companyCallbackRatio}%` : '—'}
          subtitle={qualityWarnings > 0 ? `⚠ ${qualityWarnings} tech${qualityWarnings > 1 ? 's' : ''} above threshold` : '✓ All within threshold'}
          icon={PhoneCall}
          accent={qualityWarnings > 0 ? 'red' : 'green'}
        />
        <MetricCard
          title="Top Campaign ROAS"
          value={topRoas?.roas != null ? `${topRoas.roas.toFixed(1)}x` : '—'}
          subtitle={topRoas?.name ?? 'No campaigns yet'}
          icon={Trophy}
          accent={topRoas?.roas != null ? (topRoas.roas >= 4 ? 'green' : topRoas.roas >= 2 ? 'amber' : 'red') : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue Trend (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {revenueTrend && revenueTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                      formatter={(val: number) => [`$${val.toLocaleString()}`, 'Revenue']}
                      labelFormatter={(label) => new Date(label as string).toLocaleDateString()}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">No revenue data available</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jobs by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {jobsByStatus && jobsByStatus.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={jobsByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="status"
                    >
                      {jobsByStatus.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                      itemStyle={{ color: 'hsl(var(--foreground))', textTransform: 'capitalize' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">No job data available</div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {jobsByStatus?.map((stat, i) => (
                <div key={stat.status} className="flex items-center gap-2 text-sm">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="capitalize">{stat.status.replace('_', ' ')}</span>
                  <span className="ml-auto font-medium">{stat.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {recentActivity?.map((activity) => (
              <div key={activity.id} className="flex gap-4">
                <div className="relative flex flex-col items-center">
                  <div className="w-2 h-2 bg-primary rounded-full z-10" />
                  <div className="w-px h-full bg-border absolute top-2" />
                </div>
                <div className="flex-1 pb-6">
                  <p className="text-sm font-medium">{activity.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(activity.createdAt).toLocaleString()} {activity.userName && `• by ${activity.userName}`}
                  </p>
                </div>
              </div>
            ))}
            {(!recentActivity || recentActivity.length === 0) && (
              <div className="text-center py-6 text-muted-foreground">No recent activity</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const ACCENT_STYLES = {
  green: { icon: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-700' },
  amber: { icon: 'bg-amber-50 text-amber-600', value: 'text-amber-700' },
  red:   { icon: 'bg-red-50 text-red-600',     value: 'text-red-700' },
};

function MetricCard({ title, value, subtitle, icon: Icon, accent }: { title: string; value?: string | number; subtitle?: string; icon: any; accent?: 'green' | 'amber' | 'red' }) {
  const accentStyle = accent ? ACCENT_STYLES[accent] : null;
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className={`text-3xl font-bold tracking-tight ${accentStyle?.value ?? ''}`}>{value !== undefined ? value : '-'}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${accentStyle?.icon ?? 'bg-primary/10 text-primary'}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
