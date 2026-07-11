export const TASK_PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

export const TASK_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'rejected', label: 'Rejected' },
] as const;

export const TASK_CONTEXT_TYPES = [
  { value: 'customer', label: 'Customer' },
  { value: 'job', label: 'Job' },
  { value: 'property', label: 'Property' },
  { value: 'equipment', label: 'Equipment' },
] as const;

export const TASK_ROLE_BUCKETS = [
  { value: 'admin_office', label: 'Any Admin/Office' },
  { value: 'manager', label: 'Any Manager' },
  { value: 'technician', label: 'Any Technician' },
] as const;

export interface QuickActionType {
  value: string;
  label: string;
  description: string;
  defaultContextType?: 'customer' | 'job' | 'property' | 'equipment';
  defaultAssignedToRole?: string;
  titleTemplate: (label?: string) => string;
}

export const QUICK_ACTION_TYPES: QuickActionType[] = [
  {
    value: 'invoice_job',
    label: 'Invoice This Job',
    description: 'Ask the office to invoice a completed job.',
    defaultContextType: 'job',
    defaultAssignedToRole: 'admin_office',
    titleTemplate: (label) => `Please invoice ${label ?? '[Job]'}`,
  },
  {
    value: 'call_customer',
    label: 'Call This Customer',
    description: 'Ask the office to call a customer back.',
    defaultContextType: 'customer',
    defaultAssignedToRole: 'admin_office',
    titleTemplate: (label) => `Please call ${label ?? '[Customer]'}`,
  },
  {
    value: 'follow_up',
    label: 'Follow Up With Customer',
    description: 'Flag a customer for office follow-up.',
    defaultContextType: 'customer',
    defaultAssignedToRole: 'admin_office',
    titleTemplate: (label) => `Follow up with ${label ?? '[Customer]'}`,
  },
  {
    value: 'equipment_repair',
    label: 'Equipment Needs Repair',
    description: 'Flag a piece of equipment for repair or maintenance.',
    defaultContextType: 'equipment',
    defaultAssignedToRole: 'admin_office',
    titleTemplate: (label) => `Repair needed: ${label ?? '[Equipment]'}`,
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Anything else — start from a blank form.',
    titleTemplate: () => '',
  },
];

export function priorityBadgeClass(priority: string): string {
  switch (priority) {
    case 'urgent': return 'bg-red-100 text-red-700 border-red-200';
    case 'high': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'low': return 'bg-slate-100 text-slate-600 border-slate-200';
    default: return 'bg-blue-50 text-blue-700 border-blue-200';
  }
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'done': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'rejected': return 'bg-red-50 text-red-700 border-red-200';
    case 'in_progress': return 'bg-blue-50 text-blue-700 border-blue-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function roleBucketLabel(value: string | null | undefined): string {
  return TASK_ROLE_BUCKETS.find(b => b.value === value)?.label ?? value ?? '';
}
