import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { CustomizeDashboardDrawer, widgetTitle } from '@/components/dashboard/CustomizeDashboardDrawer';
import {
  money, TASK_SOURCE_OPTIONS, timeframeLabel,
  type ActionTask, type DashboardLayout, type OperationsPayload,
} from '@/components/dashboard/operations';
import { useAuth } from '@/contexts/AuthContext';
import { AlertTriangle, Briefcase, Check, CloudRain, DollarSign, LayoutGrid, SlidersHorizontal, Wrench } from 'lucide-react';

const queryKey = ['operations-dashboard'];

export default function DashboardPage() {
  const { isTechnician } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const operations = useQuery({
    queryKey,
    queryFn: () => customFetch<OperationsPayload>('/api/dashboard/operations'),
  });
  const saveLayout = useMutation({
    mutationFn: (layout: DashboardLayout) => customFetch<DashboardLayout>('/api/dashboard/layout', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(layout),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: () => toast.error('The dashboard layout was not saved'),
  });
  const resetLayout = useMutation({
    mutationFn: () => customFetch<DashboardLayout>('/api/dashboard/layout/reset', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Dashboard reset to the default widgets');
    },
    onError: () => toast.error('The dashboard was not reset'),
  });
  const completeTask = useMutation({
    mutationFn: (task: ActionTask) => customFetch<{ ok: boolean }>('/api/dashboard/action-tasks/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: task.source, sourceId: task.sourceId, date: task.date }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Task completed');
    },
    onError: () => toast.error('That task was not completed'),
  });

  const layout = operations.data?.layout as DashboardLayout | undefined;
  const widgets = operations.data?.widgets as OperationsPayload['widgets'] | undefined;
  const tasks = (operations.data?.tasks ?? []) as ActionTask[];
  const visible = layout?.widgets.filter(widget => widget.visible) ?? [];

  const toggleSource = (source: string, checked: boolean) => {
    if (!layout) return;
    const taskSources = checked
      ? [...layout.taskSources, source]
      : layout.taskSources.filter(item => item !== source);
    saveLayout.mutate({ ...layout, taskSources });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500" data-testid="dashboard-operations">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Operations</h1>
          <p className="text-muted-foreground mt-1">Action center for today's work, money, and alerts.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setDrawerOpen(true)} data-testid="button-customize-dashboard">
            <SlidersHorizontal className="mr-2 h-4 w-4" /> Customize
          </Button>
          {!isTechnician && (
            <>
              <Button onClick={() => setLocation('/schedule?action=create')}>+ New Job</Button>
              <Button variant="outline" onClick={() => setLocation('/estimates?action=create')}>+ Estimate</Button>
              <Button variant="outline" onClick={() => setLocation('/customers?action=create')}>+ Customer</Button>
            </>
          )}
        </div>
      </div>

      <Card data-testid="action-tasks">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Needs action</CardTitle>
          <div className="flex flex-wrap gap-3 pt-2">
            {TASK_SOURCE_OPTIONS.map(option => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={layout?.taskSources.includes(option.value) ?? true}
                  onCheckedChange={checked => toggleSource(option.value, checked === true)}
                  aria-label={option.label}
                />
                {option.label}
              </label>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {operations.isLoading && <p className="text-sm text-muted-foreground">Loading tasks…</p>}
          {operations.isError && <p className="text-sm text-destructive">Tasks could not be loaded.</p>}
          {operations.data && tasks.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground" data-testid="action-tasks-empty">
              {layout?.taskSources.length ? 'Nothing needs action from the sources you selected.' : 'Choose at least one source to see tasks.'}
            </p>
          )}
          {tasks.map(task => (
            <div key={`${task.source}-${task.sourceId}`} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5" data-testid={`task-${task.source}-${task.sourceId}`}>
              <button className="min-w-0 text-left" onClick={() => setLocation(task.href)}>
                <p className="text-sm font-medium">{task.title}</p>
                <p className="text-xs text-muted-foreground truncate">{task.detail}</p>
              </button>
              <Button
                size="sm"
                variant="outline"
                disabled={completeTask.isPending}
                data-testid={`button-complete-${task.source}-${task.sourceId}`}
                onClick={() => completeTask.mutate(task)}
              >
                <Check className="mr-1 h-3.5 w-3.5" /> Done
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {operations.isLoading && <p className="text-sm text-muted-foreground">Loading widgets…</p>}
      {operations.isError && <p className="text-sm text-destructive">The operations dashboard could not be loaded.</p>}
      {operations.data && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">Every widget is hidden. Customize the dashboard to show the default set again.</p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visible.map(widget => (
          <div key={widget.key} data-testid={`widget-${widget.key}`}>
            {widget.key === 'jobs_completed' && widgets?.jobsCompleted && <JobsWidget data={widgets.jobsCompleted} />}
            {widget.key === 'invoices_revenue' && widgets?.invoicesRevenue && <InvoicesWidget data={widgets.invoicesRevenue} />}
            {widget.key === 'payroll_summary' && widgets?.payrollSummary && <PayrollWidget data={widgets.payrollSummary} />}
            {widget.key === 'schedule' && widgets?.schedule && <ScheduleWidget data={widgets.schedule} onOpen={setLocation} />}
            {widget.key === 'report_snapshots' && widgets?.reportSnapshots && <ReportsWidget data={widgets.reportSnapshots} onOpen={setLocation} />}
            {widget.key === 'alerts' && widgets?.alerts && <AlertsWidget data={widgets.alerts} onOpen={setLocation} />}
          </div>
        ))}
      </div>

      <CustomizeDashboardDrawer
        open={drawerOpen}
        layout={layout}
        saving={saveLayout.isPending || resetLayout.isPending}
        onOpenChange={setDrawerOpen}
        onChange={next => saveLayout.mutate(next)}
        onReset={() => resetLayout.mutate()}
      />
    </div>
  );
}

function WidgetFrame({ title, icon, timeframe, children }: { title: string; icon: ReactNode; timeframe?: string; children: ReactNode }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">{icon}{title}</span>
          {timeframe && <Badge variant="outline">{timeframeLabel(timeframe)}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground" data-testid="widget-empty">{children}</p>;
}

function JobsWidget({ data }: { data: NonNullable<OperationsPayload['widgets']['jobsCompleted']> }) {
  return (
    <WidgetFrame title={widgetTitle('jobs_completed')} icon={<Briefcase className="h-4 w-4" />} timeframe={data.timeframe}>
      {data.empty ? <EmptyNote>No completed jobs in this timeframe.</EmptyNote> : (
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Completed" value={String(data.count)} />
          <Metric label="Value" value={data.restricted ? 'Hidden for this role' : money(data.value)} />
        </div>
      )}
    </WidgetFrame>
  );
}

function InvoicesWidget({ data }: { data: NonNullable<OperationsPayload['widgets']['invoicesRevenue']> }) {
  return (
    <WidgetFrame title={widgetTitle('invoices_revenue')} icon={<DollarSign className="h-4 w-4" />} timeframe={data.timeframe}>
      {data.empty ? <EmptyNote>No open, overdue, or collected invoices in this view.</EmptyNote> : (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Open" value={data.restricted ? String(data.openCount) : `${data.openCount} · ${money(data.openTotal)}`} />
          <Metric label="Overdue" value={data.restricted ? String(data.overdueCount) : `${data.overdueCount} · ${money(data.overdueTotal)}`} />
          <Metric label="Collected" value={data.restricted ? String(data.collectedCount) : `${data.collectedCount} · ${money(data.collectedTotal)}`} />
        </div>
      )}
    </WidgetFrame>
  );
}

function PayrollWidget({ data }: { data: NonNullable<OperationsPayload['widgets']['payrollSummary']> }) {
  const hours = Math.floor(data.minutes / 60);
  const minutes = data.minutes % 60;
  return (
    <WidgetFrame title={widgetTitle('payroll_summary')} icon={<DollarSign className="h-4 w-4" />} timeframe={data.timeframe}>
      {data.empty ? <EmptyNote>No time entries or payroll periods in this timeframe.</EmptyNote> : (
        <div className="space-y-2 text-sm">
          <p>{data.people} {data.people === 1 ? 'person' : 'people'} · {hours}h {minutes}m · {data.openClocks} still clocked in</p>
          <p>{data.periodCount} approved payroll {data.periodCount === 1 ? 'period' : 'periods'}</p>
          <p className="font-medium">{data.restricted ? 'Pay is hidden for this role' : data.estimatedPay == null ? 'No hourly rates are set, so pay is not estimated.' : `Estimated pay ${money(data.estimatedPay)}`}</p>
        </div>
      )}
    </WidgetFrame>
  );
}

function ScheduleWidget({ data, onOpen }: { data: NonNullable<OperationsPayload['widgets']['schedule']>; onOpen: (href: string) => void }) {
  return (
    <WidgetFrame title={widgetTitle('schedule')} icon={<LayoutGrid className="h-4 w-4" />} timeframe={data.timeframe}>
      {data.empty ? <EmptyNote>Nothing is scheduled in this window.</EmptyNote> : (
        <div className="space-y-3">
          <JobList label="Today" jobs={data.today} onOpen={onOpen} />
          <JobList label="Upcoming" jobs={data.upcoming} onOpen={onOpen} />
        </div>
      )}
    </WidgetFrame>
  );
}

function JobList({ label, jobs, onOpen }: { label: string; jobs: { id: number; title: string; customerName: string | null; scheduledAt: string; href: string; status: string }[]; onOpen: (href: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {jobs.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : jobs.map(job => (
        <button key={job.id} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1.5 text-left hover:bg-muted/50" onClick={() => onOpen(job.href)}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{job.title}</span>
            <span className="block text-xs text-muted-foreground">{job.customerName ?? 'No customer'} · {format(new Date(job.scheduledAt), 'MMM d, h:mm a')}</span>
          </span>
          <Badge variant="outline" className="shrink-0 capitalize">{job.status.replace(/_/g, ' ')}</Badge>
        </button>
      ))}
    </div>
  );
}

function ReportsWidget({ data, onOpen }: { data: NonNullable<OperationsPayload['widgets']['reportSnapshots']>; onOpen: (href: string) => void }) {
  return (
    <WidgetFrame title={widgetTitle('report_snapshots')} icon={<LayoutGrid className="h-4 w-4" />} timeframe={data.timeframe}>
      {data.empty ? <EmptyNote>No report activity in this timeframe.</EmptyNote> : (
        <div className="space-y-1">
          {data.snapshots.map(item => (
            <button key={item.key} className="flex w-full items-center justify-between gap-3 rounded px-1 py-1.5 text-left text-sm hover:bg-muted/50" onClick={() => onOpen(item.href)}>
              <span>{item.label}</span>
              <span className="font-medium">{item.count}{item.value != null ? ` · ${money(item.value)}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </WidgetFrame>
  );
}

function AlertsWidget({ data, onOpen }: { data: NonNullable<OperationsPayload['widgets']['alerts']>; onOpen: (href: string) => void }) {
  return (
    <WidgetFrame title={widgetTitle('alerts')} icon={<AlertTriangle className="h-4 w-4" />} timeframe={data.timeframe}>
      {data.empty ? <EmptyNote>No system, weather, or equipment alerts right now.</EmptyNote> : (
        <div className="space-y-2 text-sm">
          {data.system.map(alert => <p key={alert.id}><Badge variant="outline" className="mr-2">{alert.severity}</Badge>{alert.message}</p>)}
          {data.weather.map(alert => (
            <button key={alert.id} className="flex w-full items-center gap-2 text-left hover:underline" onClick={() => onOpen(alert.href)}>
              <CloudRain className="h-4 w-4" /> {alert.title}: {alert.detail}
            </button>
          ))}
          {data.equipment.map(alert => (
            <button key={alert.id} className="flex w-full items-center gap-2 text-left hover:underline" onClick={() => onOpen(alert.href)}>
              <Wrench className="h-4 w-4" /> {alert.name}: {alert.detail}
            </button>
          ))}
        </div>
      )}
    </WidgetFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-tight">{value}</p>
    </div>
  );
}
