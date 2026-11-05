export const DEMO_MODE_KEY = 'is_demo_mode';
export const DEMO_SANDBOX_KEY = 'field_app_demo_sandbox';

export type CustomerKind = 'residential' | 'hoa' | 'commercial';
export type JobStatus = 'completed' | 'in_progress' | 'en_route' | 'scheduled';
export type InvoiceStatus = 'past_due' | 'pending' | 'paid';
export type EstimateStatus = 'pending_approval' | 'approved';

export interface DemoContact {
  name: string;
  phone: string;
  email: string;
}

export interface DemoProperty {
  id: number;
  customerId: number;
  name: string;
  address: string;
  city: string;
  gateCode: string;
  sqft: number;
  lawnCondition: string;
  lat: number;
  lng: number;
}

export interface DemoCustomer {
  id: number;
  name: string;
  kind: CustomerKind;
  primaryContact: DemoContact;
  propertyIds: number[];
}

export interface DemoCrew {
  id: string;
  name: string;
  focus: string;
  members: string[];
}

export interface DemoBreak {
  start: string;
  end: string;
}

export interface DemoJob {
  id: number;
  customerId: number;
  propertyId: number;
  crewId: string;
  routeId: string;
  sequence: number;
  title: string;
  service: string;
  status: JobStatus;
  scheduledAt: string;
  budgetMinutes: number;
  actualMinutes: number;
  revenue: number;
  clockIn: string | null;
  clockOut: string | null;
  breaks: DemoBreak[];
  technician: string;
}

export interface DemoRoute {
  id: string;
  name: string;
  crewId: string;
  jobIds: number[];
}

export interface DemoLine {
  description: string;
  qty: number;
  unitPrice: number;
}

export interface DemoInvoice {
  id: number;
  customerId: number;
  number: string;
  status: InvoiceStatus;
  issuedOn: string;
  dueOn: string;
  lines: DemoLine[];
}

export interface DemoEstimate {
  id: number;
  customerId: number;
  propertyId: number;
  number: string;
  title: string;
  status: EstimateStatus;
  lines: DemoLine[];
}

export interface DemoChemicalLog {
  id: number;
  jobId: number;
  product: string;
  epaNumber: string;
  targetPest: string;
  windMph: number;
  tempF: number;
  rate: string;
  technician: string;
  signature: string;
  appliedAt: string;
  materialCost: number;
}

export interface DemoEmployee {
  id: string;
  name: string;
  crewId: string;
  role: string;
  hourlyRate: number;
}

export interface DemoSandbox {
  seededAt: string;
  timezone: 'America/Denver';
  customers: DemoCustomer[];
  properties: DemoProperty[];
  crews: DemoCrew[];
  employees: DemoEmployee[];
  jobs: DemoJob[];
  routes: DemoRoute[];
  invoices: DemoInvoice[];
  estimates: DemoEstimate[];
  chemicalLogs: DemoChemicalLog[];
}

const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function storage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function writeRaw(key: string, value: string) {
  memory.set(key, value);
  storage()?.setItem(key, value);
}

function readRaw(key: string): string | null {
  const stored = storage()?.getItem(key);
  if (stored != null) return stored;
  return memory.get(key) ?? null;
}

export function isDemoMode(): boolean {
  return readRaw(DEMO_MODE_KEY) === 'true';
}

export function lineTotal(lines: DemoLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
}

export function crewEfficiency(jobs: DemoJob[], crewId: string): number {
  const worked = jobs.filter(job => job.crewId === crewId && job.actualMinutes > 0);
  const budget = worked.reduce((sum, job) => sum + job.budgetMinutes, 0);
  const actual = worked.reduce((sum, job) => sum + job.actualMinutes, 0);
  if (!actual) return 0;
  return Math.round((budget / actual) * 100);
}

export function earnedP4p(jobs: DemoJob[]): number {
  return jobs
    .filter(job => job.status === 'completed' && job.actualMinutes > 0)
    .reduce((sum, job) => sum + Math.round(job.revenue * 0.12 * (job.budgetMinutes / job.actualMinutes)), 0);
}

function denverKey(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function shiftKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function at(dateKey: string, hours: number, minutes: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  let utc = Date.UTC(year, month - 1, day, hours, minutes, 0);
  const offset = zoneOffsetMs('America/Denver', new Date(utc));
  utc -= offset;
  const second = zoneOffsetMs('America/Denver', new Date(utc));
  if (second !== offset) utc = Date.UTC(year, month - 1, day, hours, minutes, 0) - second;
  return new Date(utc).toISOString();
}

function zoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find(part => part.type === type)?.value);
  let hour = pick('hour');
  let day = pick('day');
  if (hour === 24) {
    hour = 0;
    day += 1;
  }
  return Date.UTC(pick('year'), pick('month') - 1, day, hour, pick('minute'), pick('second')) - date.getTime();
}

