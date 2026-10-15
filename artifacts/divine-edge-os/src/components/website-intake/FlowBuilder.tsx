/** Editor for a FlowDefinition: steps, questions, conditions. IDs are stable and never relabeled. */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Link } from 'wouter';
import { Checkbox } from '@/components/ui/checkbox';
import { useListServices } from '@workspace/api-client-react';
import { ArrowUp, ArrowDown, Trash2, Plus, MapPin, Ruler, ListChecks, GitBranch, X, Paperclip } from 'lucide-react';
import { APPROXIMATE_SIZE_TERMS, type FlowDefinition, type FlowStep, type FlowQuestion, type FlowCondition } from '@/lib/websiteIntake';

const QTYPES: FlowQuestion['type'][] = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'multiselect', 'checkbox'];
const OPS: { v: FlowCondition['operator']; l: string }[] = [
  { v: 'equals', l: 'is' }, { v: 'not_equals', l: 'is not' }, { v: 'contains', l: 'includes' }, { v: 'answered', l: 'is answered' },
];
const RESERVED = new Set(['serviceIds', 'postingId']);
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const move = <T,>(arr: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const n = [...arr]; [n[i], n[j]] = [n[j], n[i]]; return n; };

type Ref = { id: string; label: string; options: string[] };
const sel = 'h-9 rounded-md border bg-background px-2 text-sm';

