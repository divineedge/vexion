import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

export type FormFieldType = 'text' | 'textarea' | 'number' | 'select' | 'multi_select' | 'yes_no' | 'date';
export const FORM_FIELD_TYPES: Array<{ value: FormFieldType; label: string }> = [
  { value: 'text', label: 'Short text' }, { value: 'textarea', label: 'Long text' }, { value: 'number', label: 'Number' },
  { value: 'select', label: 'Single choice' }, { value: 'multi_select', label: 'Multiple choice' }, { value: 'yes_no', label: 'Yes / No' }, { value: 'date', label: 'Date' },
];
export interface FormField { id: string; label: string; type: FormFieldType; required: boolean; options?: string[] }
export type FormAssignment = 'manual' | 'all_jobs' | 'services';
export interface FormTemplate {
  id: number; name: string; description: string | null; fields: FormField[];
  assignment: FormAssignment; serviceIds: number[]; required: boolean; active: boolean;
}
export type FormTemplateInput = Omit<FormTemplate, 'id'>;
export type AnswerValue = string | number | boolean | string[] | null;
export interface JobForm {
  id: number; templateId: number; name: string; description: string | null; fields: FormField[]; required: boolean;
  answers: Record<string, AnswerValue>; submittedAt: string | null; submittedBy: string | null; submittedById?: number | null; updatedAt: string | null;
}
export interface JobFormsResponse { forms: JobForm[]; missingRequired: number[]; canManage: boolean }

const json = { 'Content-Type': 'application/json' };
export const formKeys = {
  templates: ['/api/form-templates'] as const,
  job: (jobId: number) => ['/api/jobs', jobId, 'forms'] as const,
};
export const apiErrorMessage = (e: unknown, fallback: string) => {
  const d = (e as { data?: { error?: string; message?: string; missing?: string[] } })?.data;
  const base = d?.error || d?.message || (e instanceof Error && e.message) || fallback;
  return d?.missing?.length ? `${base}: ${d.missing.join(', ')}` : base;
};

export function useFormTemplates() {
  return useQuery({ queryKey: formKeys.templates, queryFn: () => customFetch<{ templates: FormTemplate[]; canManage: boolean }>('/api/form-templates') });
}
export function useSaveFormTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Partial<FormTemplateInput> }) =>
      customFetch<FormTemplate>(id ? `/api/form-templates/${id}` : '/api/form-templates', { method: id ? 'PATCH' : 'POST', headers: json, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: formKeys.templates }),
  });
}
export function useJobForms(jobId: number | null | undefined) {
  return useQuery({ queryKey: formKeys.job(jobId ?? 0), enabled: !!jobId, queryFn: () => customFetch<JobFormsResponse>(`/api/jobs/${jobId}/forms`) });
}
export function useAttachJobForm(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { templateId: number; required?: boolean }) => customFetch<JobForm>(`/api/jobs/${jobId}/forms`, { method: 'POST', headers: json, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: formKeys.job(jobId) }),
  });
}
export function useSaveJobForm(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formId, answers, submit }: { formId: number; answers: Record<string, AnswerValue>; submit: boolean }) =>
      customFetch<JobForm>(`/api/jobs/${jobId}/forms/${formId}`, { method: 'PUT', headers: json, body: JSON.stringify({ answers, submit }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: formKeys.job(jobId) }),
  });
}
export function useSetJobFormRequirement(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formId, required, reason }: { formId: number; required: boolean; reason: string }) =>
      customFetch<JobForm>(`/api/jobs/${jobId}/forms/${formId}/requirement`, { method: 'PATCH', headers: json, body: JSON.stringify({ required, reason }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: formKeys.job(jobId) }),
  });
}

/** Client-side mirror of server validation. Returns fieldId -> message. */
export function validateAnswers(fields: FormField[], answers: Record<string, AnswerValue>, forSubmit: boolean): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of fields) {
    const v = answers[f.id];
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) { if (forSubmit && f.required) errs[f.id] = 'Required'; continue; }
    switch (f.type) {
      case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) errs[f.id] = 'Enter a number'; break;
      case 'yes_no': if (typeof v !== 'boolean') errs[f.id] = 'Choose yes or no'; break;
      case 'date': if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs[f.id] = 'Enter a date'; break;
      case 'select': if (typeof v !== 'string' || !(f.options ?? []).includes(v)) errs[f.id] = 'Choose an option'; break;
      case 'multi_select': if (!Array.isArray(v) || v.some(x => !(f.options ?? []).includes(x))) errs[f.id] = 'Choose valid options'; break;
      default: if (typeof v !== 'string') errs[f.id] = 'Invalid value';
    }
  }
  return errs;
}
export const newFieldId = () => `f_${Math.random().toString(36).slice(2, 10)}`;
