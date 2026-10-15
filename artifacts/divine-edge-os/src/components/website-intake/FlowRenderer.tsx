/**
 * Renders a FlowDefinition step by step. Used by the public site form and the
 * staff builder preview (preview=true never submits anything).
 */
import { useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, MapPin, Ruler, Undo2, Trash2, ShieldCheck, Eye, SkipForward } from 'lucide-react';
import { visibleFlow, validateFlowAnswers, APPROXIMATE_SIZE_TERMS, type FlowDefinition, type FlowStep, type FlowQuestion } from '@/lib/websiteIntake';
import { PinMap, DrawMap, geodesicAreaSqft, pathLengthFt, type LatLng } from './IntakeMaps';

export type Measurement = { mode: 'area' | 'linear'; points: LatLng[]; manual?: number; source?: 'drawn' | 'approximate'; acceptedTerms?: boolean };
export type Measurements = Record<string, Measurement>;
type Opt = { value: string; label: string };

export interface FlowRendererProps {
  definition: FlowDefinition;
  services?: { id: number | string; name: string }[];
  postings?: { id: number | string; title: string }[];
  tenantId?: number | string | null;
  allowProperty?: boolean;
  preview?: boolean;
  submitting?: boolean;
  error?: string | null;
  onSubmit?: (payload: { answers: Record<string, unknown>; measurements: Measurements; consent: boolean }) => void;
}

const isAnswered = (v: unknown) => Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' ? v : v != null && String(v).trim() !== '';
export const displayAnswer = (v: unknown, opts?: Opt[]) => {
  if (v == null || v === '') return 'Not answered';
  const map = (x: unknown) => opts?.find(o => o.value === String(x))?.label ?? String(x);
  if (Array.isArray(v)) return v.length ? v.map(map).join(', ') : 'Not answered';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return map(v);
};

export function measureValue(m?: Measurement | null): number | null {
  if (!m) return null;
  if (m.manual != null) return Number.isFinite(m.manual) && m.manual > 0 ? m.manual : null;
  const v = m.mode === 'area' ? geodesicAreaSqft(m.points) : pathLengthFt(m.points);
  return v > 0 ? Math.round(v) : null;
}

