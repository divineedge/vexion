import React, { useState } from 'react';
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
import { Users, Briefcase, FileText, DollarSign, Clock, CheckCircle, Gauge, PhoneCall, Trophy, AlertTriangle, Inbox, MessageSquare, Ban, CalendarSearch, ChevronDown, ChevronUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { MyTasksWidget } from '@/components/tasks/MyTasksWidget';
import { FollowupQueueWidget } from '@/components/followups/FollowupQueueWidget';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'wouter';
import { useListJobs, getListJobsQueryKey } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { format as fmtDate } from 'date-fns';
import { KpiDashboard } from '@/components/kpis/KpiDashboard';

interface EfficiencyResponse { companyEfficiencyRate: number | null; companyCallbackRatio: number; technicians: { hasWarning: boolean }[] }
interface RoasEntry { name: string; roas: number | null }

export default function DashboardPage() {
  const { user, isTechnician, canManageOffice, can } = useAuth();
  const showKpis = !isTechnician && canManageOffice && can('pages.billing') && can('financials.costData') && can('financials.jobPrices') && can('financials.invoiceAmounts');
  const [, setLocation] = useLocation();
  const todayStr = fmtDate(new Date(), 'yyyy-MM-dd');
  const { data: myTodayJobs } = useListJobs(
    { assigneeId: user?.id, startDate: todayStr, endDate: todayStr },
    { query: { enabled: isTechnician && !!user?.id, queryKey: getListJobsQueryKey({ assigneeId: user?.id, startDate: todayStr, endDate: todayStr }) } }
  );

  const { data: summary } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() }});
  const { data: jobsByStatus } = useGetJobsByStatus({ query: { queryKey: getGetJobsByStatusQueryKey() }});
  const { data: revenueTrend } = useGetRevenueTrend({ query: { queryKey: getGetRevenueTrendQueryKey() }});
  const { data: recentActivity } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() }});
  const [activityExpanded, setActivityExpanded] = useState(false);
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
  const { data: financialsSummary } = useQuery<{ totalOverdue?: number }>({
    queryKey: ['financials-summary'],
    queryFn: () => customFetch<{ totalOverdue?: number }>('/api/invoices/financials-summary'),
    enabled: !isTechnician,
  });

  const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#F43F5E', '#6B7280'];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Portal activity banner — shown at top when there's pending customer activity */}
      {!isTechnician && <PortalActivityWidget />}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your business operations today.</p>
        </div>
        {!isTechnician && (
          <div className="flex gap-2">
            <button
              className="inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 transition-colors"
              title="Create a new job"
              onClick={() => setLocation('/schedule?action=create')}
            >
              + New Job
            </button>
            <button
              className="inline-flex items-center gap-1.5 text-sm font-medium border border-border hover:bg-muted rounded-md px-3 py-1.5 transition-colors"
              title="Create a new estimate"
              onClick={() => setLocation('/estimates?action=create')}
            >
              + Estimate
            </button>
            <button
              className="inline-flex items-center gap-1.5 text-sm font-medium border border-border hover:bg-muted rounded-md px-3 py-1.5 transition-colors"
              title="Add a new customer"
              onClick={() => setLocation('/customers?action=create')}
            >
              + Customer
            </button>
          </div>
        )}
      </div>

      {showKpis ? <KpiDashboard /> : (<>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Customers" value={summary?.totalCustomers} icon={Users} />
        <MetricCard title="Active Jobs" value={summary?.activeJobs} icon={Briefcase} />
        <MetricCard title="Pending Invoices" value={`${summary?.pendingInvoicesTotal?.toLocaleString() || 0}`} subtitle={`${summary?.pendingInvoicesCount || 0} invoices`} icon={FileText} />
        <MetricCard title="Revenue (MTD)" value={`${summary?.revenueThisMonth?.toLocaleString() || 0}`} icon={DollarSign} />
        <MetricCard title="Completed Jobs (MTD)" value={summary?.completedJobsThisMonth} icon={CheckCircle} />
        <MetricCard title="Techs Clocked In" value={summary?.techniciansClockedIn} icon={Clock} />
        {!isTechnician && financialsSummary?.totalOverdue != null && financialsSummary.totalOverdue > 0 && (
          <MetricCard
            title="Overdue Invoices"
            value={`$${financialsSummary.totalOverdue.toLocaleString()}`}
            icon={AlertTriangle}
            accent="red"
          />
        )}
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
        <Link href="/callbacks" className="contents">
          <MetricCard
            title="Company Callback Ratio"
            value={efficiency?.companyCallbackRatio != null ? `${efficiency.companyCallbackRatio}%` : '—'}
            subtitle={qualityWarnings > 0 ? `⚠ ${qualityWarnings} tech${qualityWarnings > 1 ? 's' : ''} above threshold` : '✓ All within threshold'}
            icon={PhoneCall}
            accent={qualityWarnings > 0 ? 'red' : 'green'}
          />
        </Link>
        <MetricCard
          title="Top Campaign ROAS"
          value={topRoas?.roas != null ? `${topRoas.roas.toFixed(1)}x` : '—'}
          subtitle={topRoas?.name ?? 'No campaigns yet'}
          icon={Trophy}
          accent={topRoas?.roas != null ? (topRoas.roas >= 4 ? 'green' : topRoas.roas >= 2 ? 'amber' : 'red') : undefined}
        />
      </div>

      </>)}

      {!showKpis && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

      }
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          {isTechnician && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" /> My Jobs Today
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!myTodayJobs || myTodayJobs.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-muted-foreground">No jobs scheduled today.</p>
                ) : (
                  <div className="divide-y">
                    {myTodayJobs.map(j => (
                      <div
                        key={j.id}
                        className="px-4 py-2.5 flex items-start justify-between gap-2 cursor-pointer hover:bg-muted/40 transition-colors"
                        onClick={() => setLocation(`/schedule?jobId=${j.id}`)}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{j.title}</p>
                          <p className="text-xs text-muted-foreground">{j.customerName ?? ''}{j.scheduledAt ? ` · ${new Date(j.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
                        </div>
                        <Badge className="capitalize shrink-0 text-xs">{(j.status ?? 'scheduled').replace(/_/g, ' ')}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <MyTasksWidget />
          <FollowupQueueWidget />
        </div>
        <Card className="lg:col-span-2">
          <CardHeader className="cursor-pointer select-none" onClick={() => setActivityExpanded(e => !e)}>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Activity</CardTitle>
              <div className="flex items-center gap-2">
                {!activityExpanded && recentActivity && recentActivity.length > 1 && (
                  <span className="text-xs text-muted-foreground">{recentActivity.length - 1} more</span>
                )}
                {activityExpanded
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {(activityExpanded ? recentActivity : recentActivity?.slice(0, 1))?.map((activity, idx, arr) => {
                const href = activity.entityId != null ? (() => {
                  if (activity.type === 'job_created' || activity.type === 'job_completed') return `schedule?jobId=${activity.entityId}`;
                  if (activity.type === 'invoice_sent' || activity.type === 'payment_received') return `financials?invoiceId=${activity.entityId}`;
                  if (activity.type === 'customer_added') return `customers/${activity.entityId}`;
                  return null;
                })() : null;
                const isLast = idx === arr.length - 1;
                return (
                  <div key={activity.id} className="flex gap-4">
                    <div className="relative flex flex-col items-center">
                      <div className="w-2 h-2 bg-primary rounded-full z-10 mt-1 shrink-0" />
                      {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
                    </div>
                    <div className={`flex-1 ${!isLast ? 'pb-6' : ''}`}>
                      <p
                        className={`text-sm font-medium ${href ? 'cursor-pointer hover:underline text-primary' : ''}`}
                        title={activity.message}
                        onClick={href ? (e) => { e.stopPropagation(); setLocation(href); } : undefined}
                      >{activity.message}</p>
                      <p className="text-xs text-muted-foreground mt-1" title={new Date(activity.createdAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}>
                        {new Date(activity.createdAt).toLocaleString()} {activity.userName && `• by ${activity.userName}`}
                      </p>
                    </div>
                  </div>
                );
              })}
              {(!recentActivity || recentActivity.length === 0) && (
                <div className="text-center py-6 text-muted-foreground">No recent activity</div>
              )}
              {activityExpanded && recentActivity && recentActivity.length >= 15 && (
                <p className="text-xs text-center text-muted-foreground pt-1">Showing last 15 events</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PortalActivityWidget() {
  const [, setLocation] = useLocation();
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['portal-inbox-unread'],
    queryFn: () => customFetch<{ count: number }>('/api/portal-inbox/unread-count'),
    refetchInterval: 60_000,
  });
  const { data: portalJobs } = useQuery<{ id: number; title: string; customerName: string | null; createdAt: string }[]>({
    queryKey: ['portal-requests-pending'],
    queryFn: () => customFetch<any[]>('/api/jobs?source=portal&status=pending&limit=5'),
    refetchInterval: 60_000,
  });
  const { data: pendingRequests } = useQuery<{ id: number; title: string; customerName: string | null; requestType: 'cancel' | 'reschedule'; requestedAt: string }[]>({
    queryKey: ['portal-cancel-reschedule-pending'],
    queryFn: () => customFetch<any[]>('/api/jobs/pending-requests'),
    refetchInterval: 60_000,
  });

  const unread = unreadData?.count ?? 0;
  const requests = portalJobs ?? [];
  const pendingCancelReschedule = pendingRequests ?? [];

  // Hide while loading and when there's genuinely no activity
  if (unreadData === undefined && portalJobs === undefined && pendingRequests === undefined) return null;
  if (unread === 0 && requests.length === 0 && pendingCancelReschedule.length === 0) return null;

  const totalActivity = unread + requests.length + pendingCancelReschedule.length;

  return (
    <Card className="border-l-4 border-l-primary shadow-sm">
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2 font-semibold text-primary">
            <Inbox className="w-4 h-4" /> Portal Activity
            {totalActivity > 0 && (
              <Badge className="bg-primary text-primary-foreground text-xs h-5 px-1.5">{totalActivity}</Badge>
            )}
          </span>
          <button
            className="text-xs text-primary hover:underline font-normal"
            onClick={() => setLocation('/portal-inbox')}
          >
            View all →
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {unread > 0 && (
          <button
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-primary/5 transition-colors text-left"
            onClick={() => setLocation('/portal-inbox')}
          >
            <MessageSquare className="w-4 h-4 text-primary shrink-0" />
            <span className="font-semibold text-primary">{unread} unread message{unread !== 1 ? 's' : ''} from customers</span>
          </button>
        )}
        {pendingCancelReschedule.length > 0 && (
          <div className="divide-y">
            {pendingCancelReschedule.slice(0, 4).map((r: any) => (
              <button
                key={`req-${r.id}-${r.requestType}`}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left"
                onClick={() => setLocation(`/schedule?jobId=${r.id}`)}
              >
                {r.requestType === 'cancel'
                  ? <Ban className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  : <CalendarSearch className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                }
                <span className="flex-1 truncate">
                  {r.customerName ?? 'Customer'} — {r.requestType === 'cancel' ? 'cancel request' : 'reschedule request'} for "{r.title}"
                </span>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${r.requestType === 'cancel' ? 'border-red-200 text-red-700' : 'border-amber-200 text-amber-700'}`}>
                  {r.requestType === 'cancel' ? 'cancel' : 'reschedule'}
                </Badge>
              </button>
            ))}
          </div>
        )}
        {requests.length > 0 && (
          <div className="divide-y">
            {requests.slice(0, 3).map((j: any) => (
              <button
                key={j.id}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left"
                onClick={() => setLocation(`/schedule?jobId=${j.id}`)}
              >
                <Briefcase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{j.customerName ?? 'Customer'} — service request</span>
                <Badge variant="outline" className="text-[10px] shrink-0">new</Badge>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
            <p className={`text-3xl font-bold tracking-tight ${accentStyle?.value ?? ''}`} title={value !== undefined ? `${title}: ${value}` : undefined}>{value !== undefined ? value : '-'}</p>
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
