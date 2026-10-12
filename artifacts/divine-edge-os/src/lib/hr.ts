import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';

export interface HrMeta { hasHrAccess: boolean; isOwner: boolean; ownUserId: number; publicCareersUrl: string | null }
export type EmploymentStatus = 'active' | 'on_leave' | 'former' | 'onboarding';
export const EMPLOYMENT_STATUSES: Array<{ value: EmploymentStatus; label: string }> = [
  { value: 'active', label: 'Active' }, { value: 'onboarding', label: 'Onboarding' },
  { value: 'on_leave', label: 'On leave' }, { value: 'former', label: 'Former' },
];
export interface HrEmployeeRow {
  id: number; name: string; email: string | null; role: string; isActive: boolean;
  employmentStatus: EmploymentStatus | null; jobTitle: string | null; hireDate: string | null;
}
export interface HrProfile {
  legalName?: string | null; phone?: string | null; personalEmail?: string | null; address?: string | null;
  jobTitle?: string | null; department?: string | null; hireDate?: string | null; endDate?: string | null;
  employmentStatus?: EmploymentStatus | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null;
  notes?: string | null; updatedAt?: string | null;
}
export type HistoryType = 'review' | 'complaint' | 'callback' | 'custom_form' | 'yellow_card' | 'correction' | 'incident' | 'note';
export const HISTORY_TYPES: Array<{ value: HistoryType; label: string }> = [
  { value: 'note', label: 'Note' }, { value: 'review', label: 'Review' }, { value: 'yellow_card', label: 'Yellow card' },
  { value: 'incident', label: 'Incident' }, { value: 'complaint', label: 'Complaint' }, { value: 'callback', label: 'Callback' },
  { value: 'correction', label: 'Correction' }, { value: 'custom_form', label: 'Form' },
];
export const historyLabel = (t: string) => HISTORY_TYPES.find(x => x.value === t)?.label ?? t;

