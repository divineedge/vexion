import type { EstimateStatus, InvoiceStatus, JobStatus } from '@/utils/demoSandbox';

export function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function sqft(value: number): string {
  return `${value.toLocaleString('en-US')} sq ft`;
}

export function clock(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}

export const jobStatusLabel: Record<JobStatus, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  en_route: 'En Route',
  scheduled: 'Scheduled',
};

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  paid: 'Paid',
  pending: 'Pending',
  past_due: 'Past due',
};

export const estimateStatusLabel: Record<EstimateStatus, string> = {
  pending_approval: 'Pending approval',
  approved: 'Approved',
};
