import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { FormEvidenceInput, type EvidenceAnswer } from './FormEvidenceInput';

type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'multi_select' | 'yes_no' | 'date' | 'photo' | 'signature';
type Answer = string | number | boolean | string[] | EvidenceAnswer | null;
interface FormField { id: string; label: string; type: FieldType; required: boolean; options?: string[] }
interface JobForm { id: number; templateId: number; name: string; description: string | null; fields: FormField[]; required: boolean; answers: Record<string, Answer>; submittedAt: string | null; submittedBy: string | null; submittedById?: number | null; updatedAt: string | null }
interface JobFormsResponse { forms: JobForm[]; missingRequired: number[]; canManage: boolean }
type Colors = ReturnType<typeof useColors>;

export const jobFormsKey = (jobId: number) => ['/api/jobs', jobId, 'forms'] as const;
export function useJobForms(jobId: number, enabled = true) {
  return useQuery({ queryKey: jobFormsKey(jobId), enabled: enabled && Number.isInteger(jobId), queryFn: () => customFetch<JobFormsResponse>(`/api/jobs/${jobId}/forms`) });
}
/** Required-form status. known=false when offline, loading or the request failed — never treated as "none missing". */
export function useMissingRequiredForms(jobId: number, enabled = true): { known: boolean; missing: string[] } {
  const { data } = useJobForms(jobId, enabled);
  if (!enabled || !data) return { known: false, missing: [] };
  return { known: true, missing: data.forms.filter(f => data.missingRequired.includes(f.id)).map(f => f.name) };
}

function validate(fields: FormField[], a: Record<string, Answer>, submit: boolean) {
  const errs: Record<string, string> = {};
  for (const f of fields) {
    const v = a[f.id];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) { if (submit && f.required) errs[f.id] = 'Required'; continue; }
    if (f.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) errs[f.id] = 'Enter a number';
    if (f.type === 'date' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))) errs[f.id] = 'Use YYYY-MM-DD';
  }
  return errs;
}

function Chip({ label, on, onPress, disabled, colors }: { label: string; on: boolean; onPress: () => void; disabled: boolean; colors: Colors }) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[s.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '18' : 'transparent' }]}>
      <Text style={{ color: on ? colors.primary : colors.foreground, fontWeight: on ? '700' : '500' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function FieldControl({ f, v, set, disabled, colors, formId, onUploading }: { f: FormField; v: Answer | undefined; set: (v: Answer) => void; disabled: boolean; colors: Colors; formId: number; onUploading:(delta:number)=>void }) {
  const input = [s.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }];
  const [numText, setNumText] = useState(v == null ? '' : String(v));
  switch (f.type) {
    case 'photo': case 'signature': return <FormEvidenceInput formId={formId} fieldId={f.id} kind={f.type} value={v as EvidenceAnswer | undefined} set={set} disabled={disabled} onUploading={onUploading}/>;
    case 'textarea': return <TextInput editable={!disabled} multiline style={[...input, { minHeight: 80, textAlignVertical: 'top' }]} value={(v as string) ?? ''} onChangeText={set} />;
    case 'number': return <TextInput editable={!disabled} keyboardType="decimal-pad" style={input} value={numText} onChangeText={t => { setNumText(t); set(t.trim() === '' ? null : Number(t)); }} />;
    case 'date': return <TextInput editable={!disabled} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} keyboardType="numbers-and-punctuation" style={input} value={(v as string) ?? ''} onChangeText={t => set(t || null)} />;
    case 'yes_no': return <View style={s.row}>{[true, false].map(b => <Chip key={String(b)} label={b ? 'Yes' : 'No'} on={v === b} disabled={disabled} colors={colors} onPress={() => set(v === b ? null : b)} />)}</View>;
    case 'select': return <View style={s.row}>{(f.options ?? []).map(o => <Chip key={o} label={o} on={v === o} disabled={disabled} colors={colors} onPress={() => set(v === o ? null : o)} />)}</View>;
    case 'multi_select': {
      const arr = Array.isArray(v) ? v : [];
      return <View style={s.row}>{(f.options ?? []).map(o => <Chip key={o} label={o} on={arr.includes(o)} disabled={disabled} colors={colors} onPress={() => set(arr.includes(o) ? arr.filter(x => x !== o) : [...arr, o])} />)}</View>;
    }
    default: return <TextInput editable={!disabled} style={input} value={(v as string) ?? ''} onChangeText={set} />;
  }
}

