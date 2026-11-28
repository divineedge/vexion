import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomizeDashboardDrawer, widgetTitle } from '@/components/dashboard/CustomizeDashboardDrawer';
import {
  money, timeframeLabel,
  type ActionTask, type DashboardLayout, type OperationsPayload,
} from '@/components/dashboard/operations';
import { useAuth } from '@/contexts/AuthContext';
import { AlertTriangle, Briefcase, Check, CloudRain, DollarSign, LayoutGrid, ListEnd, Package, ScrollText, SlidersHorizontal, Wrench } from 'lucide-react';

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
    onError: (error: unknown) => {
      const data = error && typeof error === 'object' && 'data' in error ? (error as { data?: { error?: string } }).data : undefined;
      toast.error(data?.error || 'That task was not completed');
    },
  });

  const layout = operations.data?.layout as DashboardLayout | undefined;
  const widgets = operations.data?.widgets as OperationsPayload['widgets'] | undefined;
  const tasks = (operations.data?.tasks ?? []) as ActionTask[];
  const visible = [...(layout?.widgets.filter(widget => widget.visible) ?? [])].sort((left, right) => {
    if (left.key === 'needs_action') return -1;
    if (right.key === 'needs_action') return 1;
    return 0;
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500" data-testid="dashboard-operations">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="dashboard-title">Dashboard</h1>
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

      {operations.isLoading && <p className="text-sm text-muted-foreground">Loading widgets…</p>}
      {operations.isError && <p className="text-sm text-destructive">The dashboard could not be loaded.</p>}
      {operations.data && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">Every widget is hidden. Customize the dashboard to show the default set again.</p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visible.map(widget => {
          if (widget.key === 'needs_action' && tasks.length === 0) return null;
          return (
          <div key={widget.key} className={widget.key === 'needs_action' ? 'lg:col-span-2' : undefined} data-testid={`widget-${widget.key}`}>
            {widget.key === 'needs_action' && (
              <NeedsAction
                tasks={tasks}
                pending={completeTask.isPending}
                onOpen={setLocation}
                onComplete={task => completeTask.mutate(task)}
              />
            )}
            {widget.key === 'jobs_completed' && widgets?.jobsCompleted && <JobsWidget data={widgets.jobsCompleted} />}
            {widget.key === 'invoices_revenue' && widgets?.invoicesRevenue && <InvoicesWidget data={widgets.invoicesRevenue} />}
            {widget.key === 'invoice_attention' && widgets?.invoiceAttention && <InvoiceAttentionWidget data={widgets.invoiceAttention} onOpen={setLocation} />}
            {widget.key === 'profit_and_loss' && widgets?.profitAndLoss && <ProfitWidget data={widgets.profitAndLoss} onOpen={setLocation} />}
            {widget.key === 'payroll_summary' && widgets?.payrollSummary && <PayrollWidget data={widgets.payrollSummary} />}
            {widget.key === 'schedule' && widgets?.schedule && <ScheduleWidget data={widgets.schedule} onOpen={setLocation} />}
            {widget.key === 'job_waitlist' && widgets?.jobWaitlist && <WaitlistWidget data={widgets.jobWaitlist} onOpen={setLocation} />}
            {widget.key === 'inventory_reorder' && widgets?.inventoryReorder && <InventoryWidget data={widgets.inventoryReorder} onOpen={setLocation} />}
            {widget.key === 'report_snapshots' && widgets?.reportSnapshots && <ReportsWidget data={widgets.reportSnapshots} onOpen={setLocation} />}
            {widget.key === 'alerts' && widgets?.alerts && <AlertsWidget data={widgets.alerts} onOpen={setLocation} />}
          </div>
          );
        })}
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

