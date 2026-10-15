import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import type { FormField, AnswerValue } from '@/lib/jobForms';
import { useAuth } from '@/contexts/AuthContext';

export type { FormField, AnswerValue };
export type Stage = 'applied' | 'screening' | 'interview' | 'offer' | 'declined' | 'withdrawn';
export const STAGES: Array<{ value: Stage; label: string }> = [
  { value: 'applied', label: 'Applied' }, { value: 'screening', label: 'Screening' }, { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' }, { value: 'declined', label: 'Declined' }, { value: 'withdrawn', label: 'Withdrawn' },
];
export const stageLabel = (s: string) => STAGES.find(x => x.value === s)?.label ?? s;

export interface HrMeta { hasHrAccess: boolean; isOwner: boolean; ownUserId: number; publicCareersUrl: string | null }
export interface HrMember { id: number; name: string; email: string; role: string; isActive: boolean; hasHrAccess: boolean }
export interface HrSettings { publicHiringEnabled: boolean; applicationIntro: string; privacyNotice: string; applicationFields: FormField[] }
export interface Posting { id: number; title: string; description: string; status: 'open' | 'closed'; fields: FormField[]; createdAt: string }
export interface ApplicationRow {
  id: number; fullName: string; email: string; phone: string; postingTitle: string | null;
  stage: Stage; source: string; createdAt: string; userId: number | null;
}
export interface ApplicationFull extends ApplicationRow {
  postingId?: number | null; answers: Record<string, AnswerValue>; fieldSnapshot: FormField[];
  consentAt: string | null; consentSnapshot: unknown; notes: string | null;
  /** True when hired into a pending account that still needs owner password setup/activation. */
  pendingAccountSetup?: boolean;
}
export interface HrDocument { id: number; title: string; fileName: string; sizeBytes: number; mimeType: string }
export interface AuditEntry { id: number; action: string; actorName: string | null; createdAt: string; before: unknown; after: unknown }
export interface ApplicationDetail { application: ApplicationFull; documents: HrDocument[]; audit: AuditEntry[] }

export const hrErr = (e: unknown, fallback: string) => {
  const d = (e as { data?: { error?: string; message?: string } })?.data;
  return d?.error || d?.message || fallback;
};
const json = { 'Content-Type': 'application/json' };
/**
 * Every private HR query key is scoped by [tenant id, authenticated user id] so cached
 * owner/HR data is never reused after a different login or role switch in this browser.
 */
type Scope = readonly [number | null, number | null];
export function useHrScope(): Scope {
  const { user } = useAuth();
  const u = user as { id?: number; tenantId?: number; role?: string } | null;
  return [u?.tenantId ?? null, u?.id ?? null] as const;
}
export const hrKeys = {
  root: (sc: Scope) => ['hr', sc[0], sc[1]] as const,
  meta: (sc: Scope) => ['hr', sc[0], sc[1], '/api/hr/meta'] as const,
  access: (sc: Scope) => ['hr', sc[0], sc[1], '/api/hr/access'] as const,
  settings: (sc: Scope) => ['hr', sc[0], sc[1], '/api/hr/settings'] as const,
  postings: (sc: Scope) => ['hr', sc[0], sc[1], '/api/hr/postings'] as const,
  appsRoot: (sc: Scope) => ['hr', sc[0], sc[1], '/api/hr/applications'] as const,
  apps: (sc: Scope, stage: string, postingId: string) => ['hr', sc[0], sc[1], '/api/hr/applications', 'list', stage, postingId] as const,
  app: (sc: Scope, id: number) => ['hr', sc[0], sc[1], '/api/hr/applications', 'detail', id] as const,
};


export const useHrMeta = () => { const sc = useHrScope(); return useQuery({ queryKey: hrKeys.meta(sc), enabled: sc[0] != null, queryFn: () => customFetch<HrMeta>('/api/hr/meta') }); };
export const useHrAccess = (enabled = true) => {
  const sc = useHrScope();
  return useQuery({ queryKey: hrKeys.access(sc), enabled: enabled && sc[0] != null, queryFn: () => customFetch<{ members: HrMember[] }>('/api/hr/access') });
};
export function useSetHrAccess() {
  const qc = useQueryClient();
  const sc = useHrScope();
  return useMutation({
    mutationFn: ({ userId, enabled }: { userId: number; enabled: boolean }) =>
      customFetch(`/api/hr/access/${userId}`, { method: 'PUT', headers: json, body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.access(sc) }),
  });
}
export const useHrSettings = (enabled = true) => {
  const sc = useHrScope();
  return useQuery({ queryKey: hrKeys.settings(sc), enabled: enabled && sc[0] != null, queryFn: () => customFetch<HrSettings>('/api/hr/settings') });
};
export function useSaveHrSettings() {
  const qc = useQueryClient();
  const sc = useHrScope();
  return useMutation({
    mutationFn: (data: Partial<HrSettings>) => customFetch<HrSettings>('/api/hr/settings', { method: 'PATCH', headers: json, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.settings(sc) }),
  });
}
export const usePostings = (enabled = true) => {
  const sc = useHrScope();
  return useQuery({ queryKey: hrKeys.postings(sc), enabled: enabled && sc[0] != null, queryFn: () => customFetch<{ postings: Posting[] }>('/api/hr/postings') });
};
export function useSavePosting() {
  const qc = useQueryClient();
  const sc = useHrScope();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Partial<Omit<Posting, 'id' | 'createdAt'>> }) =>
      customFetch(id ? `/api/hr/postings/${id}` : '/api/hr/postings', { method: id ? 'PATCH' : 'POST', headers: json, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.postings(sc) }),
  });
}
export const useApplications = (stage: string, postingId: string, enabled = true) => {
  const sc = useHrScope();
  return useQuery({
  queryKey: hrKeys.apps(sc, stage, postingId), enabled: enabled && sc[0] != null,
  queryFn: () => {
    const q = new URLSearchParams();
    if (stage) q.set('stage', stage);
    if (postingId) q.set('postingId', postingId);
    return customFetch<{ applications: ApplicationRow[] }>(`/api/hr/applications${q.toString() ? `?${q}` : ''}`);
  },
  });
};
export const useApplication = (id: number | null) => {
  const sc = useHrScope();
  return useQuery({
    queryKey: hrKeys.app(sc, id ?? 0), enabled: id != null && sc[0] != null,
    queryFn: () => customFetch<ApplicationDetail>(`/api/hr/applications/${id}`),
  });
};
export function useCreateApplication() {
  const qc = useQueryClient();
  const sc = useHrScope();
  return useMutation({
    mutationFn: (data: { fullName: string; email: string; phone: string; postingId?: number; answers: Record<string, AnswerValue>; notes: string; source: 'staff' }) =>
      customFetch<{ id?: number }>('/api/hr/applications', { method: 'POST', headers: json, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.appsRoot(sc) }),
  });
}
export function useUpdateApplication() {
  const qc = useQueryClient();
  const sc = useHrScope();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { stage?: Stage; notes?: string } }) =>
      customFetch(`/api/hr/applications/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.appsRoot(sc) }),
  });
}
export function useHireApplicant() {
  const qc = useQueryClient();
  const sc = useHrScope();
  return useMutation({
    mutationFn: ({ id, existingUserId }: { id: number; existingUserId?: number }) =>
      customFetch<{ userId: number; needsAccountSetup: boolean }>(`/api/hr/applications/${id}/hire`, {
        method: 'POST', headers: json, body: JSON.stringify(existingUserId ? { existingUserId } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.appsRoot(sc) }),
  });
}
export function useUploadHrDocument() {
  const qc = useQueryClient();
  const sc = useHrScope();
  return useMutation({
    mutationFn: ({ id, file, title }: { id: number; file: File; title: string }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title);
      return customFetch(`/api/hr/applications/${id}/documents`, { method: 'POST', body: fd });
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: hrKeys.app(sc, v.id) }),
  });
}
export async function downloadHrDocument(doc: HrDocument) {
  const blob = await customFetch<Blob>(`/api/hr/documents/${doc.id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = doc.fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ACCEPTED_DOCS = '.pdf,.png,.jpg,.jpeg,.webp,.docx,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export function validateDoc(f: File): string | null {
  if (f.size > MAX_DOC_BYTES) return 'File must be 10 MB or smaller.';
  const ok = DOC_MIME.has(f.type) || (f.type === '' && /\.(pdf|png|jpe?g|webp|docx)$/i.test(f.name));
  return ok ? null : 'Only PDF, JPEG, PNG, WebP, or Word (.docx) files are accepted.';
}
export const fmtBytes = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Returns names of required fields that are empty. */
export function missingRequired(fields: FormField[], answers: Record<string, AnswerValue>): string[] {
  return fields.filter(f => {
    if (!f.required) return false;
    const v = answers[f.id];
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'string') return v.trim() === '';
    return false;
  }).map(f => f.label);
}
