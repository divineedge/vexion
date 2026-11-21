export type WidgetConfig = {
  key: string;
  visible: boolean;
  timeframe: 'today' | 'week' | 'month' | 'quarter' | 'year';
  filter: string | null;
};

export type DashboardLayout = {
  widgets: WidgetConfig[];
  taskSources: string[];
};

export type ActionTask = {
  source: string;
  sourceId: number;
  title: string;
  detail: string;
  href: string;
  createdAt: string;
  date?: string;
};

export type OperationsPayload = {
  layout: DashboardLayout;
  tasks: ActionTask[];
  widgets: {
    jobsCompleted: { count: number; value: number | null; restricted: boolean; empty: boolean; timeframe: string; filter: string | null } | null;
    invoicesRevenue: { openCount: number; overdueCount: number; collectedCount: number; openTotal: number | null; overdueTotal: number | null; collectedTotal: number | null; restricted: boolean; empty: boolean; timeframe: string; filter: string | null } | null;
    payrollSummary: { entries: number; people: number; openClocks: number; minutes: number; estimatedPay: number | null; periodCount: number; restricted: boolean; empty: boolean; timeframe: string; filter: string | null } | null;
    schedule: { today: ScheduleJob[]; upcoming: ScheduleJob[]; empty: boolean; timeframe: string; filter: string | null } | null;
    reportSnapshots: { snapshots: { key: string; label: string; count: number; value: number | null; href: string }[]; empty: boolean; timeframe: string; filter: string | null } | null;
    alerts: { system: { id: string; severity: string; message: string }[]; weather: { id: number; title: string; detail: string; href: string }[]; equipment: { id: number; name: string; detail: string; href: string }[]; empty: boolean; timeframe: string; filter: string | null } | null;
  };
};

export type ScheduleJob = { id: number; title: string; status: string; customerName: string | null; scheduledAt: string; href: string };

export const TASK_SOURCE_OPTIONS = [
  { value: 'portal_message', label: 'Portal messages' },
  { value: 'estimate_response', label: 'Estimate responses' },
  { value: 'equipment_maintenance', label: 'Equipment maintenance' },
  { value: 'rain_warning', label: 'High-rain warnings' },
  { value: 'followup', label: 'Follow-ups' },
] as const;

export function money(value: number | null): string {
  if (value == null) return 'Hidden';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function timeframeLabel(value: string | undefined): string {
  switch (value) {
    case 'today': return 'Today';
    case 'week': return 'This week';
    case 'month': return 'This month';
    case 'quarter': return 'This quarter';
    case 'year': return 'This year';
    default: return 'This period';
  }
}
