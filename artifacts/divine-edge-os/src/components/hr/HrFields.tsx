import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { FORM_FIELD_TYPES, type FormFieldType } from '@/lib/jobForms';
import type { FormField, AnswerValue } from './hrApi';

/** Renders answer inputs for the 7 job-form field types. */
export function FieldInputs({ fields, answers, onChange, idPrefix = 'q' }: {
  fields: FormField[]; answers: Record<string, AnswerValue>; onChange: (a: Record<string, AnswerValue>) => void; idPrefix?: string;
}) {
  const set = (id: string, v: AnswerValue) => onChange({ ...answers, [id]: v });
  return (
    <div className="space-y-4">
      {fields.map(f => {
        const v = answers[f.id];
        const tid = `${idPrefix}-${f.id}`;
        return (
          <div key={f.id} className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={tid}>{f.label}{f.required && <span className="text-destructive"> *</span>}</label>
            {f.type === 'text' && <Input id={tid} data-testid={`input-${tid}`} value={(v as string) ?? ''} onChange={e => set(f.id, e.target.value)} />}
            {f.type === 'textarea' && <Textarea id={tid} data-testid={`input-${tid}`} rows={3} value={(v as string) ?? ''} onChange={e => set(f.id, e.target.value)} />}
            {f.type === 'number' && <Input id={tid} data-testid={`input-${tid}`} type="number" value={v == null ? '' : String(v)} onChange={e => set(f.id, e.target.value === '' ? null : Number(e.target.value))} />}
            {f.type === 'date' && <Input id={tid} data-testid={`input-${tid}`} type="date" value={(v as string) ?? ''} onChange={e => set(f.id, e.target.value)} />}
            {f.type === 'select' && (
              <Select value={(v as string) ?? ''} onValueChange={x => set(f.id, x)}>
                <SelectTrigger id={tid} data-testid={`select-${tid}`}><SelectValue placeholder="Choose one" /></SelectTrigger>
                <SelectContent>{(f.options ?? []).filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {f.type === 'multi_select' && (
              <div className="flex flex-wrap gap-3">{(f.options ?? []).filter(Boolean).map(o => {
                const arr = Array.isArray(v) ? v : [];
                return (
                  <label key={o} className="flex items-center gap-2 text-sm">
                    <Checkbox data-testid={`check-${tid}-${o}`} checked={arr.includes(o)} onCheckedChange={c => set(f.id, c ? [...arr, o] : arr.filter(x => x !== o))} />{o}
                  </label>
                );
              })}</div>
            )}
            {f.type === 'yes_no' && (
              <div className="flex gap-2">
                {[true, false].map(b => (
                  <Button key={String(b)} type="button" size="sm" variant={v === b ? 'default' : 'outline'} onClick={() => set(f.id, b)} data-testid={`button-${tid}-${b ? 'yes' : 'no'}`}>{b ? 'Yes' : 'No'}</Button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function formatAnswer(v: AnswerValue | undefined): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Editor for a list of application questions. */
export function FieldsEditor({ fields, onChange }: { fields: FormField[]; onChange: (f: FormField[]) => void }) {
  const upd = (i: number, patch: Partial<FormField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const n = [...fields]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; onChange(n);
  };
  return (
    <div className="space-y-3">
      {fields.length === 0 && <p className="text-sm text-muted-foreground">No extra questions. Applicants will only provide name, email, and phone.</p>}
      {fields.map((f, i) => (
        <div key={f.id} className="rounded-md border p-3 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input className="flex-1" placeholder="Question label" value={f.label} onChange={e => upd(i, { label: e.target.value })} data-testid={`input-field-label-${i}`} />
            <Select value={f.type} onValueChange={t => upd(i, { type: t as FormFieldType })}>
              <SelectTrigger className="sm:w-44" data-testid={`select-field-type-${i}`}><SelectValue /></SelectTrigger>
              <SelectContent>{FORM_FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {(f.type === 'select' || f.type === 'multi_select') && (
            <Input placeholder="Options, comma separated" value={(f.options ?? []).join(', ')}
              onChange={e => upd(i, { options: e.target.value.split(',').map(s => s.trim()) })} data-testid={`input-field-options-${i}`} />
          )}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm flex-1"><Checkbox checked={f.required} onCheckedChange={c => upd(i, { required: !!c })} data-testid={`check-field-required-${i}`} />Required</label>
            <Button type="button" size="icon" variant="ghost" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="w-4 h-4" /></Button>
            <Button type="button" size="icon" variant="ghost" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="w-4 h-4" /></Button>
            <Button type="button" size="icon" variant="ghost" onClick={() => onChange(fields.filter((_, j) => j !== i))} aria-label="Remove question" data-testid={`button-remove-field-${i}`}><Trash2 className="w-4 h-4" /></Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5"
        onClick={() => onChange([...fields, { id: `f_${Date.now().toString(36)}`, label: '', type: 'text', required: false }])} data-testid="button-add-field">
        <Plus className="w-4 h-4" />Add question
      </Button>
    </div>
  );
}

export function cleanFields(fields: FormField[]): FormField[] | string {
  for (const f of fields) {
    if (!f.label.trim()) return 'Every question needs a label.';
    if ((f.type === 'select' || f.type === 'multi_select') && !(f.options ?? []).some(o => o.trim())) return `"${f.label}" needs at least one option.`;
  }
  return fields.map(f => ({ ...f, label: f.label.trim(), options: f.options?.map(o => o.trim()).filter(Boolean) }));
}
