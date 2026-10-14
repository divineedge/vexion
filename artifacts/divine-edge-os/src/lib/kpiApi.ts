import { getKpiDashboardSettings, updateKpiDashboardSettings, getKpiDashboardReport } from '@workspace/api-client-react';
import type { KpiDatePreset } from './kpiDates';

export const KPI_CATALOG = [
  { id: 'revenue_hour', name: 'Revenue per person-hour', description: 'Service revenue per recorded person-hour, compared with the service division budget.' },
  { id: 'efficiency', name: 'Labor efficiency', description: 'Budgeted person-hours divided by actual person-hours on the same completed, budgeted jobs.' },
  { id: 'margin', name: 'Job gross margin', description: 'Estimated direct margin after recorded labor, material and fuel costs; cost gaps are flagged.' },
  { id: 'underpriced', name: 'Underpriced jobs', description: 'Comparable jobs below the division budget recommendation, including minimum charges.' },
  { id: 'unbilled', name: 'Completed work needing invoicing', description: 'Uninvoiced completed work, separating billing holds and scheduled billing cycles.' },
  { id: 'overdue', name: 'Overdue invoices', description: 'Outstanding balances by age, excluding prepaid credit and deposits already applied.' },
  { id: 'cash', name: 'Cash collected', description: 'New invoice payments, deposits and prepaid purchases shown separately, without counting credit applications twice.' },
  { id: 'acceptance', name: 'Estimate acceptance', description: 'Accepted estimates divided by estimates sent in the selected period, by count and value.' },
  { id: 'callbacks', name: 'Callback rate', description: 'Callback tickets created divided by jobs completed in the same period.' },
  { id: 'retention', name: 'Customer retention', description: 'Customers served in the preceding equal-length period who were also served in this period.' },
  { id: 'schedule', name: 'Schedule completion', description: 'Jobs scheduled in the period that have been completed; cancelled and unfinished work is identified.' },
  { id: 'productive', name: 'Productive-time percentage', description: 'Recorded job time divided by master-clock time, with non-job activity breakdown.' },
  { id: 'customer_spend', name: 'Average customer spend', description: 'Paid invoice value divided by distinct paying customers, for a selected year or date range. Includes annual breakdowns.' },
] as const;
export type KpiId = typeof KPI_CATALOG[number]['id'];
export const DEFAULT_KPIS: KpiId[] = ['revenue_hour', 'efficiency', 'margin', 'unbilled', 'overdue', 'acceptance', 'customer_spend'];
export interface KpiSettings { mainKpis: KpiId[]; detailKpis: KpiId[]; defaultDateRange?:KpiDatePreset; customFrom?:string|null; customTo?:string|null }
export interface KpiJob {
  id: number; title: string; customerId: number | null; customerName: string; serviceId: number | null;
  crewId: number | null; crewName: string; status: string; scheduledDate: string; completedDate: string | null;
  total: number; minutes: number; budgetMinutes: number; openTimers: boolean;
  materialSell: number; materialCost: number | null; laborCost: number | null; fuelCost: number;
  materialsInvalid: boolean;
  workers?: { id: number; name: string; minutes: number }[];
}
export interface KpiInvoice {
  id: number; number: string; customerId: number; customerName: string; status: string;
  total: number; balance: number; paidDate: string | null; dueDate: string | null; cash: number;
}
export interface KpiEstimate { id: number; customerName: string; total: number; status: string; reason: string | null }
export interface KpiReport {
  from: string; to: string; timezone: string; asOf: string; budgetJson: string | null;
  jobs: KpiJob[]; invoices: KpiInvoice[]; estimates: KpiEstimate[];
  callbacks: { id: number; jobId: number; title: string; reason: string; crewName: string }[];
  previousCustomers: number[];
  unbilled: { id: number; title: string; customerName: string | null; totalAmount: number; reason: string; needsAttention: boolean; canInvoice: boolean }[];
  clock: { paidMinutes: number; jobMinutes: number; other: { type: string; minutes: number }[]; openEntries: number };
  receipts: { deposits: number; prepayments: number };
}
export const loadKpiSettings = (): Promise<KpiSettings> => getKpiDashboardSettings();
export const saveKpiSettings = (settings: KpiSettings): Promise<KpiSettings> => updateKpiDashboardSettings(settings);
export const loadKpiReport = (from: string, to: string): Promise<KpiReport> => getKpiDashboardReport({from,to});

export interface KpiDetailRow { label: string; value: string; note?: string; href?: string }
export interface KpiMetric {
  id: KpiId; name: string; value: number | null; format: 'money' | 'percent' | 'number';
  summary: string; formula: string; warning?: string; rows: KpiDetailRow[];
}
