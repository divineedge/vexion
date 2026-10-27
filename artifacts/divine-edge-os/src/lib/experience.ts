import { useQueryClient } from '@tanstack/react-query';
import {
  customFetch,
  getGetExperienceAdminQueryKey,
  getGetExperienceHubQueryKey,
  useGetExperienceAdmin,
  useGetExperienceHub,
  usePerformExperienceAction,
  type PerformExperienceActionBodyAction,
} from '@workspace/api-client-react';

export type ThreadKind = 'problem' | 'feature' | 'help';
export type ThreadStatus = 'received' | 'planned' | 'in_progress' | 'released' | 'resolved';
export type ThreadPriority = 'low' | 'normal' | 'high';

export interface SupportThread {
  id: string; tenantId: number; userId: number; kind: ThreadKind; title: string;
  status: ThreadStatus; priority: ThreadPriority; assigneeId: number | null; duplicateOf: string | null;
  createdAt: string; updatedAt: string; diagnostics?: unknown;
}
export interface SupportMessage { id: string; threadId: string; userId: number; body: string; internal: boolean; attachments: string[]; createdAt: string }
export interface HelpContent { id: string; kind: 'help' | 'release'; title: string; body: string; published: boolean; updatedAt: string }
export interface OnboardingCheck { key: string; label: string; complete: boolean; href: string }
export interface Onboarding { completedSteps: string[]; checks: OnboardingCheck[] }
export interface OpsAlert { id: string; tenantId: number | null; source: string; severity: string; message: string; resolved: boolean; updatedAt: string }
export interface ExperienceHub {
  threads: SupportThread[]; messages: SupportMessage[]; content: HelpContent[];
  onboarding: Onboarding; alerts: OpsAlert[]; isManager: boolean; isSoftwareOwner: boolean;
}
export interface BusinessPolicy { subscriptionRequired: boolean; trialUntil: string | null; graceDays: number; enforceLimits: boolean }
export interface AdminBusiness {
  id: number; name: string; policy: BusinessPolicy; subscriptionStatus: string | null; planId: number | string | null;
  maxUsers: number | null; maxProperties: number | null; userCount: number; propertyCount: number;
}
export interface RecoveryDrill { id: string; environment: string; evidence: string; passed: boolean; createdAt: string }
export interface ExperienceAdmin extends ExperienceHub {
  businesses: AdminBusiness[]; staffUsers: { id: number; name: string }[]; recoveryDrills: RecoveryDrill[];
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Hydrate the generic ExperienceData object defensively. */
export function toHub(raw: unknown): ExperienceHub {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ob = (r.onboarding && typeof r.onboarding === 'object' ? r.onboarding : {}) as Record<string, unknown>;
  return {
    threads: arr<SupportThread>(r.threads),
    messages: arr<SupportMessage>(r.messages).map(m => ({ ...m, attachments: arr<string>(m.attachments) })),
    content: arr<HelpContent>(r.content),
    onboarding: { completedSteps: arr<string>(ob.completedSteps), checks: arr<OnboardingCheck>(ob.checks) },
    alerts: arr<OpsAlert>(r.alerts),
    isManager: r.isManager === true,
    isSoftwareOwner: r.isSoftwareOwner === true,
  };
}
export function toAdmin(raw: unknown): ExperienceAdmin {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { ...toHub(raw), businesses: arr(r.businesses), staffUsers: arr(r.staffUsers), recoveryDrills: arr(r.recoveryDrills) };
}

export const FRESH_MS = 30_000;

export function useExperienceHub(enabled = true) {
  const q = useGetExperienceHub({ query: { enabled, queryKey: getGetExperienceHubQueryKey(), refetchInterval: FRESH_MS, staleTime: FRESH_MS } });
  return { ...q, hub: q.data ? toHub(q.data) : null };
}
export function useExperienceAdmin(enabled: boolean) {
  const q = useGetExperienceAdmin({ query: { enabled, queryKey: getGetExperienceAdminQueryKey(), refetchInterval: FRESH_MS, staleTime: FRESH_MS } });
  return { ...q, admin: q.data ? toAdmin(q.data) : null };
}

/** Action mutation that refreshes both hub and admin views. */
export function useExperienceAction() {
  const qc = useQueryClient();
  const m = usePerformExperienceAction({
    mutation: {
      onSettled: () => {
        void qc.invalidateQueries({ queryKey: getGetExperienceHubQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetExperienceAdminQueryKey() });
      },
    },
  });
  const run = (action: PerformExperienceActionBodyAction, payload: Record<string, unknown>) =>
    m.mutateAsync({ data: { action, payload } });
  return { run, isPending: m.isPending };
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.') {
  const data = (err as { data?: { error?: unknown; message?: unknown } })?.data;
  if (data && typeof data.error === 'string') return data.error;
  if (data && typeof data.message === 'string') return data.message;
  return fallback;
}

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export function validateImage(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return `${file.name}: use PNG, JPEG, or WebP.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: larger than 5 MiB.`;
  return null;
}

export async function uploadImage(url: string, file: File): Promise<{ id: string; name: string }> {
  const fd = new FormData();
  fd.append('file', file);
  return customFetch<{ id: string; name: string }>(url, { method: 'POST', body: fd, responseType: 'json' });
}
export async function fetchBlob(url: string): Promise<Blob> {
  return customFetch<Blob>(url, { method: 'GET', responseType: 'blob' });
}
export async function downloadBlob(url: string, filename: string) {
  const blob = await fetchBlob(url);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.download = filename; a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  received: 'Received', planned: 'Planned', in_progress: 'In progress', released: 'Released', resolved: 'Resolved',
};
export const KIND_LABEL: Record<ThreadKind, string> = { problem: 'Problem', feature: 'Idea', help: 'Question' };
export const STATUS_TONE: Record<ThreadStatus, string> = {
  received: 'bg-sky-50 text-sky-800 border-sky-200',
  planned: 'bg-violet-50 text-violet-800 border-violet-200',
  in_progress: 'bg-amber-50 text-amber-800 border-amber-200',
  released: 'bg-teal-50 text-teal-800 border-teal-200',
  resolved: 'bg-stone-100 text-stone-700 border-stone-200',
};
