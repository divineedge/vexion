import {
  LayoutDashboard, Users, Building, CalendarDays, DraftingCompass, PhoneCall,
  UserCheck, Clock, CheckSquare, Gauge, Banknote,
  PackageSearch, Briefcase, Wrench,
  DollarSign, Banknote as InvoiceIcon,
  Megaphone, FlaskConical,
  Settings, FileText, Footprints, BarChart3, Star, Repeat, ListTodo,
  Map,
  LucideIcon,
} from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

export interface NavSection {
  id: string;
  label: string;
  /** If set, only roles whose key is true in AuthContext can see this section */
  roles?: Array<'isOwner' | 'isManager' | 'isDepartmentManager' | 'isCrewManager' | 'canManageOffice' | 'canManageJobs'>;
  items: NavItem[];
}

/** Flat nav shown to technicians — unchanged */
export const techNavItems: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Schedule',  href: '/schedule',  icon: CalendarDays },
  { name: 'Time Tracking', href: '/time-tracking', icon: Clock },
  { name: 'Tasks',     href: '/tasks',     icon: ListTodo },
  { name: 'Callbacks', href: '/callbacks', icon: PhoneCall },
  { name: 'Daily Routines', href: '/daily-routines', icon: CheckSquare },
];

/** Sectioned nav for admin / office / crew-manager roles */
export const adminNavSections: NavSection[] = [
  {
    id: 'people-jobs',
    label: 'People & Jobs',
    items: [
      { name: 'Dashboard',      href: '/dashboard',      icon: LayoutDashboard },
      { name: 'Customers',      href: '/customers',      icon: Users },
      { name: 'Properties',     href: '/properties',     icon: Building },
      { name: 'Schedule',       href: '/schedule',       icon: CalendarDays },
      { name: 'Estimates',      href: '/estimates',      icon: FileText },
      { name: 'Visits',         href: '/visits',         icon: Footprints },
      { name: 'Blueprints',     href: '/blueprints',     icon: DraftingCompass },
      { name: 'Callbacks',      href: '/callbacks',      icon: PhoneCall },
      { name: 'Tasks',          href: '/tasks',          icon: ListTodo },
    ],
  },
  {
    id: 'field-ops',
    label: 'Field Ops',
    items: [
      { name: 'Crews',          href: '/crews',          icon: UserCheck },
      { name: 'Routes',         href: '/routes',         icon: Map },
      { name: 'Time Tracking',  href: '/time-tracking',  icon: Clock },
      { name: 'Daily Routines', href: '/daily-routines', icon: CheckSquare },
      { name: 'Efficiency',     href: '/efficiency',     icon: Gauge },
      { name: 'P4P Payroll',    href: '/payroll',        icon: Banknote },
    ],
  },
  {
    id: 'inventory-equipment',
    label: 'Inventory & Equipment',
    roles: ['canManageOffice'],
    items: [
      { name: 'Inventory',  href: '/inventory',  icon: PackageSearch },
      { name: 'Services',   href: '/services',   icon: Briefcase },
      { name: 'Equipment',  href: '/equipment',  icon: Wrench },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    roles: ['canManageOffice'],
    items: [
      { name: 'Financials', href: '/financials', icon: DollarSign },
      { name: 'Reports',    href: '/reports',    icon: BarChart3 },
      { name: 'Plans',      href: '/plans',      icon: Repeat },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    roles: ['canManageOffice'],
    items: [
      { name: 'Marketing',  href: '/marketing',  icon: Megaphone },
      { name: 'Reviews',    href: '/reviews',    icon: Star },
      { name: 'Chemicals',  href: '/chemicals',  icon: FlaskConical },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    roles: ['canManageOffice'],
    items: [
      { name: 'Settings', href: '/settings', icon: Settings },
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
  return map;
}