export function buildDemoSandbox(now = new Date()): DemoSandbox {
  const today = denverKey(now);
  const yesterday = shiftKey(today, -1);
  const issued = shiftKey(today, -12);
  const duePast = shiftKey(today, -4);
  const dueSoon = shiftKey(today, 10);

  const properties: DemoProperty[] = [
    { id: 1, customerId: 1, name: 'Vasquez residence', address: '1842 Lowell Blvd', city: 'Denver, CO', gateCode: '4821', sqft: 8400, lawnCondition: 'Thin fescue with broadleaf weeds along the parkway', lat: 39.761, lng: -105.035, },
    { id: 2, customerId: 2, name: 'Hale residence', address: '910 Cherry St', city: 'Denver, CO', gateCode: 'Keypad 19', sqft: 6200, lawnCondition: 'Healthy bluegrass, light traffic wear by the walk', lat: 39.732, lng: -104.973, },
    { id: 3, customerId: 3, name: 'Willow Creek commons', address: '400 Willow Creek Dr', city: 'Westminster, CO', gateCode: '7704', sqft: 128000, lawnCondition: 'Dry spots on the south slope, irrigation zone 3 short', lat: 39.837, lng: -105.037, },
    { id: 4, customerId: 4, name: 'Cedar Ridge greenbelt', address: '220 Cedar Ridge Pkwy', city: 'Aurora, CO', gateCode: '2208', sqft: 96000, lawnCondition: 'Overgrown edges and clover in the play-field turf', lat: 39.701, lng: -104.812, },
    { id: 5, customerId: 5, name: 'Northgate Plaza', address: '5050 Federal Blvd', city: 'Denver, CO', gateCode: 'Call security', sqft: 210000, lawnCondition: 'Compacted turf in the parking islands, shaded north beds', lat: 39.787, lng: -105.025, },
  ];

  const customers: DemoCustomer[] = [
    { id: 1, name: 'Elena Vasquez', kind: 'residential', primaryContact: { name: 'Elena Vasquez', phone: '(303) 555-0142', email: 'elena@vasquez.example' }, propertyIds: [1] },
    { id: 2, name: 'Marcus Hale', kind: 'residential', primaryContact: { name: 'Marcus Hale', phone: '(303) 555-0177', email: 'marcus@hale.example' }, propertyIds: [2] },
    { id: 3, name: 'Willow Creek HOA', kind: 'hoa', primaryContact: { name: 'Dana Cho, community manager', phone: '(720) 555-0118', email: 'dana@willowcreekhoa.example' }, propertyIds: [3] },
    { id: 4, name: 'Cedar Ridge HOA', kind: 'hoa', primaryContact: { name: 'Luis Ortega, board president', phone: '(303) 555-0190', email: 'luis@cedarridgehoa.example' }, propertyIds: [4] },
    { id: 5, name: 'Northgate Plaza', kind: 'commercial', primaryContact: { name: 'Alicia Grant, facilities', phone: '(303) 555-0164', email: 'alicia@northgateplaza.example' }, propertyIds: [5] },
  ];

  const crews: DemoCrew[] = [
    { id: 'crew-a', name: 'Crew A', focus: 'Mowing', members: ['Jordan Lee', 'Sam Ortiz'] },
    { id: 'crew-b', name: 'Crew B', focus: 'Fertilization/Chemical', members: ['Priya Shah', 'Chris Nguyen'] },
  ];

  const employees: DemoEmployee[] = [
    { id: 'jordan', name: 'Jordan Lee', crewId: 'crew-a', role: 'Crew lead', hourlyRate: 22 },
    { id: 'sam', name: 'Sam Ortiz', crewId: 'crew-a', role: 'Technician', hourlyRate: 20 },
    { id: 'priya', name: 'Priya Shah', crewId: 'crew-b', role: 'Licensed applicator', hourlyRate: 24 },
    { id: 'chris', name: 'Chris Nguyen', crewId: 'crew-b', role: 'Technician', hourlyRate: 21 },
  ];

  const jobs: DemoJob[] = [
    { id: 101, customerId: 1, propertyId: 1, crewId: 'crew-a', routeId: 'route-a', sequence: 1, title: 'Weekly mow and edge', service: 'Mowing', status: 'completed', scheduledAt: at(today, 7, 0), budgetMinutes: 90, actualMinutes: 78, revenue: 85, clockIn: at(today, 7, 0), clockOut: at(today, 8, 33), breaks: [{ start: at(today, 7, 40), end: at(today, 7, 55) }], technician: 'Jordan Lee' },
    { id: 102, customerId: 3, propertyId: 3, crewId: 'crew-a', routeId: 'route-a', sequence: 2, title: 'Commons mow', service: 'Mowing', status: 'in_progress', scheduledAt: at(today, 8, 45), budgetMinutes: 60, actualMinutes: 52, revenue: 640, clockIn: at(today, 8, 45), clockOut: null, breaks: [], technician: 'Sam Ortiz' },
    { id: 103, customerId: 5, propertyId: 5, crewId: 'crew-a', routeId: 'route-a', sequence: 3, title: 'Plaza turf mow', service: 'Mowing', status: 'scheduled', scheduledAt: at(today, 13, 0), budgetMinutes: 75, actualMinutes: 0, revenue: 980, clockIn: null, clockOut: null, breaks: [], technician: 'Jordan Lee' },
    { id: 104, customerId: 2, propertyId: 2, crewId: 'crew-b', routeId: 'route-b', sequence: 1, title: 'Fall fertilization', service: 'Fertilization', status: 'completed', scheduledAt: at(today, 7, 30), budgetMinutes: 50, actualMinutes: 55, revenue: 120, clockIn: at(today, 7, 30), clockOut: at(today, 8, 25), breaks: [], technician: 'Priya Shah' },
    { id: 105, customerId: 4, propertyId: 4, crewId: 'crew-b', routeId: 'route-b', sequence: 2, title: 'Broadleaf treatment', service: 'Chemical', status: 'en_route', scheduledAt: at(today, 9, 15), budgetMinutes: 40, actualMinutes: 12, revenue: 410, clockIn: at(today, 9, 10), clockOut: null, breaks: [], technician: 'Chris Nguyen' },
    { id: 106, customerId: 5, propertyId: 5, crewId: 'crew-b', routeId: 'route-b', sequence: 3, title: 'Island turf feed', service: 'Fertilization', status: 'scheduled', scheduledAt: at(today, 14, 30), budgetMinutes: 45, actualMinutes: 0, revenue: 560, clockIn: null, clockOut: null, breaks: [], technician: 'Priya Shah' },
    { id: 107, customerId: 1, propertyId: 1, crewId: 'crew-b', routeId: 'route-b', sequence: 0, title: 'Pre-emergent application', service: 'Chemical', status: 'completed', scheduledAt: at(yesterday, 10, 0), budgetMinutes: 40, actualMinutes: 36, revenue: 95, clockIn: at(yesterday, 10, 0), clockOut: at(yesterday, 10, 36), breaks: [], technician: 'Priya Shah' },
  ];

  const routes: DemoRoute[] = [
    { id: 'route-a', name: 'North Denver mow', crewId: 'crew-a', jobIds: [101, 102, 103] },
    { id: 'route-b', name: 'Chemical loop', crewId: 'crew-b', jobIds: [104, 105, 106] },
  ];

  const invoices: DemoInvoice[] = [
    { id: 1, customerId: 1, number: 'INV-1042', status: 'paid', issuedOn: issued, dueOn: shiftKey(today, -2), lines: [{ description: 'Weekly mow and edge', qty: 4, unitPrice: 85 }, { description: 'Bed weeding', qty: 1, unitPrice: 45 }] },
    { id: 2, customerId: 2, number: 'INV-1048', status: 'paid', issuedOn: issued, dueOn: shiftKey(today, -1), lines: [{ description: 'Fall fertilization', qty: 1, unitPrice: 120 }, { description: 'Soil test', qty: 1, unitPrice: 35 }] },
    { id: 3, customerId: 3, number: 'INV-1051', status: 'past_due', issuedOn: shiftKey(today, -20), dueOn: duePast, lines: [{ description: 'Commons mow', qty: 2, unitPrice: 640 }, { description: 'Irrigation wet-check', qty: 1, unitPrice: 180 }] },
    { id: 4, customerId: 5, number: 'INV-1055', status: 'pending', issuedOn: shiftKey(today, -3), dueOn: dueSoon, lines: [{ description: 'Plaza turf mow', qty: 2, unitPrice: 980 }, { description: 'Parking-island detail', qty: 1, unitPrice: 240 }] },
    { id: 5, customerId: 4, number: 'INV-1039', status: 'paid', issuedOn: shiftKey(today, -28), dueOn: shiftKey(today, -14), lines: [{ description: 'Bed maintenance', qty: 1, unitPrice: 720 }, { description: 'Play-field mow', qty: 2, unitPrice: 310 }] },
  ];

  const estimates: DemoEstimate[] = [
    { id: 1, customerId: 4, propertyId: 4, number: 'EST-220', title: 'Aeration and overseed', status: 'pending_approval', lines: [{ description: 'Core aeration', qty: 96000, unitPrice: 0.012 }, { description: 'Overseed athletic mix', qty: 4, unitPrice: 185 }] },
    { id: 2, customerId: 5, propertyId: 5, number: 'EST-224', title: 'Seasonal color install', status: 'pending_approval', lines: [{ description: 'Annual color beds', qty: 12, unitPrice: 95 }, { description: 'Mulch refresh', qty: 8, unitPrice: 70 }] },
  ];

  const chemicalLogs: DemoChemicalLog[] = [
    { id: 1, jobId: 104, product: 'Barricade 4FL', epaNumber: '100-1139', targetPest: 'Crabgrass', windMph: 6, tempF: 58, rate: '0.75 fl oz / 1,000 sq ft', technician: 'Priya Shah', signature: 'Priya Shah', appliedAt: at(today, 7, 48), materialCost: 28 },
    { id: 2, jobId: 107, product: 'Prodiamine 65 WDG', epaNumber: '53883-286', targetPest: 'Annual grassy weeds', windMph: 4, tempF: 61, rate: '0.18 oz / 1,000 sq ft', technician: 'Priya Shah', signature: 'Priya Shah', appliedAt: at(yesterday, 10, 12), materialCost: 22 },
  ];

  return {
    seededAt: now.toISOString(),
    timezone: 'America/Denver',
    customers,
    properties,
    crews,
    employees,
    jobs,
    routes,
    invoices,
    estimates,
    chemicalLogs,
  };
}