function FormBody({ jobId, form, frozen, colors }: { jobId: number; form: JobForm; frozen: boolean; colors: Colors }) {
  const [uploads, setUploads] = useState(0);
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, Answer>>(form.answers ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const initFor = useRef(form.id);
  useEffect(() => { if (!dirty || initFor.current !== form.id) { initFor.current = form.id; setAnswers(form.answers ?? {}); } }, [form.answers, form.id, dirty]);
  const m = useMutation({
    mutationFn: (submit: boolean) => customFetch(`/api/jobs/${jobId}/forms/${form.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, submit }) }),
    onSuccess: (_d, submit) => { setDirty(false); void qc.invalidateQueries({ queryKey: jobFormsKey(jobId) }); Alert.alert(submit ? 'Form submitted' : 'Draft saved'); },
    onError: (e: any) => Alert.alert('Could not save form', e?.data?.error ?? e?.message ?? 'Please try again.'),
  });
  const run = (submit: boolean) => {
    if(uploads){Alert.alert('Evidence upload in progress','Wait for evidence uploads to finish.');return;}
    const errs = validate(form.fields, answers, submit); setErrors(errs);
    if (Object.keys(errs).length) { Alert.alert(submit ? 'Answer the required questions' : 'Fix the highlighted answers'); return; }
    m.mutate(submit);
  };
  return (
    <View style={{ gap: 14, marginTop: 10 }}>
      {form.description ? <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{form.description}</Text> : null}
      {form.fields.map(f => (
        <View key={f.id} style={{ gap: 6 }}>
          <Text style={{ color: colors.foreground, fontWeight: '600' }}>{f.label}{f.required ? <Text style={{ color: colors.destructive }}> *</Text> : null}</Text>
          <FieldControl onUploading={delta=>setUploads(n=>n+delta)} formId={form.id} f={f} v={answers[f.id]} disabled={frozen || m.isPending} colors={colors} set={v => { setDirty(true); setAnswers(a => ({ ...a, [f.id]: v })); }} />
          {errors[f.id] ? <Text style={{ color: colors.destructive, fontSize: 12 }}>{errors[f.id]}</Text> : null}
        </View>
      ))}
      {frozen ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Locked — job completed and form submitted.</Text> : (
        <View style={s.row}>
          <TouchableOpacity testID={`form-draft-${form.id}`} disabled={m.isPending || !dirty} onPress={() => run(false)} style={[s.btn, { borderWidth: 1, borderColor: colors.border, opacity: dirty ? 1 : 0.5 }]}><Text style={{ color: colors.foreground, fontWeight: '600' }}>Save draft</Text></TouchableOpacity>
          <TouchableOpacity testID={`form-submit-${form.id}`} disabled={m.isPending} onPress={() => run(true)} style={[s.btn, { backgroundColor: colors.primary }]}>
            {m.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>{form.submittedAt ? 'Resubmit' : 'Submit'}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function JobFormsSection({ jobId, jobStatus }: { jobId: number; jobStatus?: string | null }) {
  const colors = useColors();
  const { data, isLoading, isError, refetch } = useJobForms(jobId);
  const [openId, setOpenId] = useState<number | null>(null);
  if (isLoading) return <ActivityIndicator color={colors.primary} />;
  if (isError || !data) return (
    <TouchableOpacity onPress={() => refetch()} style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={{ color: colors.mutedForeground }}>Could not load forms. Tap to retry.</Text></TouchableOpacity>
  );
  if (!data.forms.length) return null;
  const missing = data.forms.filter(f => data.missingRequired.includes(f.id));
  return (
    <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]} testID="job-forms-section">
      <Text style={[s.title, { color: colors.foreground }]}>Forms</Text>
      {missing.length ? <Text style={{ color: colors.destructive, fontSize: 13 }}>Submit before completing: {missing.map(m => m.name).join(', ')}</Text> : null}
      {data.forms.map(f => {
        const open = openId === f.id;
        return (
          <View key={f.id} style={[s.formRow, { borderTopColor: colors.border }]}>
            <TouchableOpacity style={s.formHead} onPress={() => setOpenId(open ? null : f.id)} testID={`job-form-${f.id}`}>
              <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.mutedForeground} />
              <Text style={{ flex: 1, color: colors.foreground, fontWeight: '600' }} numberOfLines={1}>{f.name}</Text>
              {f.required ? <Text style={{ color: colors.destructive, fontSize: 11, fontWeight: '700' }}>REQUIRED</Text> : null}
              <Text style={{ color: f.submittedAt ? colors.statusCompleted : colors.mutedForeground, fontSize: 12, fontWeight: '600' }}>{f.submittedAt ? 'Submitted' : Object.keys(f.answers ?? {}).length ? 'Draft' : 'To do'}</Text>
            </TouchableOpacity>
            {open ? <FormBody jobId={jobId} form={f} frozen={jobStatus === 'completed' && !!f.submittedAt} colors={colors} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  formRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  btn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});