export default function FlowRenderer({ definition, services = [], postings = [], tenantId, allowProperty = true, preview, submitting, error, onSubmit }: FlowRendererProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [measurements, setMeasurements] = useState<Measurements>({});
  const [idx, setIdx] = useState(0);
  const [consent, setConsent] = useState(false);
  const [stepErr, setStepErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateErr, setLocateErr] = useState<string | null>(null);

  const flow = useMemo(() => visibleFlow(definition, answers), [definition, answers]);
  const steps = flow.steps.filter(s => allowProperty || s.kind === 'questions');
  const atReview = idx >= steps.length;
  const step: FlowStep | undefined = steps[idx];

  const optionsFor = (q: FlowQuestion): Opt[] =>
    q.id === 'serviceIds' && services.length ? services.map(s => ({ value: String(s.id), label: s.name }))
      : q.id === 'postingId' && postings.length ? postings.map(p => ({ value: String(p.id), label: p.title }))
        : q.options.map(o => ({ value: o, label: o }));

  // visibleFlow returns steps whose questions are already filtered by condition.
  const visibleQuestions = (s: FlowStep) => s.questions;

  const set = (s: FlowStep, id: string, v: unknown) => {
    setStepErr(null);
    setAnswers(a => {
      const next = { ...a, [id]: v };
      if (s.kind === 'property') { delete next.lat; delete next.lng; delete next.pinConfirmed; setMeasurements({}); }
      return next;
    });
  };

  const center: LatLng | null = typeof answers.lat === 'number' && typeof answers.lng === 'number' ? { lat: answers.lat as number, lng: answers.lng as number } : null;

  const locate = async (s: FlowStep) => {
    const parts = s.questions.map(q => answers[q.id]).filter(v => typeof v === 'string' && v.trim()) as string[];
    if (!parts.length) { setLocateErr('Enter the property address first.'); return; }
    setLocating(true); setLocateErr(null);
    try {
      const r = await customFetch<{ lat: number; lng: number }>(`/api/widget/locate?tenantId=${encodeURIComponent(String(tenantId ?? ''))}&address=${encodeURIComponent(parts.join(', '))}`);
      setAnswers(a => ({ ...a, lat: r.lat, lng: r.lng, pinConfirmed: false }));
      setMeasurements({});
    } catch { setLocateErr('We could not place this address on the map. You can continue; the team will confirm the location.'); }
    finally { setLocating(false); }
  };

  const checkStep = (s: FlowStep): string | null => {
    for (const q of visibleQuestions(s)) if (q.required && !isAnswered(answers[q.id])) return `${q.label} is required.`;
    if (s.kind === 'property' && s.required && center && !answers.pinConfirmed) return 'Confirm the pin marks the right property.';
    if (s.kind === 'property' && s.required && !center && !locateErr) return 'Locate the property on the map.';
    if (s.kind === 'measurement') {
      const m = measurements[s.id];
      if (s.required && !measureValue(m)) return 'Add a measurement to continue.';
      if (m && m.source === 'approximate' && !m.acceptedTerms) return 'Accept the approximate size terms, or clear the size, to continue.';
    }
    return null;
  };

  const next = () => {
    if (!step) return;
    const e = checkStep(step);
    if (e) { setStepErr(e); return; }
    setStepErr(null); setIdx(i => i + 1);
  };
  const skip = () => {
    if (!step) return;
    setMeasurements(m => { const n = { ...m }; delete n[step.id]; return n; });
    setStepErr(null); setIdx(i => i + 1);
  };

  const finalSubmit = () => {
    const v = validateFlowAnswers(definition, answers);
    if (v) { setStepErr(v); return; }
    if (!consent) { setStepErr('Please confirm the privacy notice to continue.'); return; }
    const visIds = new Set(steps.map(s => s.id));
    const ms: Measurements = {};
    for (const [k, m] of Object.entries(measurements)) if (visIds.has(k) && measureValue(m)) ms[k] = m;
    setStepErr(null);
    onSubmit?.({ answers: flow.answers, measurements: ms, consent });
  };

  const total = steps.length + 1;
  return (
    <div className="space-y-5" data-testid="flow-renderer">
      <div className="flex items-center gap-1.5" aria-label="Progress">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= idx ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </div>

      {!atReview && step && (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300" key={step.id}>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Step {idx + 1} of {steps.length}{!step.required && step.kind !== 'questions' ? ' · optional' : ''}</p>
            <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-step-title">
              {step.kind === 'property' && <MapPin className="w-4 h-4 text-primary" />}
              {step.kind === 'measurement' && <Ruler className="w-4 h-4 text-primary" />}
              {step.title}
            </h2>
          </div>

          {visibleQuestions(step).map(q => (
            <QuestionInput key={q.id} q={q} value={answers[q.id]} options={optionsFor(q)} onChange={v => set(step, q.id, v)} />
          ))}

          {step.kind === 'property' && (
            <div className="space-y-3">
              <Button variant="outline" onClick={() => locate(step)} disabled={locating} className="gap-1.5" data-testid="button-locate">
                {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}{center ? 'Locate again' : 'Find on map'}
              </Button>
              {locateErr && <p className="text-xs text-muted-foreground">{locateErr}</p>}
              {center && (<>
                <PinMap center={center} draggable={step.allowPinMove} onMove={p => { setAnswers(a => ({ ...a, lat: p.lat, lng: p.lng, pinConfirmed: false })); setMeasurements({}); }} />
                {step.allowPinMove && <p className="text-xs text-muted-foreground">Drag the pin or tap the map if it is not on the right spot.</p>}
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={!!answers.pinConfirmed} onCheckedChange={v => setAnswers(a => ({ ...a, pinConfirmed: v === true }))} data-testid="checkbox-pin-confirmed" />
                  The pin marks the right property.
                </label>
              </>)}
            </div>
          )}

          {step.kind === 'measurement' && (
            <MeasureStep step={step} center={center} value={measurements[step.id]} onChange={m => { setStepErr(null); setMeasurements(all => { const n = { ...all }; if (m) n[step.id] = m; else delete n[step.id]; return n; }); }} />
          )}
        </div>
      )}

      {atReview && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Final check</p>
            <h2 className="text-lg font-semibold">Review your answers</h2>
          </div>
          <dl className="divide-y rounded-lg border" data-testid="list-review">
            {steps.flatMap(s => visibleQuestions(s).map(q => (
              <div key={q.id} className="px-3 py-2 grid grid-cols-5 gap-2 text-sm">
                <dt className="col-span-2 text-muted-foreground">{q.label}</dt>
                <dd className="col-span-3 break-words">{displayAnswer(answers[q.id], optionsFor(q))}</dd>
              </div>
            )))}
            {steps.filter(s => s.kind === 'measurement').map(s => {
              const v = measureValue(measurements[s.id]);
              return <div key={s.id} className="px-3 py-2 grid grid-cols-5 gap-2 text-sm"><dt className="col-span-2 text-muted-foreground">{s.title}</dt>
                <dd className="col-span-3">{v ? `${v.toLocaleString()} ${s.measurementMode === 'area' ? 'sq ft' : 'ft'} ${(measurements[s.id]?.source === 'approximate' || (!measurements[s.id]?.points.length && measurements[s.id]?.manual)) ? '(approximate size you entered, unverified; terms accepted)' : '(drawn on the map, not yet verified)'}` : 'Skipped, no instant estimate for this step'}</dd></div>;
            })}
          </dl>
          {definition.privacyNotice && <p className="text-xs text-muted-foreground flex gap-1.5 whitespace-pre-wrap"><ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />{definition.privacyNotice}</p>}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={consent} onCheckedChange={v => setConsent(v === true)} data-testid="checkbox-consent" />
            I agree my details may be stored and used to respond to this request. I will not be added to marketing lists.
          </label>
          {preview && <p className="text-xs rounded-md bg-accent/40 text-accent-foreground p-2.5 flex gap-1.5"><Eye className="w-3.5 h-3.5 shrink-0 mt-0.5" />Preview mode. Submitting is disabled and nothing is saved.</p>}
        </div>
      )}

      {(stepErr || error) && <p className="text-sm text-destructive flex gap-1.5" data-testid="text-error"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{stepErr || error}</p>}

      <div className="flex gap-2">
        {idx > 0 && <Button variant="outline" onClick={() => { setStepErr(null); setIdx(i => i - 1); }} data-testid="button-back"><ChevronLeft className="w-4 h-4" /></Button>}
        {!atReview && step && !step.required && step.kind !== 'questions' && (
          <Button variant="ghost" onClick={skip} className="gap-1" data-testid="button-skip"><SkipForward className="w-4 h-4" />Skip</Button>
        )}
        {!atReview ? (
          <Button className="flex-1 gap-1" onClick={next} data-testid="button-next">Continue<ChevronRight className="w-4 h-4" /></Button>
        ) : (
          <Button className="flex-1" onClick={finalSubmit} disabled={preview || submitting} data-testid="button-submit">
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Sending…</> : preview ? 'Submit (disabled in preview)' : 'Send for review'}
          </Button>
        )}
      </div>
    </div>
  );
}