export function seedDemoSandbox(now = new Date()): DemoSandbox {
  const sandbox = buildDemoSandbox(now);
  writeRaw(DEMO_MODE_KEY, 'true');
  writeRaw(DEMO_SANDBOX_KEY, JSON.stringify(sandbox));
  listeners.forEach(listener => listener());
  return sandbox;
}

export function loadDemoSandbox(): DemoSandbox | null {
  if (!isDemoMode()) return null;
  const raw = readRaw(DEMO_SANDBOX_KEY);
  if (!raw) return seedDemoSandbox();
  try {
    return JSON.parse(raw) as DemoSandbox;
  } catch {
    return seedDemoSandbox();
  }
}

export function saveDemoSandbox(sandbox: DemoSandbox) {
  writeRaw(DEMO_SANDBOX_KEY, JSON.stringify(sandbox));
  listeners.forEach(listener => listener());
}

export function clearDemoSandbox() {
  memory.delete(DEMO_MODE_KEY);
  memory.delete(DEMO_SANDBOX_KEY);
  storage()?.removeItem(DEMO_MODE_KEY);
  storage()?.removeItem(DEMO_SANDBOX_KEY);
  listeners.forEach(listener => listener());
}

export function updateDemoSandbox(change: (sandbox: DemoSandbox) => DemoSandbox): DemoSandbox | null {
  const current = loadDemoSandbox();
  if (!current) return null;
  const next = change(current);
  saveDemoSandbox(next);
  return next;
}

