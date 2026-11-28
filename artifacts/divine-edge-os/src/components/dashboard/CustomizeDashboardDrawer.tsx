import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import type { DashboardLayout, WidgetConfig } from './operations';

const TIMEFRAMES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'year', label: 'This year' },
] as const;

const FILTERS: Record<string, { value: string; label: string }[]> = {
  needs_action: [{ value: 'all', label: 'Selected sources' }],
  jobs_completed: [{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Assigned to me' }],
  invoice_attention: [
    { value: 'all', label: 'Need to send and due' },
    { value: 'to_send', label: 'Need to send' },
    { value: 'due', label: 'Due or overdue' },
  ],
  profit_and_loss: [{ value: 'all', label: 'Company' }],
  job_waitlist: [{ value: 'all', label: 'Every waiting job' }, { value: 'mine', label: 'Assigned to me' }],
  inventory_reorder: [{ value: 'all', label: 'At or below reorder' }],
  invoices_revenue: [{ value: 'outstanding', label: 'Current balances' }, { value: 'activity', label: 'Activity in the timeframe' }],
  payroll_summary: [{ value: 'all', label: 'Whole team' }, { value: 'mine', label: 'My time' }],
  schedule: [{ value: 'all', label: 'Whole schedule' }, { value: 'mine', label: 'Assigned to me' }],
  report_snapshots: [{ value: 'all', label: 'All snapshots' }],
  alerts: [
    { value: 'all', label: 'All alerts' },
    { value: 'system', label: 'System only' },
    { value: 'weather', label: 'Weather only' },
    { value: 'equipment', label: 'Equipment only' },
  ],
};

export function CustomizeDashboardDrawer({
  open,
  layout,
  saving,
  onOpenChange,
  onChange,
  onReset,
}: {
  open: boolean;
  layout: DashboardLayout | undefined;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (layout: DashboardLayout) => void;
  onReset: () => void;
}) {
  const widgets = layout?.widgets ?? [];
  const update = (next: WidgetConfig[]) => {
    if (!layout) return;
    onChange({ ...layout, widgets: next });
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= widgets.length) return;
    if (widgets[index].key === 'needs_action' || widgets[target].key === 'needs_action') return;
    const next = [...widgets];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    update(next);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="pr-8">
          <SheetTitle>Customize Dashboard</SheetTitle>
          <SheetDescription>This layout is saved for you. Other people in the company keep their own.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-3">
          {widgets.map((widget, index) => (
            <div key={widget.key} className="rounded-lg border p-3 space-y-3" data-testid={`customize-${widget.key}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{widgetTitle(widget.key)}</p>
                  <p className="text-xs text-muted-foreground">{widget.visible ? 'Shown' : 'Hidden'}</p>
                </div>
                <Switch
                  checked={widget.visible}
                  onCheckedChange={visible => update(widgets.map(item => item.key === widget.key ? { ...item, visible } : item))}
                  aria-label={`Show ${widgetTitle(widget.key)}`}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={widget.timeframe} onValueChange={timeframe => update(widgets.map(item => item.key === widget.key ? { ...item, timeframe: timeframe as WidgetConfig['timeframe'] } : item))}>
                  <SelectTrigger aria-label={`${widgetTitle(widget.key)} timeframe`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEFRAMES.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={widget.filter ?? FILTERS[widget.key][0].value} onValueChange={filter => update(widgets.map(item => item.key === widget.key ? { ...item, filter } : item))}>
                  <SelectTrigger aria-label={`${widgetTitle(widget.key)} filter`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FILTERS[widget.key].map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={widget.key === 'needs_action' || index === 0 || saving} onClick={() => move(index, -1)}>
                  <ArrowUp className="mr-1 h-3.5 w-3.5" /> Up
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={widget.key === 'needs_action' || index >= widgets.length - 1 || widgets[index + 1]?.key === 'needs_action' || saving} onClick={() => move(index, 1)}>
                  <ArrowDown className="mr-1 h-3.5 w-3.5" /> Down
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="ghost" className="mt-6 w-full" disabled={saving} onClick={onReset} data-testid="button-reset-dashboard">
          <RotateCcw className="mr-2 h-4 w-4" /> Reset to the default set
        </Button>
      </SheetContent>
    </Sheet>
  );
}

export function widgetTitle(key: string): string {
  switch (key) {
    case 'needs_action': return 'Needs Action';
    case 'jobs_completed': return 'Jobs Completed';
    case 'invoices_revenue': return 'Invoices & Revenue';
    case 'invoice_attention': return 'Invoices';
    case 'profit_and_loss': return 'Profit and Loss';
    case 'payroll_summary': return 'Payroll Summary';
    case 'schedule': return "Today's & Upcoming Schedule";
    case 'job_waitlist': return 'Job Waitlist';
    case 'inventory_reorder': return 'Inventory Reorder';
    case 'report_snapshots': return 'Key Reports';
    case 'alerts': return 'System, Weather & Equipment';
    default: return key;
  }
}