function QuestionInput({ q, value, options, onChange }: { q: FlowQuestion; value: unknown; options: Opt[]; onChange: (v: unknown) => void }) {
  const label = <label className="text-sm font-medium" htmlFor={`q-${q.id}`}>{q.label}{q.required ? <span className="text-primary"> *</span> : <span className="text-muted-foreground font-normal"> (optional)</span>}</label>;
  // Normalise across single/multiple switches: a list shows its first value in a single select; a lone string becomes a one-item list.
  const str = typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) && value.length ? String(value[0]) : '';
  const tid = `input-q-${q.id}`;
  switch (q.type) {
    case 'textarea': return <div className="space-y-1.5">{label}<Textarea id={`q-${q.id}`} rows={4} value={str} onChange={e => onChange(e.target.value)} data-testid={tid} /></div>;
    case 'select': return <div className="space-y-1.5">{label}
      <select id={`q-${q.id}`} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={str} onChange={e => onChange(e.target.value)} data-testid={tid}>
        <option value="">Choose…</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select></div>;
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as unknown[]).map(String) : typeof value === 'string' && value ? [value] : [];
      return <div className="space-y-1.5">{label}<div className="grid gap-1.5">{options.map(o => {
        const on = arr.includes(o.value);
        return <button type="button" key={o.value} onClick={() => onChange(on ? arr.filter(x => x !== o.value) : [...arr, o.value])} data-testid={`${tid}-${o.value}`}
          className={`text-left px-3 py-2.5 rounded-lg border text-sm transition ${on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/50'}`}>{o.label}</button>;
      })}</div></div>;
    }
    case 'checkbox': return <label className="flex items-start gap-2 text-sm"><Checkbox checked={value === true} onCheckedChange={v => onChange(v === true)} data-testid={tid} />{q.label}{q.required && <span className="text-primary">*</span>}</label>;
    default: return <div className="space-y-1.5">{label}<Input id={`q-${q.id}`} type={q.type === 'phone' ? 'tel' : q.type === 'text' ? 'text' : q.type} value={str}
      onChange={e => onChange(q.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} data-testid={tid} /></div>;
  }
}

