/**
 * Public website form (no auth, iframe-safe).
 * kind=quote: /widget/quote, /quote-widget (?tenantId=&ref=&dh=)
 * kind=hiring: /careers/:slug (?legacy=1 opens the legacy resume page)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Clock, Upload, X } from 'lucide-react';
import { loadPublicWebsiteForm, submitPublicWebsiteForm } from '@/lib/websiteIntake';
import FlowRenderer, { type Measurements } from '@/components/website-intake/FlowRenderer';
import CareersPage from '@/pages/careers';

type Kind = 'quote' | 'hiring';
type Loaded = Awaited<ReturnType<typeof loadPublicWebsiteForm>>;
type Result = Awaited<ReturnType<typeof submitPublicWebsiteForm>>;
const RESUME_TYPES = '.pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp';
const RESUME_EXT = /\.(pdf|docx|jpe?g|png|webp)$/i;
const MAX_RESUME = 10 * 1024 * 1024;
const ATTACH_EXT = /\.(pdf|jpe?g)$/i;
const ATTACH_MIME = new Set(['application/pdf', 'image/jpeg']);
const MAX_FILES = 5;
const MAX_TOTAL = 25 * 1024 * 1024;
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PublicQuoteForm() { return <PublicSiteForm kind="quote" />; }
export function PublicCareersForm() {
  const legacy = new URLSearchParams(window.location.search).get('legacy') === '1';
  return legacy ? <CareersPage /> : <PublicSiteForm kind="hiring" />;
}

export default function PublicSiteForm({ kind }: { kind: Kind }) {
  const params = useParams<{ slug?: string }>();
  const qs = useMemo(() => new URLSearchParams(window.location.search), []);
  const tenantParam = qs.get('tenantId') ?? qs.get('tenant') ?? undefined;
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const lastSig = useRef<string | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [resumeErr, setResumeErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [filesErr, setFilesErr] = useState<string | null>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const totalBytes = (list: File[], r: File | null) => list.reduce((n, f) => n + f.size, 0) + (r?.size ?? 0);
  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (!(ATTACH_MIME.has(f.type) || ATTACH_EXT.test(f.name))) { setFilesErr(`${f.name}: only JPEG or PDF files are accepted.`); continue; }
      if (f.size > MAX_RESUME) { setFilesErr(`${f.name} is larger than 10 MB.`); continue; }
      if (next.length >= MAX_FILES) { setFilesErr(`Up to ${MAX_FILES} files.`); break; }
      if (totalBytes([...next, f], kind === 'hiring' ? resume : null) > MAX_TOTAL) { setFilesErr('All files together must be 25 MB or less.'); break; }
      next.push(f); setFilesErr(null);
    }
    setFiles(next);
    if (attachRef.current) attachRef.current.value = '';
  };
  const pickResume = (f?: File) => {
    if (!f) return;
    if (!RESUME_EXT.test(f.name)) { setResumeErr('Use a PDF, DOCX, JPG, PNG or WebP file.'); return; }
    if (f.size > MAX_RESUME) { setResumeErr('File must be 10 MB or smaller.'); return; }
    if (totalBytes(files, f) > MAX_TOTAL) { setResumeErr('All files together must be 25 MB or less.'); return; }
    setResumeErr(null); setResume(f);
    if (fileRef.current) fileRef.current.value = '';
  };

  const load = useCallback(() => {
    if (kind === 'quote' && !tenantParam) { setLoadErr('This link is missing a company identifier.'); setLoading(false); return; }
    setLoading(true); setLoadErr(null);
    loadPublicWebsiteForm({ kind, tenantId: tenantParam, slug: params.slug })
      .then(setData).catch(() => setLoadErr('We could not load this form.')).finally(() => setLoading(false));
  }, [kind, tenantParam, params.slug]);
  useEffect(load, [load]);

  // No custom hiring form published yet: keep the existing careers page. Load failures show an error instead.
  if (kind === 'hiring' && data && !data.definition) return <CareersPage />;

  const submit = async (p: { answers: Record<string, unknown>; measurements: Measurements; consent: boolean }) => {
    if (!data?.definition) return;
    const up = data.definition.uploads;
    if (up?.enabled && up.required && files.length === 0) { setErr(`${up.label || 'An attachment'} is required.`); return; }
    const fsig = (f: File) => [f.name, f.size, f.lastModified];
    const sig = JSON.stringify({ p, resume: resume ? fsig(resume) : null, files: up?.enabled ? files.map(fsig) : [] });
    if (lastSig.current !== null && lastSig.current !== sig) requestId.current = crypto.randomUUID();
    lastSig.current = sig;
    setSubmitting(true); setErr(null);
    try {
      const r = await submitPublicWebsiteForm({
        tenantId: data.tenantId, kind, requestId: requestId.current, revision: data.revision,
        answers: p.answers, measurements: p.measurements, consent: p.consent,
        referralCode: qs.get('ref') ?? undefined, doorHangerCode: qs.get('dh') ?? undefined,
      }, kind === 'hiring' ? resume ?? undefined : undefined, data.definition.uploads?.enabled ? files : undefined);
      setResult(r);
    } catch (e) {
      setErr((e as { data?: { error?: string } })?.data?.error ?? 'We could not send this. Your answers are still here; please try again.');
    } finally { setSubmitting(false); }
  };

  const def = data?.definition;
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-primary/10 via-background to-muted/40 flex items-start sm:items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-card shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b bg-primary text-primary-foreground">
          <p className="text-[11px] uppercase tracking-[0.2em] opacity-80">{kind === 'quote' ? 'Quick quote' : 'Careers'}</p>
          <h1 className="text-lg font-semibold" data-testid="text-company">{data?.companyName ?? (kind === 'quote' ? 'Request a quote' : 'Apply')}</h1>
          {def?.title && <p className="text-sm opacity-90">{def.title}</p>}
        </div>
        <div className="p-5">
          {loading ? <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />)}</div>
            : loadErr || !data ? (
              <div className="text-center py-6 space-y-3"><AlertTriangle className="w-8 h-8 mx-auto text-destructive" /><p className="text-sm">{loadErr}</p>
                <Button variant="outline" onClick={load} data-testid="button-retry">Try again</Button></div>
            ) : !data.enabled || !def ? (
              <p className="text-sm text-center py-6 text-muted-foreground">Online requests are currently turned off for {data.companyName}. Please contact them directly.</p>
            ) : result ? (
              <div className="text-center space-y-3 py-2" data-testid="panel-done">
                <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
                <p className="font-semibold">Received. A person will review it.</p>
                {def.successMessage && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{def.successMessage}</p>}
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><Clock className="w-3.5 h-3.5" />Pending review · reference <span className="font-mono" data-testid="text-reference">{result.reference}</span></p>
                {result.preview && result.preview.items.length > 0 && (
                  <div className="rounded-lg border bg-muted/40 p-3 text-left space-y-1" data-testid="panel-preview">
                    <p className="text-xs text-muted-foreground">Preliminary price based on your own measurement</p>
                    {result.preview.items.map(it => <p key={it.serviceId} className="text-sm flex justify-between"><span>{it.name}</span><span>{money(it.price)}</span></p>)}
                    <p className="text-lg font-semibold flex justify-between border-t pt-1"><span>Total</span><span>{money(result.preview.total)}</span></p>
                    <p className="text-[11px] text-muted-foreground">Not a final quote. Measurements are unverified and {data.companyName} will confirm pricing after review.</p>
                  </div>
                )}
              </div>
            ) : (<>
              {def.intro && <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">{def.intro}</p>}
              {kind === 'hiring' && (
                <div className="mb-5 rounded-lg border border-dashed p-3 space-y-2" data-testid="section-resume">
                  <p className="text-sm font-medium">Resume <span className="text-muted-foreground font-normal">(optional)</span></p>
                  {resume ? (
                    <div className="flex items-center gap-2 text-sm"><span className="flex-1 truncate" data-testid="text-resume-name">{resume.name}</span>
                      <span className="text-xs text-muted-foreground">{(resume.size / 1024 / 1024).toFixed(1)} MB</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove resume" onClick={() => setResume(null)} data-testid="button-remove-resume"><X className="w-4 h-4" /></Button></div>
                  ) : (
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} data-testid="button-attach-resume"><Upload className="w-4 h-4" />Attach file</Button>
                  )}
                  <input ref={fileRef} type="file" accept={RESUME_TYPES} className="hidden" onChange={e => pickResume(e.target.files?.[0])} data-testid="input-resume" />
                  <p className="text-[11px] text-muted-foreground">PDF, DOCX, JPG, PNG or WebP, up to 10 MB. Kept private to the hiring team.</p>
                  {resumeErr && <p className="text-xs text-destructive" data-testid="text-resume-error">{resumeErr}</p>}
                </div>
              )}
              {def.uploads?.enabled && (
                <div className="mb-5 rounded-lg border border-dashed p-3 space-y-2" data-testid="section-attachments">
                  <p className="text-sm font-medium">{def.uploads.label || 'Attachments'} {def.uploads.required ? <span className="text-primary">*</span> : <span className="text-muted-foreground font-normal">(optional)</span>}</p>
                  {files.length > 0 && <ul className="space-y-1">{files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate" data-testid={`text-attachment-${i}`}>{f.name}</span>
                      <span className="text-xs text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove ${f.name}`} onClick={() => { setFiles(files.filter((_, k) => k !== i)); setFilesErr(null); }} data-testid={`button-remove-attachment-${i}`}><X className="w-4 h-4" /></Button></li>
                  ))}</ul>}
                  {files.length < MAX_FILES && <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => attachRef.current?.click()} data-testid="button-add-attachment"><Upload className="w-4 h-4" />Add files</Button>}
                  <input ref={attachRef} type="file" multiple accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg" className="hidden" onChange={e => addFiles(e.target.files)} data-testid="input-attachments" />
                  <p className="text-[11px] text-muted-foreground">JPEG or PDF, up to {MAX_FILES} files, 10 MB each, 25 MB combined{kind === 'hiring' ? ' including your resume' : ''}. Private to the business.</p>
                  {filesErr && <p className="text-xs text-destructive" data-testid="text-attachments-error">{filesErr}</p>}
                </div>
              )}
              <FlowRenderer definition={def} services={data.services} postings={data.postings} tenantId={data.tenantId}
                allowProperty={kind === 'quote'} submitting={submitting} error={err} onSubmit={submit} />
            </>)}
        </div>
      </div>
    </div>
  );
}
