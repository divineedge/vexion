import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export type RewardType = 'fixed' | 'percent';
export interface AcquisitionSettings {
  doorHangersEnabled: boolean;
  employeeRewardsEnabled: boolean;
  employeeRewardType: RewardType;
  employeeRewardValue: number;
  customerReferralsEnabled: boolean;
  referralRewardType: RewardType;
  referralRewardValue: number;
  trigger: 'first_paid_invoice';
  quoteWidgetEnabled: boolean;
}
export interface DoorHangerVisit {
  id: number; address: string; lat: number | null; lng: number | null;
  jobId: number | null; employeeId: number | null; employeeName: string | null;
  completedAt: string | null; convertedCustomerId: number | null;
  shareUrl?: string | null;
}
export interface DoorHangerJob { id: number; title: string; customerName: string | null; propertyAddress: string | null; propertyId: number | null }
export interface DoorHangersResponse { visits: DoorHangerVisit[]; employees: { id: number; name: string }[]; jobs: DoorHangerJob[] }
export interface AcquisitionReward {
  id: number; kind: 'employee_bonus' | 'referral_credit'; customerId: number | null;
  recipientUserId: number | null; recipientCustomerId: number | null; invoiceId: number | null;
  amount: number; earnedAt: string;
}
export const EMPLOYEE_ACQUISITION_SOURCE = 'employee_acquisition';
export const DOOR_HANGER_SOURCE = 'door_hanger';
export const sourceLabel = (s: string) =>
  s === EMPLOYEE_ACQUISITION_SOURCE ? 'Employee acquisition' : s === DOOR_HANGER_SOURCE ? 'Door hanger' : s;

const json = { 'Content-Type': 'application/json' };
export const acqKeys = {
  settings: ['acquisition-settings'] as const,
  doorHangers: (jobId?: number | null) => ['door-hangers', jobId ?? 'all'] as const,
  rewards: ['acquisition-rewards'] as const,
};

export function useAcquisitionSettings(enabled = true) {
  return useQuery({ queryKey: acqKeys.settings, enabled, queryFn: () => customFetch<{ settings: AcquisitionSettings }>('/api/marketing/acquisition/settings').then(r => r.settings) });
}
export function useUpdateAcquisitionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<AcquisitionSettings>) => customFetch<{ settings: AcquisitionSettings }>('/api/marketing/acquisition/settings', { method: 'PATCH', headers: json, body: JSON.stringify(data) }),
    onSuccess: (r) => { if (r?.settings) qc.setQueryData(acqKeys.settings, r.settings); else qc.invalidateQueries({ queryKey: acqKeys.settings }); },
  });
}
export function useDoorHangers(jobId?: number | null, enabled = true) {
  return useQuery({ queryKey: acqKeys.doorHangers(jobId), enabled, queryFn: () => customFetch<DoorHangersResponse>(`/api/marketing/door-hangers${jobId ? `?jobId=${jobId}` : ''}`) });
}
export function useCreateDoorHanger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { address: string; lat?: number; lng?: number; jobId?: number; employeeId?: number; completedAt?: string }) =>
      customFetch('/api/marketing/door-hangers', { method: 'POST', headers: json, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['door-hangers'] }),
  });
}
export function useAcquisitionRewards(enabled = true) {
  return useQuery({ queryKey: acqKeys.rewards, enabled, queryFn: () => customFetch<{ rewards: AcquisitionReward[] }>('/api/marketing/acquisition/rewards').then(r => r.rewards ?? []) });
}
export const money = (n: number) => `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