export default function FlowBuilder({ value, onChange, kind }: { value: FlowDefinition; onChange: (d: FlowDefinition) => void; kind: 'quote' | 'hiring' }) {
  const setStep = (i: number, s: FlowStep) => onChange({ ...value, steps: value.steps.map((x, k) => k === i ? s : x) });
  const addStep = (k: FlowStep['kind']) => onChange({
    ...value, steps: [...value.steps, {
      id: uid('step'), title: k === 'property' ? 'Your property' : k === 'measurement' ? 'Measure the area' : 'New step',
      kind: k, required: false, measurementMode: 'area', allowPinMove: true, condition: null,
      questions: k === 'property' ? [
        { id: uid('q'), label: 'Street address', type: 'text', required: true, options: [], condition: null },
        { id: uid('q'), label: 'City, state, ZIP', type: 'text', required: true, options: [], condition: null },
      ] : [],
    }],
  });
  const refsBefore = (si: number, qi?: number): Ref[] => value.steps.flatMap((s, k) =>
    k < si ? s.questions : k === si && qi != null ? s.questions.slice(0, qi) : []).map(q => ({ id: q.id, label: q.label || q.id, options: q.options }));

  return (
    <div className="space-y-6">
      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <Input value={value.title} onChange={e => onChange({ ...value, title: e.target.value })} placeholder="Form title" className="text-base font-semibold" data-testid="input-flow-title" />
        <Textarea rows={2} value={value.intro} onChange={e => onChange({ ...value, intro: e.target.value })} placeholder="Intro shown above the form" data-testid="input-flow-intro" />
        <div className="grid sm:grid-cols-2 gap-3">
          <Textarea rows={3} value={value.successMessage} onChange={e => onChange({ ...value, successMessage: e.target.value })} placeholder="Message after sending (always framed as pending review)" data-testid="input-flow-success" />
          <Textarea rows={3} value={value.privacyNotice} onChange={e => onChange({ ...value, privacyNotice: e.target.value })} placeholder="Privacy notice" data-testid="input-flow-privacy" />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4 space-y-2" data-testid="section-uploads">
        <label className="flex items-center gap-2 text-sm font-medium"><Paperclip className="w-4 h-4 text-primary" />
          <Switch checked={!!value.uploads?.enabled} onCheckedChange={v => onChange({ ...value, uploads: { enabled: v, required: value.uploads?.required ?? false, label: value.uploads?.label || (kind === 'quote' ? 'Photos or documents' : 'Supporting documents') } })} data-testid="switch-uploads" />
          Let visitors attach files</label>
        <p className="text-xs text-muted-foreground">JPEG or PDF, up to 5 files, 10 MB each and 25 MB combined{kind === 'hiring' ? ' (including the resume)' : ''}. Files stay private to staff.</p>
        {value.uploads?.enabled && (
          <div className="flex flex-wrap items-center gap-3">
            <Input className="h-9 flex-1 min-w-[12rem]" value={value.uploads.label} onChange={e => onChange({ ...value, uploads: { ...value.uploads!, label: e.target.value } })} placeholder="Upload label" aria-label="Upload label" data-testid="input-uploads-label" />
            <label className="flex items-center gap-1.5 text-xs"><Switch checked={value.uploads.required} onCheckedChange={v => onChange({ ...value, uploads: { ...value.uploads!, required: v } })} data-testid="switch-uploads-required" />Required</label>
          </div>
        )}
      </section>

      <ol className="space-y-4">
        {value.steps.map((s, si) => (
          <li key={s.id} className="rounded-xl border bg-card overflow-hidden" data-testid={`card-step-${s.id}`}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-muted/50 border-b">
              <span className="font-mono text-xs text-muted-foreground w-6">{String(si + 1).padStart(2, '0')}</span>
              {s.kind === 'property' ? <MapPin className="w-4 h-4 text-primary" /> : s.kind === 'measurement' ? <Ruler className="w-4 h-4 text-primary" /> : <ListChecks className="w-4 h-4 text-primary" />}
              <Input value={s.title} onChange={e => setStep(si, { ...s, title: e.target.value })} className="h-8 flex-1 min-w-[10rem] bg-background" data-testid={`input-step-title-${s.id}`} />
              {s.kind !== 'questions' && <label className="flex items-center gap-1.5 text-xs"><Switch checked={s.required} onCheckedChange={v => setStep(si, { ...s, required: v })} data-testid={`switch-step-required-${s.id}`} />Required</label>}
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onChange({ ...value, steps: move(value.steps, si, -1) })} aria-label="Move up" data-testid={`button-step-up-${s.id}`}><ArrowUp className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onChange({ ...value, steps: move(value.steps, si, 1) })} aria-label="Move down" data-testid={`button-step-down-${s.id}`}><ArrowDown className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onChange({ ...value, steps: value.steps.filter((_, k) => k !== si) })} aria-label="Remove step" data-testid={`button-step-remove-${s.id}`}><Trash2 className="w-4 h-4" /></Button>
            </div>
            <div className="p-4 space-y-3">
              {s.kind === 'property' && (
                <label className="flex items-center gap-2 text-sm"><Switch checked={s.allowPinMove} onCheckedChange={v => setStep(si, { ...s, allowPinMove: v })} data-testid={`switch-pin-move-${s.id}`} />Let customers move the map pin</label>
              )}
              {s.kind === 'measurement' && (
                <div className="flex items-center gap-2 text-sm">Measure
                  <select className={sel} value={s.measurementMode} onChange={e => setStep(si, { ...s, measurementMode: e.target.value as FlowStep['measurementMode'] })} data-testid={`select-measure-mode-${s.id}`}>
                    <option value="area">area (sq ft)</option><option value="linear">length (ft)</option>
                  </select>
                  <span className="text-xs text-muted-foreground">Needs an earlier property step to show a map.</span>
                </div>
              )}
              {s.kind === 'measurement' && (
                <div className="space-y-2 rounded-md border p-3">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={!!s.allowApproximate}
                    onCheckedChange={v => setStep(si, { ...s, allowApproximate: v, approximateTerms: v ? (s.approximateTerms?.trim() ? s.approximateTerms : APPROXIMATE_SIZE_TERMS) : s.approximateTerms })} data-testid={`switch-approximate-${s.id}`} />Allow customer-estimated size</label>
                  <p className="text-xs text-muted-foreground">When on, customers can type an approximate size instead of drawing. They must accept these terms first. When off, only map drawing is offered.</p>
                  {s.allowApproximate && (<>
                    <Textarea rows={4} value={s.approximateTerms ?? APPROXIMATE_SIZE_TERMS} onChange={e => setStep(si, { ...s, approximateTerms: e.target.value })} aria-label="Approximate size terms" data-testid={`input-approximate-terms-${s.id}`} />
                    <button className="text-xs underline text-muted-foreground" onClick={() => setStep(si, { ...s, approximateTerms: APPROXIMATE_SIZE_TERMS })} data-testid={`button-reset-terms-${s.id}`}>Reset to default terms</button>
                  </>)}
                </div>
              )}
              <ConditionEditor label="Show this step only if" cond={s.condition ?? null} refs={refsBefore(si)} onChange={c => setStep(si, { ...s, condition: c })} testId={`step-${s.id}`} />
              <div className="space-y-2">
                {s.questions.map((q, qi) => (
                  <QuestionRow key={q.id} q={q} refs={refsBefore(si, qi)}
                    onChange={nq => setStep(si, { ...s, questions: s.questions.map((x, k) => k === qi ? nq : x) })}
                    onMove={d => setStep(si, { ...s, questions: move(s.questions, qi, d) })}
                    onRemove={() => setStep(si, { ...s, questions: s.questions.filter((_, k) => k !== qi) })} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1" onClick={() => setStep(si, { ...s, questions: [...s.questions, { id: uid('q'), label: '', type: 'text', required: false, options: [], condition: null }] })} data-testid={`button-add-question-${s.id}`}><Plus className="w-3.5 h-3.5" />Question</Button>
                {kind === 'quote' && !value.steps.some(x => x.questions.some(q => q.id === 'serviceIds')) && (
                  <Button size="sm" variant="ghost" onClick={() => setStep(si, { ...s, questions: [...s.questions, { id: 'serviceIds', label: 'Which services are you interested in?', type: 'multiselect', required: true, options: [], condition: null }] })} data-testid={`button-add-services-${s.id}`}>+ Services picker</Button>
                )}
                {kind === 'hiring' && !value.steps.some(x => x.questions.some(q => q.id === 'postingId')) && (
                  <Button size="sm" variant="ghost" onClick={() => setStep(si, { ...s, questions: [...s.questions, { id: 'postingId', label: 'Which position are you applying for?', type: 'select', required: false, options: [], condition: null }] })} data-testid={`button-add-posting-${s.id}`}>+ Job posting picker</Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2 rounded-xl border border-dashed p-3">
        <Button variant="outline" className="gap-1.5" onClick={() => addStep('questions')} data-testid="button-add-step"><ListChecks className="w-4 h-4" />Question step</Button>
        {kind === 'quote' && <>
          <Button variant="outline" className="gap-1.5" onClick={() => addStep('property')} data-testid="button-add-property-step"><MapPin className="w-4 h-4" />Property + map</Button>
          <Button variant="outline" className="gap-1.5" onClick={() => addStep('measurement')} data-testid="button-add-measure-step"><Ruler className="w-4 h-4" />Measurement</Button>
        </>}
      </div>
    </div>
  );
}

function QuestionRow({ q, refs, onChange, onMove, onRemove }: { q: FlowQuestion; refs: Ref[]; onChange: (q: FlowQuestion) => void; onMove: (d: number) => void; onRemove: () => void }) {
  const reserved = RESERVED.has(q.id);
  const isServices = q.id === 'serviceIds';
  const hasOpts = (q.type === 'select' || q.type === 'multiselect') && !reserved;
  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid={`row-question-${q.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q.label} onChange={e => onChange({ ...q, label: e.target.value })} placeholder="Question wording" className="h-9 flex-1 min-w-[12rem]" data-testid={`input-question-label-${q.id}`} />
        {isServices ? (
          <select className={sel} value={q.type === 'select' ? 'select' : 'multiselect'} onChange={e => onChange({ ...q, type: e.target.value as FlowQuestion['type'] })} aria-label="Service picker type" data-testid={`select-question-type-${q.id}`}>
            <option value="multiselect">Choose several</option><option value="select">Choose one</option>
          </select>
        ) : (
          <select className={sel} value={q.type} disabled={reserved} onChange={e => onChange({ ...q, type: e.target.value as FlowQuestion['type'] })} data-testid={`select-question-type-${q.id}`}>
            {QTYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs"><Switch checked={q.required} onCheckedChange={v => onChange({ ...q, required: v })} data-testid={`switch-question-required-${q.id}`} />Required</label>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onMove(-1)} aria-label="Move up" data-testid={`button-question-up-${q.id}`}><ArrowUp className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onMove(1)} aria-label="Move down" data-testid={`button-question-down-${q.id}`}><ArrowDown className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onRemove} aria-label="Remove question" data-testid={`button-question-remove-${q.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
      </div>
      {isServices && <ServiceChooser selected={q.options} onChange={options => onChange({ ...q, options })} />}
      {reserved && !isServices && <Badge variant="secondary" className="text-[10px]">Options come from your open job postings</Badge>}
      {hasOpts && <Input value={q.options.join(', ')} onChange={e => onChange({ ...q, options: e.target.value.split(',').map(s => s.trimStart()) })}
        onBlur={() => onChange({ ...q, options: q.options.map(s => s.trim()).filter(Boolean) })} placeholder="Options, comma separated" className="h-8 text-xs" data-testid={`input-question-options-${q.id}`} />}
      <ConditionEditor label="Ask only if" cond={q.condition ?? null} refs={refs} onChange={c => onChange({ ...q, condition: c })} testId={`question-${q.id}`} />
    </div>
  );
}

function ConditionEditor({ label, cond, refs, onChange, testId }: { label: string; cond: FlowCondition | null; refs: Ref[]; onChange: (c: FlowCondition | null) => void; testId: string }) {
  if (!cond) return refs.length ? (
    <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => onChange({ field: refs[0].id, operator: 'answered', value: '' })} data-testid={`button-add-condition-${testId}`}>
      <GitBranch className="w-3.5 h-3.5" />Add a condition
    </button>) : null;
  const ref = refs.find(r => r.id === cond.field);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs rounded-md bg-accent/30 px-2 py-1.5">
      <GitBranch className="w-3.5 h-3.5 text-primary" /><span>{label}</span>
      <select className={`${sel} h-8 text-xs max-w-[14rem]`} value={cond.field} onChange={e => onChange({ ...cond, field: e.target.value })} data-testid={`select-condition-field-${testId}`}>
        {!ref && <option value={cond.field}>Missing question ({cond.field})</option>}
        {refs.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <select className={`${sel} h-8 text-xs`} value={cond.operator} onChange={e => onChange({ ...cond, operator: e.target.value as FlowCondition['operator'] })} data-testid={`select-condition-op-${testId}`}>
        {OPS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      {cond.operator !== 'answered' && (ref?.options.length
        ? <select className={`${sel} h-8 text-xs`} value={cond.value} onChange={e => onChange({ ...cond, value: e.target.value })} data-testid={`select-condition-value-${testId}`}>
          <option value="">Choose…</option>{ref.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
        : <Input className="h-8 w-40 text-xs" value={cond.value} onChange={e => onChange({ ...cond, value: e.target.value })} placeholder="value" data-testid={`input-condition-value-${testId}`} />)}
      <button onClick={() => onChange(null)} aria-label="Remove condition" data-testid={`button-remove-condition-${testId}`}><X className="w-3.5 h-3.5" /></button>
      {!ref && <span className="text-destructive">Must reference an earlier question.</span>}
    </div>
  );
}

function ServiceChooser({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const q = useListServices({ activeOnly: true });
  const services = q.data ?? [];
  const all = selected.length === 0;
  const toggle = (id: string, on: boolean) => {
    const base = all ? services.map(s => String(s.id)) : selected;
    const next = on ? Array.from(new Set([...base, id])) : base.filter(x => x !== id);
    onChange(next.length === services.length ? [] : next);
  };
  return (
    <div className="rounded-md bg-muted/40 p-2.5 space-y-2" data-testid="section-service-chooser">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">Services offered on this form {all && <span className="text-muted-foreground font-normal">(all active services)</span>}</p>
        <Link href="/services" className="text-xs underline text-muted-foreground" data-testid="link-manage-services">Edit service names and pricing</Link>
      </div>
      {q.isLoading ? <div className="h-8 rounded bg-muted animate-pulse" /> : q.isError ? (
        <p className="text-xs text-destructive">Could not load services. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>
      ) : services.length === 0 ? <p className="text-xs text-muted-foreground">No active services yet.</p> : (
        <div className="grid sm:grid-cols-2 gap-1.5">
          {services.map(s => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={all || selected.includes(String(s.id))} onCheckedChange={v => toggle(String(s.id), v === true)} data-testid={`checkbox-service-${s.id}`} />{s.name}
            </label>
          ))}
        </div>
      )}
      {!all && selected.some(id => !services.some(s => String(s.id) === id)) && q.isSuccess && <p className="text-[11px] text-muted-foreground">Some chosen services are no longer active and will not be shown.</p>}
      {!all && (<button className="text-xs underline text-muted-foreground" onClick={() => onChange([])} data-testid="button-all-services">Offer all active services</button>)}
    </div>
  );
}