export function subscribeDemoSandbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function customerById(sandbox: DemoSandbox, id: number) {
  return sandbox.customers.find(customer => customer.id === id) ?? null;
}

export function propertyById(sandbox: DemoSandbox, id: number) {
  return sandbox.properties.find(property => property.id === id) ?? null;
}

export function invoiceAmount(invoice: DemoInvoice) {
  return lineTotal(invoice.lines);
}

export function financialSummary(sandbox: DemoSandbox) {
  const totals = { paid: 0, pending: 0, past_due: 0 };
  for (const invoice of sandbox.invoices) totals[invoice.status] += invoiceAmount(invoice);
  const materials = sandbox.chemicalLogs.reduce((sum, log) => sum + log.materialCost, 0);
  const labor = sandbox.jobs.reduce((sum, job) => {
    const crew = sandbox.employees.filter(employee => employee.crewId === job.crewId);
    const rate = crew.reduce((inner, employee) => inner + employee.hourlyRate, 0) / Math.max(crew.length, 1);
    return sum + (job.actualMinutes / 60) * rate;
  }, 0);
  const p4p = earnedP4p(sandbox.jobs);
  const revenue = totals.paid;
  return {
    ...totals,
    revenue,
    materials,
    labor: Math.round(labor),
    p4p,
    profit: Math.round(revenue - labor - materials - p4p),
  };
}