export type LegacyFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
export const LEGACY_FIELD_TYPES: Array<{ value: LegacyFieldType; label: string }> = [
  { value: 'text', label: 'Short text' }, { value: 'textarea', label: 'Long text' }, { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' }, { value: 'select', label: 'Single choice' }, { value: 'checkbox', label: 'Checkbox' },
];
export interface EmpFormField { id: string; label: string; type: LegacyFieldType; required?: boolean; options?: string[] }
export type EmpAnswer = string | number | boolean | null;

export interface HrHistoryEntry {
  id: number; type: HistoryType; title: string; notes: string | null; occurredOn: string | null; createdAt: string;
  createdByName: string | null; sharedWithEmployee: boolean;
  formSnapshot: { name?: string; fields?: EmpFormField[] } | null; formData: Record<string, EmpAnswer> | null;
  evidence: unknown; acknowledgedAt: string | null;
}
/** Stored, immutable snapshot captured by the server when the record was created. Never refreshed from live data. */
export interface HrEvidenceItem { kind: 'time_entry' | 'sub_timer' | string; id: number; capturedAt: string | null; data: Record<string, unknown> | null }
export function evidenceItems(ev: unknown): HrEvidenceItem[] {
  if (!Array.isArray(ev)) return [];
  return ev.filter((x): x is HrEvidenceItem => !!x && typeof x === 'object' && 'kind' in x)
    .map(x => ({ kind: x.kind, id: Number(x.id), capturedAt: x.capturedAt ?? null, data: x.data && typeof x.data === 'object' ? x.data : null }));
}
const str = (v: unknown) => (typeof v === 'string' && v) ? v : null;
const pt = (lat: unknown, lng: unknown): GpsPoint | null => typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
/** Reads raw/effective times and GPS straight from the stored snapshot (supports raw DB names and DTO aliases). */
export function evidenceSummary(e: HrEvidenceItem) {
  const d = e.data ?? {};
  if (e.kind === 'time_entry') {
    const rawIn = str(d.clockedInAt) ?? str(d.clockInAt), rawOut = str(d.clockedOutAt) ?? str(d.clockOutAt);
    return {
      label: `Clock entry #${e.id}`, rawStart: rawIn, rawEnd: rawOut,
      effStart: str(d.adjustedClockedInAt) ?? str(d.effectiveClockInAt) ?? rawIn,
      effEnd: str(d.adjustedClockedOutAt) ?? str(d.effectiveClockOutAt) ?? rawOut,
      startGps: pt(d.clockInLat, d.clockInLng) ?? (d.clockInLocation as GpsPoint | null) ?? null,
      endGps: pt(d.clockOutLat, d.clockOutLng) ?? (d.clockOutLocation as GpsPoint | null) ?? null,
      jobId: typeof d.jobId === 'number' ? d.jobId : null,
    };
  }
  const s = str(d.startedAt), t = str(d.stoppedAt);
  return {
    label: `${str(d.label) ?? 'Job timer'} #${e.id}`, rawStart: s, rawEnd: t, effStart: s, effEnd: t,
    startGps: pt(d.startLat, d.startLng) ?? (d.startLocation as GpsPoint | null) ?? null,
    endGps: pt(d.endLat, d.endLng) ?? (d.stopLocation as GpsPoint | null) ?? null,
    jobId: typeof d.jobId === 'number' ? d.jobId : null,
  };
}
/** Server stores legacy "checkbox" as "yes_no"; map back for the legacy UI. */
export function normalizeEmpFields(fields: unknown): EmpFormField[] {
  if (!Array.isArray(fields)) return [];
  return fields.map(f => ({ ...f, type: f?.type === 'yes_no' ? 'checkbox' : f?.type }));
}
function normalizeDetail(d: HrEmployeeDetail): HrEmployeeDetail {
  return {
    ...d,
    history: d.history.map(h => h.formSnapshot ? { ...h, formSnapshot: { ...h.formSnapshot, fields: normalizeEmpFields(h.formSnapshot.fields) } } : h),
    assignments: d.assignments.map(a => ({ ...a, snapshot: { ...a.snapshot, fields: normalizeEmpFields(a.snapshot?.fields) } })),
  };
}
export interface HrDocument {
  id: number; title: string; fileName: string; mimeType: string; sizeBytes: number;
  sharedWithEmployee: boolean; historyEntryId: number | null; createdAt: string;
}
export interface HrAssignment {
  id: number; title: string; snapshot: { fields: EmpFormField[]; name: string }; required: boolean;
  dueDate: string | null; answers: Record<string, EmpAnswer> | null; submittedAt: string | null;
}
export interface HrEmployeeDetail {
  employee: { id: number; name: string; email: string | null; role: string; isActive: boolean; hourlyRate?: number | null; needsAccountSetup?: boolean };
  profile?: HrProfile | null;
  history: HrHistoryEntry[]; documents: HrDocument[]; assignments: HrAssignment[]; canManage: boolean;
}
export interface GpsPoint { lat: number; lng: number; accuracy?: number | null }
export interface HrTimeEntry {
  id: number; jobId?: number | null; jobTitle?: string | null;
  clockInAt: string | null; clockOutAt: string | null;
  effectiveClockInAt?: string | null; effectiveClockOutAt?: string | null;
  clockInLocation?: GpsPoint | null; clockOutLocation?: GpsPoint | null; notes?: string | null;
}
export interface HrSubTimer {
  id: number; jobId?: number | null; jobTitle?: string | null; label?: string | null;
  startedAt: string | null; stoppedAt: string | null; startLocation?: GpsPoint | null; stopLocation?: GpsPoint | null;
}
export interface HrCallback { id: number; jobId?: number | null; jobTitle?: string | null; reason?: string | null; status?: string | null; createdAt: string }
export interface HrActivity { timeEntries: HrTimeEntry[]; subTimers: HrSubTimer[]; callbacks: HrCallback[]; nextBefore: string | null }
export interface HrAuditEvent { id: number; action: string; actorName: string | null; createdAt: string; before: unknown; after: unknown }
export interface EmployeeFormTemplate { id: number; name: string; description?: string | null; fields: EmpFormField[]; active?: boolean | string; isActive?: boolean | string }

const json = { 'Content-Type': 'application/json' };
export const hrErr = (e: unknown, fallback: string) => {
  const d = (e as { data?: { error?: string; message?: string } })?.data;
  return d?.error || d?.message || fallback;
};

/** Every private HR query key starts with ['hr', tenantId, userId] so cached data never crosses logins. Invalidate with ['hr']. */
export const HR_PREFIX = ['hr'] as const;
function useHrScope() {
  const { user, isAuthenticated } = useAuth();
  const u = user as unknown as { id?: number; tenantId?: number } | null;
  return { scope: ['hr', u?.tenantId ?? null, u?.id ?? null] as const, ready: isAuthenticated && u?.id != null };
}
export function useHrMeta() {
  const { scope, ready } = useHrScope();
  return useQuery({ queryKey: [...scope, 'meta'], enabled: ready, staleTime: 60_000, queryFn: () => customFetch<HrMeta>('/api/hr/meta') });
}
export function useHrEmployees(enabled = true) {
  const { scope, ready } = useHrScope();
  return useQuery({ queryKey: [...scope, 'employees'], enabled: enabled && ready, queryFn: () => customFetch<{ employees: HrEmployeeRow[]; hasHrAccess: boolean }>('/api/hr/employees') });
}
export function useHrEmployee(id: number) {
  const { scope, ready } = useHrScope();
  return useQuery({ queryKey: [...scope, 'employee', id], enabled: ready && Number.isInteger(id) && id > 0, queryFn: async () => normalizeDetail(await customFetch<HrEmployeeDetail>(`/api/hr/employees/${id}`)) });
}
export function useHrAudit(id: number, enabled: boolean) {
  const { scope, ready } = useHrScope();
  return useQuery({ queryKey: [...scope, 'employee', id, 'audit'], enabled: enabled && ready, queryFn: () => customFetch<{ events: HrAuditEvent[] }>(`/api/hr/employees/${id}/audit`) });
}
export async function fetchActivity(id: number, from: string, to: string, before: string | null) {
  const q = new URLSearchParams({ from, to });
  if (before) q.set('before', before);
  return customFetch<HrActivity>(`/api/hr/employees/${id}/activity?${q.toString()}`);
}
export function useEmployeeFormTemplates(enabled: boolean) {
  const { scope, ready } = useHrScope();
  return useQuery({
    queryKey: [...scope, 'employee-form-templates'], enabled: enabled && ready,
    queryFn: async () => {
      const r = await customFetch<EmployeeFormTemplate[] | { templates: EmployeeFormTemplate[] }>('/api/employee-form-templates');
      return (Array.isArray(r) ? r : r.templates ?? []).map(t => ({ ...t, fields: normalizeEmpFields(t.fields) }));
    },
  });
}
export const templateActive = (t: EmployeeFormTemplate) => { const v = t.active ?? t.isActive ?? true; return v !== false && v !== 'false'; };

function useInvalidateEmployee(_id: number) {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: HR_PREFIX }); };
}
/** Owner-only: set the first password and activate a pending-hire login. Password is never logged or cached. */
export function useAccountSetup(id: number) {
  const inv = useInvalidateEmployee(id);
  return useMutation({
    mutationFn: (password: string) => customFetch(`/api/hr/employees/${id}/account-setup`, { method: 'POST', headers: json, body: JSON.stringify({ password }) }),
    onSuccess: inv,
  });
}
export function useSaveProfile(id: number) {
  const inv = useInvalidateEmployee(id);
  return useMutation({
    mutationFn: (data: HrProfile) => customFetch(`/api/hr/employees/${id}/profile`, { method: 'PATCH', headers: json, body: JSON.stringify(data) }),
    onSuccess: inv,
  });
}
export interface NewHistoryInput {
  type: HistoryType; title: string; notes: string; occurredOn: string; sharedWithEmployee: boolean;
  formTemplateId?: number; formData?: Record<string, EmpAnswer>; timeEntryIds?: number[]; subTimerIds?: number[];
}
export function useAddHistory(id: number) {
  const inv = useInvalidateEmployee(id);
  return useMutation({
    mutationFn: (data: NewHistoryInput) => customFetch<HrHistoryEntry>(`/api/hr/employees/${id}/history`, { method: 'POST', headers: json, body: JSON.stringify(data) }),
    onSuccess: inv,
  });
}
export function useShareHistory(employeeId: number) {
  const inv = useInvalidateEmployee(employeeId);
  return useMutation({
    mutationFn: ({ id, shared }: { id: number; shared: boolean }) => customFetch(`/api/hr/history/${id}/share`, { method: 'POST', headers: json, body: JSON.stringify({ sharedWithEmployee: shared }) }),
    onSuccess: inv,
  });
}
export function useAcknowledgeHistory(employeeId: number) {
  const inv = useInvalidateEmployee(employeeId);
  return useMutation({
    mutationFn: (id: number) => customFetch(`/api/hr/history/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: inv,
  });
}
export function useUploadDocument(employeeId: number) {
  const inv = useInvalidateEmployee(employeeId);
  return useMutation({
    mutationFn: ({ file, title, shared, historyEntryId }: { file: File; title: string; shared: boolean; historyEntryId?: number | null }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title);
      fd.append('sharedWithEmployee', String(shared));
      if (historyEntryId) fd.append('historyEntryId', String(historyEntryId));
      return customFetch(`/api/hr/employees/${employeeId}/documents`, { method: 'POST', body: fd });
    },
    onSuccess: inv,
  });
}
export function useShareDocument(employeeId: number) {
  const inv = useInvalidateEmployee(employeeId);
  return useMutation({
    mutationFn: ({ id, shared }: { id: number; shared: boolean }) => customFetch(`/api/hr/documents/${id}/share`, { method: 'POST', headers: json, body: JSON.stringify({ sharedWithEmployee: shared }) }),
    onSuccess: inv,
  });
}
/** Authenticated blob download (session headers), then a temporary object URL. */
export async function downloadHrDocument(doc: HrDocument) {
  const blob = await customFetch<Blob>(`/api/hr/documents/${doc.id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = doc.fileName || doc.title;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function useAssignForm(employeeId: number) {
  const inv = useInvalidateEmployee(employeeId);
  return useMutation({
    mutationFn: (data: { templateId: number; required: boolean; dueDate: string | null }) => customFetch(`/api/hr/employees/${employeeId}/forms`, { method: 'POST', headers: json, body: JSON.stringify(data) }),
    onSuccess: inv,
  });
}
export function useSaveAssignment(employeeId: number) {
  const inv = useInvalidateEmployee(employeeId);
  return useMutation({
    mutationFn: ({ id, answers, submit }: { id: number; answers: Record<string, EmpAnswer>; submit: boolean }) => customFetch(`/api/hr/form-assignments/${id}`, { method: 'PUT', headers: json, body: JSON.stringify({ answers, submit }) }),
    onSuccess: inv,
  });
}
export function useSaveEmployeeTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Partial<EmployeeFormTemplate> }) => id
      ? customFetch(`/api/employee-form-templates/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify(data) })
      : customFetch('/api/employee-form-templates', { method: 'POST', headers: json, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HR_PREFIX }),
  });
}

export function validateEmpAnswers(fields: EmpFormField[], answers: Record<string, EmpAnswer>): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of fields) {
    const v = answers[f.id];
    const empty = v == null || v === '' || (f.type === 'checkbox' && v !== true && f.required);
    if (empty) { if (f.required) errs[f.id] = 'Required'; continue; }
    if (f.type === 'number' && !Number.isFinite(Number(v))) errs[f.id] = 'Enter a number';
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errs[f.id] = 'Enter a date';
    if (f.type === 'select' && !(f.options ?? []).includes(String(v))) errs[f.id] = 'Choose an option';
  }
  return errs;
}
export const fmtBytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const ALLOWED_UPLOAD = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
export const MAX_UPLOAD = 10 * 1024 * 1024;
