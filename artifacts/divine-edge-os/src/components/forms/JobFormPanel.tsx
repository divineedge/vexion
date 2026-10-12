import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ClipboardCheck, ChevronDown, ChevronRight, Plus, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useJobForms, useFormTemplates, useAttachJobForm, useSaveJobForm, useSetJobFormRequirement, validateAnswers, apiErrorMessage,
  type JobForm, type AnswerValue, type FormField,
} from '@/lib/jobForms';

/** Names of required forms not yet submitted, or [] while unknown. */
export function useMissingRequiredForms(jobId: number | null | undefined): string[] {
  const { data } = useJobForms(jobId);
  if (!data) return [];
  return data.forms.filter(f => data.missingRequired.includes(f.id)).map(f => f.name);
}

function FieldInput({ field, value, onChange, disabled, error }: { field: FormField; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void; disabled: boolean; error?: string }) {
  const id = `jf-${field.id}`;
  let control: React.ReactNode;
  switch (field.type) {
    case 'textarea': control = <Textarea id={id} rows={3} disabled={disabled} value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />; break;
    case 'number': control = <Input id={id} type="number" inputMode="decimal" disabled={disabled} value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />; break;
    case 'date': control = <Input id={id} type="date" disabled={disabled} value={(value as string) ?? ''} onChange={e => onChange(e.target.value || null)} />; break;
    case 'yes_no': control = (
      <div className="flex gap-2">
        {[true, false].map(b => <Button key={String(b)} type="button" size="sm" variant={value === b ? 'default' : 'outline'} disabled={disabled} onClick={() => onChange(value === b ? null : b)}>{b ? 'Yes' : 'No'}</Button>)}
      </div>
    ); break;
    case 'select': control = (
      <Select value={(value as string) ?? ''} disabled={disabled} onValueChange={v => onChange(v)}>
        <SelectTrigger id={id}><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>{(field.options ?? []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    ); break;
    case 'multi_select': {
      const arr = Array.isArray(value) ? value : [];
      control = <div className="space-y-1.5">{(field.options ?? []).map(o => (
        <label key={o} className="flex items-center gap-2 text-sm"><Checkbox disabled={disabled} checked={arr.includes(o)} onCheckedChange={c => onChange(c ? [...arr, o] : arr.filter(x => x !== o))} />{o}</label>
      ))}</div>;
      break;
    }
    default: control = <Input id={id} disabled={disabled} value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} />;
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{field.label}{field.required && <span className="text-destructive"> *</span>}</label>
      {control}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function FormEditor({ jobId, form, frozen }: { jobId: number; form: JobForm; frozen: boolean }) {
  const save = useSaveJobForm(jobId);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(form.answers ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const initFor = useRef(form.id);
  // Re-sync from server only when not editing locally.
  useEffect(() => { if (!dirty || initFor.current !== form.id) { initFor.current = form.id; setAnswers(form.answers ?? {}); } }, [form.answers, form.id, dirty]);

  const run = (submit: boolean) => {
    const errs = validateAnswers(form.fields, answers, submit);
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error(submit ? 'Fill in the required answers before submitting' : 'Fix the highlighted answers'); return; }
    save.mutate({ formId: form.id, answers, submit }, {
      onSuccess: () => { setDirty(false); toast.success(submit ? `${form.name} submitted` : 'Draft saved'); },
      onError: e => toast.error(apiErrorMessage(e, 'Could not save form')),
    });
  };

  return (
    <div className="space-y-4 pt-3">
      {form.description && <p className="text-xs text-muted-foreground">{form.description}</p>}
      {form.fields.map(f => (
        <FieldInput key={f.id} field={f} value={answers[f.id]} disabled={frozen || save.isPending} error={errors[f.id]}
          onChange={v => { setDirty(true); setAnswers(a => ({ ...a, [f.id]: v })); }} />
      ))}
      {frozen ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Locked — the job is complete and this form was submitted.</p>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="outline" disabled={save.isPending || !dirty} onClick={() => run(false)} data-testid={`button-form-draft-${form.id}`}>Save draft</Button>
          <Button size="sm" disabled={save.isPending} onClick={() => run(true)} data-testid={`button-form-submit-${form.id}`}>{form.submittedAt ? 'Resubmit' : 'Submit'}</Button>
          {dirty && <span className="text-xs text-amber-700">Unsaved answers</span>}
          {form.submittedAt && <span className="text-xs text-muted-foreground">Edits after submission are recorded in the job history.</span>}
        </div>
      )}
    </div>
  );
}

export function JobFormPanel({ jobId, jobStatus }: { jobId: number; jobStatus?: string | null }) {
  const { data, isLoading, isError, refetch } = useJobForms(jobId);
  const canManage = !!data?.canManage;
  const { data: tpl } = useFormTemplates();
  const attach = useAttachJobForm(jobId);
  const setReq = useSetJobFormRequirement(jobId);
  const [openId, setOpenId] = useState<number | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachTpl, setAttachTpl] = useState('');
  const [attachRequired, setAttachRequired] = useState(false);
  const [reqTarget, setReqTarget] = useState<JobForm | null>(null);
  const [reason, setReason] = useState('');
  const completed = jobStatus === 'completed';

  if (isLoading) return <Skeleton className="h-16" />;
  if (isError || !data) return (
    <div className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground flex items-center justify-between">
      <span>Could not load job forms.</span><Button size="sm" variant="outline" className="h-7" onClick={() => refetch()}>Retry</Button>
    </div>
  );
  const missing = data.forms.filter(f => data.missingRequired.includes(f.id));
  const attachedIds = new Set(data.forms.map(f => f.templateId));
  const available = (tpl?.templates ?? []).filter(t => t.active && !attachedIds.has(t.id));

  return (
    <div className="space-y-2" data-testid="job-form-panel">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5"><ClipboardCheck className="w-3.5 h-3.5" /> Forms</p>
        {canManage && !completed && <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => { setAttachTpl(''); setAttachRequired(false); setAttachOpen(true); }} data-testid="button-attach-form"><Plus className="w-3.5 h-3.5" /> Add form</Button>}
      </div>
      {missing.length > 0 && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 flex gap-1.5" role="alert">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Submit before completing: {missing.map(m => m.name).join(', ')}
        </div>
      )}
      {data.forms.length === 0 && <p className="text-sm text-muted-foreground">No forms on this job.</p>}
      {data.forms.map(f => {
        const isOpen = openId === f.id;
        const frozen = completed && !!f.submittedAt;
        return (
          <div key={f.id} className="rounded-lg border px-3 py-2" data-testid={`job-form-${f.id}`}>
            <button type="button" className="w-full flex items-center gap-2 text-left" onClick={() => setOpenId(isOpen ? null : f.id)}>
              {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
              <span className="flex-1 min-w-0 text-sm font-medium truncate">{f.name}</span>
              {f.required && <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">Required</Badge>}
              {f.submittedAt
                ? <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 gap-1"><CheckCircle2 className="w-3 h-3" />Submitted</Badge>
                : <Badge variant="outline" className="text-[10px]">{Object.keys(f.answers ?? {}).length ? 'Draft' : 'Not started'}</Badge>}
            </button>
            {f.submittedAt && <p className="text-[11px] text-muted-foreground pl-6 mt-0.5">Submitted {format(new Date(f.submittedAt), 'MMM d, h:mm a')}{f.submittedBy ? ` by ${f.submittedBy}` : ''}</p>}
            {isOpen && <>
              {canManage && !completed && (
                <label className="flex items-center gap-2 text-xs pt-2 pl-6">
                  <Checkbox checked={f.required} onCheckedChange={() => { setReason(''); setReqTarget(f); }} data-testid={`checkbox-form-required-${f.id}`} /> Required to complete this job
                </label>
              )}
              <div className="pl-6"><FormEditor jobId={jobId} form={f} frozen={frozen} /></div>
            </>}
          </div>
        );
      })}

      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a form to this job</DialogTitle><DialogDescription>The form's current questions are copied onto the job.</DialogDescription></DialogHeader>
          {available.length === 0 ? <p className="text-sm text-muted-foreground">No other active form templates. Create one on the Forms page.</p> : (
            <div className="space-y-3">
              <Select value={attachTpl} onValueChange={v => { setAttachTpl(v); setAttachRequired(!!available.find(t => String(t.id) === v)?.required); }}>
                <SelectTrigger><SelectValue placeholder="Choose a form template" /></SelectTrigger>
                <SelectContent>{available.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={attachRequired} onCheckedChange={c => setAttachRequired(!!c)} /> Required before this job can be completed</label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachOpen(false)}>Cancel</Button>
            <Button disabled={!attachTpl || attach.isPending} onClick={() => attach.mutate({ templateId: Number(attachTpl), required: attachRequired }, {
              onSuccess: () => { toast.success('Form added'); setAttachOpen(false); },
              onError: e => toast.error(apiErrorMessage(e, 'Could not add form')),
            })}>{attach.isPending ? 'Adding…' : 'Add form'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reqTarget} onOpenChange={o => { if (!o) setReqTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reqTarget?.required ? 'Make form optional?' : 'Require this form?'}</DialogTitle>
            <DialogDescription>{reqTarget?.required ? `The job could be completed without submitting ${reqTarget?.name}.` : `The job can't be completed until ${reqTarget?.name} is submitted.`} This change is recorded with your reason.</DialogDescription>
          </DialogHeader>
          <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqTarget(null)}>Cancel</Button>
            <Button disabled={!reason.trim() || setReq.isPending} onClick={() => reqTarget && setReq.mutate({ formId: reqTarget.id, required: !reqTarget.required, reason: reason.trim() }, {
              onSuccess: () => { toast.success('Requirement updated'); setReqTarget(null); },
              onError: e => toast.error(apiErrorMessage(e, 'Could not update requirement')),
            })}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default JobFormPanel;