function NeedsAction({
  tasks, pending, onOpen, onComplete,
}: {
  tasks: ActionTask[];
  pending: boolean;
  onOpen: (href: string) => void;
  onComplete: (task: ActionTask) => void;
}) {
  return (
    <Card data-testid="action-tasks" className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Needs Action</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2" data-testid="needs-action-tasks">
        {tasks.map(task => (
          <div key={`${task.source}-${task.sourceId}`} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5" data-testid={`task-${task.source}-${task.sourceId}`}>
            <button className="min-w-0 text-left" onClick={() => onOpen(task.href)}>
              <p className="text-sm font-medium">{task.title}</p>
              <p className="text-xs text-muted-foreground truncate">{task.detail}</p>
            </button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              data-testid={`button-complete-${task.source}-${task.sourceId}`}
              onClick={() => onComplete(task)}
            >
              <Check className="mr-1 h-3.5 w-3.5" /> Done
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
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

function InvoiceAttentionWidget({ data, onOpen }: { data: NonNullable<OperationsPayload['widgets']['invoiceAttention']>; onOpen: (href: string) => void }) {
  return (
    <WidgetFrame title={widgetTitle('invoice_attention')} icon={<DollarSign className="h-4 w-4" />} timeframe={data.timeframe}>
      {data.empty ? <EmptyNote>No new invoices to send, and none are due soon or overdue.</EmptyNote> : (
        <div className="space-y-3">
          {data.toSend.length > 0 && <InvoiceLines label="Need to send" invoices={data.toSend} restricted={data.restricted} onOpen={onOpen} />}
          {data.due.length > 0 && <InvoiceLines label="Due soon or overdue" invoices={data.due} restricted={data.restricted} onOpen={onOpen} />}
        </div>
      )}
    </WidgetFrame>
  );
}

function InvoiceLines({ label, invoices, restricted, onOpen }: { label: string; invoices: NonNullable<OperationsPayload['widgets']['invoiceAttention']>['toSend']; restricted: boolean; onOpen: (href: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {invoices.map(invoice => (
        <button key={invoice.id} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1.5 text-left hover:bg-muted/50" onClick={() => onOpen(invoice.href)} data-testid={`invoice-row-${invoice.id}`}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{invoice.invoiceNumber}</span>
            <span className="block text-xs text-muted-foreground">{invoice.customerName ?? 'No customer'}{invoice.overdue ? ' · Overdue' : ''}</span>
          </span>
          <span className="shrink-0 text-sm font-medium">{restricted ? 'Hidden' : money(invoice.total)}</span>
        </button>
      ))}
    </div>
  );
}

function ProfitWidget({ data, onOpen }: { data: NonNullable<OperationsPayload['widgets']['profitAndLoss']>; onOpen: (href: string) => void }) {
  return (
    <WidgetFrame title={widgetTitle('profit_and_loss')} icon={<ScrollText className="h-4 w-4" />} timeframe={data.timeframe}>
      {data.restricted ? <EmptyNote>Profit and loss is hidden for this role.</EmptyNote> : data.empty ? <EmptyNote>No paid invoices or expenses in this timeframe.</EmptyNote> : (
        <button className="w-full space-y-2 text-left" onClick={() => onOpen(data.href)}>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Revenue" value={money(data.revenue)} />
            <Metric label="Cost of goods" value={money(data.costOfGoodsSold)} />
            <Metric label="Gross profit" value={money(data.grossProfit)} />
            <Metric label="Expenses" value={money(data.operatingExpenses)} />
          </div>
          <p className="text-sm font-medium">Net income {money(data.netIncome)}</p>
        </button>
      )}
    </WidgetFrame>
  );
}

function WaitlistWidget({ data, onOpen }: { data: NonNullable<OperationsPayload['widgets']['jobWaitlist']>; onOpen: (href: string) => void }) {
  return (
    <WidgetFrame title={widgetTitle('job_waitlist')} icon={<ListEnd className="h-4 w-4" />}>
      {data.empty ? <EmptyNote>No jobs are waiting to be scheduled.</EmptyNote> : (
        <div className="space-y-1">
          {data.jobs.map(job => (
            <button key={job.id} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1.5 text-left hover:bg-muted/50" onClick={() => onOpen(job.href)} data-testid={`waitlist-job-${job.id}`}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{job.title}</span>
                <span className="block text-xs text-muted-foreground">{job.customerName ?? 'No customer'}</span>
              </span>
              <Badge variant="outline" className="shrink-0">Waitlist</Badge>
            </button>
          ))}
          {data.count > data.jobs.length && <p className="text-xs text-muted-foreground">{data.count - data.jobs.length} more on the waitlist</p>}
        </div>
      )}
    </WidgetFrame>
  );
}

function InventoryWidget({ data, onOpen }: { data: NonNullable<OperationsPayload['widgets']['inventoryReorder']>; onOpen: (href: string) => void }) {
  return (
    <WidgetFrame title={widgetTitle('inventory_reorder')} icon={<Package className="h-4 w-4" />}>
      {data.empty ? <EmptyNote>No items are at or below their reorder point.</EmptyNote> : (
        <div className="space-y-1">
          {data.items.map(item => (
            <button key={item.id} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1.5 text-left text-sm hover:bg-muted/50" onClick={() => onOpen(item.href)} data-testid={`reorder-item-${item.id}`}>
              <span className="min-w-0 truncate">{item.name}</span>
              <span className="shrink-0 text-muted-foreground">{item.quantity} / {item.reorderPoint} {item.unit}</span>
            </button>
          ))}
          {data.count > data.items.length && <p className="text-xs text-muted-foreground">{data.count - data.items.length} more need reorder</p>}
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
