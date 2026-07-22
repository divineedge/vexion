import {
  Briefcase,
  Users,
  FileText,
  ClipboardList,
  CheckSquare,
  Receipt,
  Calendar,
  BarChart2,
  type LucideIcon,
} from 'lucide-react';

export type ShortcutAction = { kind: 'navigate'; to: string };

export interface ShortcutDef {
  id: string;
  label: string;
  icon: LucideIcon;
  action: ShortcutAction;
}

export const SHORTCUT_CATALOG: ShortcutDef[] = [
  {
    id: 'new-job',
    label: 'New Job',
    icon: Briefcase,
    action: { kind: 'navigate', to: '/schedule?action=create' },
  },
  {
    id: 'new-customer',
    label: 'New Customer',
    icon: Users,
    action: { kind: 'navigate', to: '/customers?action=create' },
  },
  {
    id: 'new-invoice',
    label: 'New Invoice',
    icon: FileText,
    action: { kind: 'navigate', to: '/financials?action=create' },
  },
  {
    id: 'new-estimate',
    label: 'New Estimate',
    icon: ClipboardList,
    action: { kind: 'navigate', to: '/estimates?action=create' },
  },
  {
    id: 'new-task',
    label: 'New Task',
    icon: CheckSquare,
    action: { kind: 'navigate', to: '/tasks?action=create' },
  },
  {
    id: 'new-expense',
    label: 'Expenses',
    icon: Receipt,
    action: { kind: 'navigate', to: '/financials' },
  },
  {
    id: 'go-calendar',
    label: 'Go to Calendar',
    icon: Calendar,
    action: { kind: 'navigate', to: '/schedule' },
  },
  {
    id: 'go-reports',
    label: 'Go to Reports',
    icon: BarChart2,
    action: { kind: 'navigate', to: '/reports' },
  },
];

export const DEFAULT_SHORTCUTS = ['new-job', 'new-customer', 'new-invoice'];

export const MAX_SHORTCUTS = 6;

export function getCatalogEntry(id: string): ShortcutDef | undefined {
  return SHORTCUT_CATALOG.find(s => s.id === id);
}
