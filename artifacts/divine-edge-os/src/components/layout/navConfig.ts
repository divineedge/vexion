import {
  LayoutDashboard, Users, Building, CalendarDays, DraftingCompass, PhoneCall,
  UserCheck, Clock, CheckSquare, Gauge, Banknote,
  PackageSearch, Briefcase, Wrench,
  DollarSign,
  Megaphone, FlaskConical,
  Settings, FileText, Footprints, BarChart3, Star, Repeat, ListTodo, Calculator, Scale,
  Map, ClipboardList, PhoneMissed, PhoneIncoming, Inbox, Layers,
  MessageSquare, Store, ClipboardCheck, IdCard, UserPlus, Globe,
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
  /** Optional per-item role gate, applied on top of the section gate */
  roles?: NavSection['roles'];
}

export interface NavSection {
  id: string;
  label: string;
  /** If set, only roles whose key is true in AuthContext can see this section */
  roles?: Array<'hasHrAccess' | 'isOwner' | 'isManager' | 'isDepartmentManager' | 'isCrewManager' | 'canManageOffice' | 'canManageJobs'>;
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

/** HR nav — shown only when GET /api/hr/meta says hasHrAccess (owner + designated HR). */
export const hrNavItems: NavItem[] = [
  { name: 'Employees', href: '/employees', icon: IdCard },
  { name: 'Hiring',    href: '/hiring',    icon: UserPlus },
];
/** Shown instead of HR nav for everyone without HR access. */
export const myRecordNavItem: NavItem = { name: 'My Record', href: '/my-record', icon: IdCard };

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
      { name: 'Equipment', href: '/equipment', icon: Wrench, roles: ['isCrewManager'] },
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
    // Crew managers see only Estimates here; everything else stays office-only.
    roles: ['canManageOffice', 'isCrewManager'],
    items: [
      { name: 'Estimates',  href: '/estimates',  icon: FileText },
      { name: 'Invoices',   href: '/invoices',   icon: DollarSign, permissionKey: 'pages.billing', aliases: ['/financials'], roles: ['canManageOffice'] },
      { name: 'KPI Dashboard', href: '/kpis', icon: Gauge, permissionKey: 'pages.billing', roles: ['canManageOffice'] },
      { name: 'Reports',    href: '/reports',    icon: BarChart3,  permissionKey: 'pages.reports', roles: ['canManageOffice'] },
      { name: 'Budget',     href: '/budget',     icon: Calculator, permissionKey: 'pages.billing', roles: ['canManageOffice'] },
      { name: 'Pricing Review', href: '/pricing-review', icon: Scale, permissionKey: 'pages.billing', roles: ['canManageOffice'] },
    ],
  },
  {
    id: 'vendors',
    label: 'Vendors',
    roles: ['canManageOffice'],
    items: [
      { name: 'Vendors', href: '/vendors', icon: Store, permissionKey: 'pages.billing' },
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
      { name: 'Website Forms', href: '/website-forms', icon: Globe },
    ],
  },
  {
    id: 'people',
    label: 'People',
    roles: ['hasHrAccess'],
    items: hrNavItems,
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
  for (const section of sections) {
    for (const item of section.items) {
      for (const a of item.aliases ?? []) map[a] = { sectionLabel: section.label, itemName: item.name };
    }
  }
  // Include standalone items so breadcrumbs resolve them
  map['/dashboard'] = { sectionLabel: '', itemName: 'Dashboard' };
  map['/settings']  = { sectionLabel: '', itemName: 'Settings' };
  for (const item of hrNavItems) map[item.href] = { sectionLabel: 'People', itemName: item.name };
  map[myRecordNavItem.href] = { sectionLabel: '', itemName: myRecordNavItem.name };
  return map;
}