function MeasureStep({ step, center, value, onChange }: { step: FlowStep; center: LatLng | null; value?: Measurement; onChange: (m: Measurement | null) => void }) {
  const mode = step.measurementMode === 'linear' ? 'linear' : 'area';
  const approxOk = !!step.allowApproximate;
  const [source, setSource] = useState<'drawn' | 'approximate'>(value?.source === 'approximate' && approxOk ? 'approximate' : center ? 'drawn' : approxOk ? 'approximate' : 'drawn');
  const pts = value?.source === 'approximate' ? [] : value?.points ?? [];
  const v = measureValue(value);
  const unit = mode === 'area' ? 'sq ft' : 'ft';
  const terms = step.approximateTerms?.trim() || APPROXIMATE_SIZE_TERMS;
  const switchTo = (s: 'drawn' | 'approximate') => { if (s !== source) { setSource(s); onChange(null); } };
  return (
    <div className="space-y-3">
      {approxOk && (
        <div className="inline-flex rounded-lg border p-1 bg-muted/40" role="radiogroup" aria-label="How to measure">
          <button type="button" role="radio" aria-checked={source === 'drawn'} disabled={!center} onClick={() => switchTo('drawn')} data-testid="button-source-drawn"
            className={`px-3 py-1.5 rounded-md text-sm disabled:opacity-40 ${source === 'drawn' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}>Draw on map</button>
          <button type="button" role="radio" aria-checked={source === 'approximate'} onClick={() => switchTo('approximate')} data-testid="button-source-approximate"
            className={`px-3 py-1.5 rounded-md text-sm ${source === 'approximate' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}>Approximate size</button>
        </div>
      )}
      {source === 'drawn' ? (center ? (<>
        <p className="text-sm text-muted-foreground">{mode === 'area' ? 'Tap the corners of the area.' : 'Tap along the length.'}</p>
        <DrawMap center={center} mode={mode} points={pts} onChange={p => onChange(p.length ? { mode, points: p, source: 'drawn' } : null)} />
        <div className="flex items-center gap-2 text-sm">
          <span className="flex-1" data-testid="text-measured">Measured: <strong>{v ? `${v.toLocaleString()} ${unit}` : '—'}</strong></span>
          <Button size="sm" variant="ghost" disabled={!pts.length} onClick={() => onChange(pts.length > 1 ? { mode, points: pts.slice(0, -1), source: 'drawn' } : null)} aria-label="Undo" data-testid="button-undo"><Undo2 className="w-4 h-4" /></Button>
          <Button size="sm" variant="ghost" disabled={!pts.length} onClick={() => onChange(null)} aria-label="Clear" data-testid="button-clear"><Trash2 className="w-4 h-4" /></Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Your drawing is checked by the company before any price is final.</p>
      </>) : (
        <p className="text-sm text-muted-foreground rounded-md bg-muted/50 p-3" data-testid="text-need-location">This step needs the property located on the map. Go back to find it{!step.required ? ', or skip this step' : ''}.</p>
      )) : (<>
        <label className="text-sm font-medium" htmlFor={`approx-${step.id}`}>Approximate {mode === 'area' ? 'square feet' : 'linear feet'}</label>
        <Input id={`approx-${step.id}`} type="number" min={1} inputMode="decimal" value={value?.manual ?? ''}
          onChange={e => { const n = Number(e.target.value); onChange(e.target.value !== '' && Number.isFinite(n) && n > 0 ? { mode, points: [], manual: n, source: 'approximate', acceptedTerms: false } : null); }} data-testid="input-approximate-size" />
        <p className="text-xs rounded-md border border-dashed p-2.5 text-muted-foreground">Unverified size. Any price shown is preliminary until the company checks the property.</p>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={!!value?.acceptedTerms} disabled={!v} onCheckedChange={c => value && onChange({ ...value, acceptedTerms: c === true })} data-testid="checkbox-approximate-terms" />
          <span className="text-xs leading-relaxed whitespace-pre-wrap">{terms}</span>
        </label>
      </>)}
    </div>
  );
}
