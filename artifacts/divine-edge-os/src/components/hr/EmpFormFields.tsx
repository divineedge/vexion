import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EmpAnswer, EmpFormField } from '@/lib/hr';
import { EvidenceInput, type EvidenceTarget } from '@/components/forms/EvidenceInput';

export function displayEmpAnswer(f: EmpFormField, v: EmpAnswer | undefined): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') return `${v.fileName ?? 'Image evidence'} (evidence #${v.evidenceId})`;
  if (f.type === 'checkbox') return v === true ? 'Yes' : 'No';
  return String(v);
}

/** Renders legacy employee-form fields (text/textarea/number/date/select/checkbox). */
export function EmpFormFields({ fields, answers, onChange, readOnly, errors, idPrefix, target, onUploading }: {
  fields: EmpFormField[]; answers: Record<string, EmpAnswer>; onChange?: (id: string, v: EmpAnswer) => void;
  readOnly?: boolean; errors?: Record<string, string>; idPrefix: string;
  target?: EvidenceTarget;
  onUploading?: (delta:number)=>void;
}) {
  if (!fields.length) return <p className="text-sm text-muted-foreground">This form has no questions.</p>;
  return (
    <div className="space-y-4">
      {fields.map(f => {
        const v = answers[f.id];
        const set = (x: EmpAnswer) => onChange?.(f.id, x);
        const tid = `${idPrefix}-${f.id}`;
        return (
          <div key={f.id} className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={tid}>{f.label}{f.required && <span className="text-destructive"> *</span>}</label>
            {f.type === 'photo' || f.type === 'signature' ? (
              <EvidenceInput kind={f.type} fieldId={f.id} target={target} value={v as import('@/lib/jobForms').EvidenceAnswer | undefined} onChange={set} disabled={readOnly} onUploading={onUploading} />
            ) : readOnly ? (
              <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2">{displayEmpAnswer(f, v)}</p>
            ) : f.type === 'textarea' ? (
              <Textarea id={tid} rows={3} value={v == null ? '' : String(v)} onChange={e => set(e.target.value)} />
            ) : f.type === 'select' ? (
              <Select value={v == null ? '' : String(v)} onValueChange={set}>
                <SelectTrigger id={tid}><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>{(f.options ?? []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            ) : f.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm"><Checkbox id={tid} checked={v === true} onCheckedChange={c => set(c === true)} /> Yes</label>
            ) : (
              <Input id={tid} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={v == null ? '' : String(v)}
                onChange={e => set(f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />
            )}
            {errors?.[f.id] && <p className="text-xs text-destructive">{errors[f.id]}</p>}
          </div>
        );
      })}
    </div>
  );
}
