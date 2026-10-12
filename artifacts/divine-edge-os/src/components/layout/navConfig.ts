import {
  LayoutDashboard, Users, Building, CalendarDays, DraftingCompass, PhoneCall,
  UserCheck, Clock, CheckSquare, Gauge, Banknote,
  PackageSearch, Briefcase, Wrench,
  DollarSign,
  Megaphone, FlaskConical,
  Settings, FileText, Footprints, BarChart3, Star, Repeat, ListTodo, Calculator,
  Map, ClipboardList, PhoneMissed, PhoneIncoming, Inbox, Layers,
  MessageSquare, Store, ClipboardCheck,
  LucideIcon,
} from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** If set, this item is hidden when the current user's can(permissionKey) returns false */
  permissionKey?: string;
  /** Other paths that should highlight this item (e.g. legacy routes) */
  aliases?: string[];
}

export interface PinnedNavItem extends NavItem {
  roles: NonNullable<NavSection['roles']>;
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
  { name: 'Forms',        href: '/forms',        icon: ClipboardCheck },
  { name: 'Messages',     href: '/staff-messages', icon: MessageSquare },
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

/**
 * One-click links rendered directly under Dashboard (not inside a collapsible
 * section). Each carries the same role / permission gate it had in its section.
 */
export const pinnedNavItems: PinnedNavItem[] = [
  { name: 'Schedule',  href: '/schedule',  icon: CalendarDays, roles: ['canManageOffice', 'isCrewManager'] },
  { name: 'Invoices',  href: '/invoices',  icon: DollarSign,   roles: ['canManageOffice'], permissionKey: 'pages.billing', aliases: ['/financials'] },
  { name: 'Estimates', href: '/estimates', icon: FileText,     roles: ['canManageOffice', 'isCrewManager'] },
  { name: 'Vendors',   href: '/vendors',   icon: Store,        roles: ['canManageOffice'], permissionKey: 'pages.billing' },
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
    ],
  },
  {
    id: 'field-ops',
    label: 'Field Ops',
    roles: ['canManageOffice', 'isCrewManager'],
    items: [
      { name: 'Schedule',      href: '/schedule',      icon: CalendarDays },
      { name: 'Visits',        href: '/visits',        icon: Footprints },
      { name: 'Daily Tasks',   href: '/daily-tasks',   icon: ClipboardList },
      { name: 'Forms',         href: '/forms',         icon: ClipboardCheck },
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
      { name: 'Staff Messages', href: '/staff-messages', icon: MessageSquare },
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
  for (const item of pinnedNavItems) {
    map[item.href] = { sectionLabel: '', itemName: item.name };
    for (const a of item.aliases ?? []) map[a] = { sectionLabel: '', itemName: item.name };
  }
  // Include standalone items so breadcrumbs resolve them
  map['/dashboard'] = { sectionLabel: '', itemName: 'Dashboard' };
  map['/settings']  = { sectionLabel: '', itemName: 'Settings' };
  return map;
}
