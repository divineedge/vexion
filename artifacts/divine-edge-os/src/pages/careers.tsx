/** Public careers / application page — /careers/:slug. No auth. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, Briefcase, Upload, X } from 'lucide-react';
import { FieldInputs } from '@/components/hr/HrFields';
import { validateDoc, missingRequired, hrErr, fmtBytes, ACCEPTED_DOCS, type FormField, type AnswerValue } from '@/components/hr/hrApi';

interface CareersConfig {
  businessName: string; enabled: boolean; applicationIntro: string; privacyNotice: string; fields: FormField[];
  postings: Array<{ id: number; title: string; description: string; fields: FormField[] }>;
}

export default function CareersPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [cfg, setCfg] = useState<CareersConfig | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [postingId, setPostingId] = useState<number | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; message: string } | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const failedSig = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true); setLoadErr(null);
    customFetch<CareersConfig>(`/api/careers/${encodeURIComponent(slug)}`)
      .then(setCfg)
      .catch(e => setLoadErr((e as { status?: number })?.status === 404 ? 'We couldn’t find this careers page.' : 'This careers page couldn’t be loaded.'))
      .finally(() => setLoading(false));
  }, [slug]);
  useEffect(load, [load]);

  const posting = cfg?.postings.find(p => p.id === postingId) ?? null;
  const fields = posting?.fields?.length ? posting.fields : (cfg?.fields ?? []);

  const submit = async () => {
    if (!fullName.trim() || !phone.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Full name, a valid email, and phone are required.'); return; }
    const miss = missingRequired(fields, answers);
    if (miss.length) { setErr(`Please answer: ${miss.join(', ')}`); return; }
    if (!consent) { setErr('Please confirm consent to submit your application.'); return; }
    const application = { fullName: fullName.trim(), email: email.trim(), phone: phone.trim(), postingId: postingId ?? undefined, answers, consent: true as const };
    const sig = JSON.stringify(application) + (resume ? `|${resume.name}|${resume.size}|${resume.lastModified}` : '');
    // Retry of an unchanged failed submission reuses the UUID; changed input gets a new one.
    if (failedSig.current !== null && failedSig.current !== sig) requestId.current = crypto.randomUUID();
    setErr(null); setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('application', JSON.stringify({ requestId: requestId.current, ...application }));
      if (resume) fd.append('resume', resume);
      const r = await customFetch<{ success: boolean; reference: string; message: string }>(`/api/careers/${encodeURIComponent(slug)}/applications`, { method: 'POST', body: fd });
      failedSig.current = null;
      setDone({ reference: r.reference, message: r.message });
    } catch (e) {
      failedSig.current = sig;
      setErr(hrErr(e, 'Your application couldn’t be submitted. Please try again.'));
    } finally { setSubmitting(false); }
  };

  const shell = (children: ReactNode) => (
    <div className="min-h-[100dvh] bg-muted/30 flex items-start justify-center p-3 sm:p-8">
      <Card className="w-full max-w-2xl">{children}</Card>
    </div>
  );

  if (loading) return shell(<CardContent className="pt-6 space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />)}</CardContent>);
  if (loadErr || !cfg) return shell(<CardContent className="py-12 text-center space-y-3"><AlertTriangle className="w-8 h-8 mx-auto text-destructive" /><p className="text-sm">{loadErr}</p>
    <Button variant="outline" onClick={load} data-testid="button-retry-careers">Try again</Button></CardContent>);
  if (!cfg.enabled) return shell(<CardContent className="py-12 text-center space-y-2" data-testid="text-careers-closed"><Briefcase className="w-8 h-8 mx-auto text-muted-foreground" />
    <h1 className="text-lg font-semibold">{cfg.businessName} isn’t accepting applications right now</h1><p className="text-sm text-muted-foreground">Please check back later.</p></CardContent>);
  if (done) return shell(<CardContent className="py-12 text-center space-y-3" data-testid="text-application-done">
    <CheckCircle2 className="w-12 h-12 mx-auto text-primary" /><h1 className="text-xl font-semibold">Application received</h1>
    <p className="text-sm text-muted-foreground">{done.message}</p><p className="text-xs text-muted-foreground">Reference: <span className="font-mono">{done.reference}</span></p></CardContent>);

  return shell(<>
    <CardHeader>
      <CardTitle className="text-2xl" data-testid="text-business-name">Work with {cfg.businessName}</CardTitle>
      {cfg.applicationIntro && <CardDescription className="whitespace-pre-wrap">{cfg.applicationIntro}</CardDescription>}
    </CardHeader>
    <CardContent className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium">Position</p>
        <div className="grid gap-2">
          <button onClick={() => { setPostingId(null); setAnswers({}); }} data-testid="button-posting-general"
            className={`text-left rounded-md border p-3 ${postingId === null ? 'border-primary ring-1 ring-primary bg-primary/5' : 'hover:border-primary/50'}`}>
            <p className="text-sm font-medium">General application</p><p className="text-xs text-muted-foreground">Not applying for a specific opening</p></button>
          {cfg.postings.map(p => (
            <button key={p.id} onClick={() => { setPostingId(p.id); setAnswers({}); }} data-testid={`button-posting-${p.id}`}
              className={`text-left rounded-md border p-3 ${postingId === p.id ? 'border-primary ring-1 ring-primary bg-primary/5' : 'hover:border-primary/50'}`}>
              <p className="text-sm font-medium">{p.title}</p>
              {p.description && <p className={`text-xs text-muted-foreground whitespace-pre-wrap ${postingId === p.id ? '' : 'line-clamp-2'}`}>{p.description}</p>}
            </button>))}
        </div>
      </section>

      <section className="space-y-3">
        <Input placeholder="Full name *" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" data-testid="input-fullname" />
        <div className="grid sm:grid-cols-2 gap-3">
          <Input type="email" placeholder="Email *" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" data-testid="input-email" />
          <Input type="tel" placeholder="Phone *" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" data-testid="input-phone" />
        </div>
      </section>

      {fields.length > 0 && <FieldInputs fields={fields} answers={answers} onChange={setAnswers} idPrefix="apply" />}

      <section className="space-y-2">
        <p className="text-sm font-medium">Resume (optional)</p>
        <input ref={fileRef} type="file" accept={ACCEPTED_DOCS} className="hidden" data-testid="input-resume"
          onChange={e => { const f = e.target.files?.[0]; if (!f) return; const v = validateDoc(f); if (v) { setErr(v); e.target.value = ''; return; } setErr(null); setResume(f); }} />
        {resume ? (
          <div className="flex items-center gap-2 rounded-md border p-2.5 text-sm"><span className="flex-1 truncate">{resume.name} · {fmtBytes(resume.size)}</span>
            <Button size="icon" variant="ghost" aria-label="Remove resume" onClick={() => { setResume(null); if (fileRef.current) fileRef.current.value = ''; }} data-testid="button-remove-resume"><X className="w-4 h-4" /></Button></div>
        ) : <Button variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()} data-testid="button-choose-resume"><Upload className="w-4 h-4" />Choose file</Button>}
        <p className="text-xs text-muted-foreground">PDF, image, or Word (.docx), up to 10 MB.</p>
      </section>

      {cfg.privacyNotice && <p className="text-xs text-muted-foreground whitespace-pre-wrap rounded-md bg-muted/50 p-3">{cfg.privacyNotice}</p>}
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={consent} onCheckedChange={c => setConsent(!!c)} className="mt-0.5" data-testid="check-consent" />
        <span>I agree that {cfg.businessName} may store the information and files I submit and contact me about this application and hiring. This is not a marketing sign-up.</span>
      </label>
      {err && <p className="text-sm text-destructive flex gap-1.5" data-testid="text-error"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{err}</p>}
      <Button className="w-full" onClick={submit} disabled={submitting} data-testid="button-submit-application">{submitting ? 'Submitting…' : 'Submit application'}</Button>
    </CardContent>
  </>);
}
