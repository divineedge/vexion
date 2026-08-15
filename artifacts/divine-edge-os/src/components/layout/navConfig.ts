import {
  LayoutDashboard, Users, Building, CalendarDays, DraftingCompass, PhoneCall,
  UserCheck, Clock, CheckSquare, Gauge, Banknote,
  PackageSearch, Briefcase, Wrench,
  DollarSign,
  Megaphone, FlaskConical,
  Settings, FileText, Footprints, BarChart3, Star, Repeat, ListTodo, Calculator,
  Map, ClipboardList, PhoneMissed, PhoneIncoming, Inbox, Layers,
  LucideIcon,
} from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** If set, this item is hidden when the current user's can(permissionKey) returns false */
  permissionKey?: string;
}

export interface NavSection {
  id: string;
  label: string;
  /** If set, only roles whose key is true in AuthContext can see this section */
  roles?: Array<'isOwner' | 'isManager' | 'isDepartmentManager' | 'isCrewManager' | 'canManageOffice' | 'canManageJobs'>;
  items: NavItem[];
}

/** Flat nav shown to technicians */
export const techNavItems: NavItem[] = [
  { name: 'Dashboard',    href: '/dashboard',    icon: LayoutDashboard },
  { name: 'Schedule',     href: '/schedule',     icon: CalendarDays },
  { name: 'Time Tracking', href: '/time-tracking', icon: Clock },
  { name: 'Tasks',        href: '/tasks',        icon: ListTodo },
  { name: 'Callbacks',    href: '/callbacks',    icon: PhoneCall },
  { name: 'Daily Tasks',  href: '/daily-tasks',  icon: ClipboardList },
];

/**
 * Dashboard and Settings are rendered as standalone links in AppLayout —
 * not inside any collapsible section. They are listed here only so
 * buildNavIndex can include them in breadcrumb lookups.
 */
export const standaloneNavItems: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Settings',  href: '/settings',  icon: Settings },
];

/** Sectioned nav for admin / office / crew-manager roles */
export const adminNavSections: NavSection[] = [
  {
    id: 'customers',
    label: 'Customers',
    roles: ['canManageOffice', 'isCrewManager'],
    items: [
      { name: 'Customers',       href: '/customers',     icon: Users },
      { name: 'Properties',      href: '/properties',    icon: Building },
      { name: 'Schedule',        href: '/schedule',      icon: CalendarDays },
      { name: 'Estimates',       href: '/estimates',     icon: FileText },
      { name: 'Visits',          href: '/visits',        icon: Footprints },
      { name: 'Daily Tasks',     href: '/daily-tasks',   icon: ClipboardList },
    ],
  },
  {
    id: 'field-ops',
    label: 'Field Ops',
    roles: ['canManageOffice', 'isCrewManager'],
    items: [
      { name: 'Crews',         href: '/crews',         icon: UserCheck },
      { name: 'Routes',        href: '/routes',        icon: Map },
      { name: 'Blueprints',    href: '/blueprints',    icon: DraftingCompass },
      { name: 'Time Tracking', href: '/time-tracking', icon: Clock },
      { name: 'Efficiency',    href: '/efficiency',    icon: Gauge },
      { name: 'P4P Payroll',   href: '/payroll',       icon: Banknote },
    ],
  },
  {
    id: 'inventory-equipment',
    label: 'Inventory & Equipment',
    roles: ['canManageOffice'],
    items: [
      { name: 'Inventory', href: '/inventory', icon: PackageSearch },
      { name: 'Equipment', href: '/equipment', icon: Wrench, permissionKey: 'pages.equipment' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    roles: ['canManageOffice'],
    items: [
      { name: 'Financials', href: '/financials', icon: DollarSign, permissionKey: 'pages.billing' },
      { name: 'Reports',    href: '/reports',    icon: BarChart3,  permissionKey: 'pages.reports' },
      { name: 'Budget',     href: '/budget',     icon: Calculator, permissionKey: 'pages.billing' },
    ],
  },
  {
    id: 'service-breakdown',
    label: 'Service Breakdown',
    roles: ['canManageOffice'],
    items: [
      { name: 'Services',  href: '/services',  icon: Briefcase,   permissionKey: 'pages.services' },
      { name: 'Plans',     href: '/plans',     icon: Repeat },
      { name: 'Chemicals', href: '/chemicals', icon: FlaskConical },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    roles: ['canManageOffice'],
    items: [
      { name: 'Marketing', href: '/marketing', icon: Megaphone },
      { name: 'Reviews',   href: '/reviews',   icon: Star },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    roles: ['canManageOffice'],
    items: [
      { name: 'Callbacks',       href: '/callbacks',     icon: PhoneCall },
      { name: 'Tasks',           href: '/tasks',         icon: ListTodo },
      { name: 'Calls',           href: '/calls',         icon: PhoneIncoming },
      { name: 'Follow-Up Queue', href: '/followup-queue', icon: PhoneMissed },
      { name: 'Portal Inbox',    href: '/portal-inbox',  icon: Inbox },
    ],
  },
];

/** Build a flat href→{section,item} lookup used by Breadcrumb */
export function buildNavIndex(sections: NavSection[]) {
  const map: Record<string, { sectionLabel: string; itemName: string }> = {};
  for (const section of sections) {
    for (const item of section.items) {
      map[item.href] = { sectionLabel: section.label, itemName: item.name };
    }
  }
  // Include standalone items so breadcrumbs resolve them
  map['/dashboard'] = { sectionLabel: '', itemName: 'Dashboard' };
  map['/settings']  = { sectionLabel: '', itemName: 'Settings' };
  return map;
}
