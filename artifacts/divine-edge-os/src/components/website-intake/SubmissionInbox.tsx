/** Staff inbox of website submissions with a review sheet. */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AlertTriangle, Inbox, ExternalLink, MapPin, Ruler, CheckCircle2, XCircle, Eye, Download, Paperclip } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { loadWebsiteSubmissions, reviewWebsiteSubmission, visibleFlow, APPROXIMATE_SIZE_TERMS, type WebsiteSubmission, type ReviewInput } from '@/lib/websiteIntake';
import { DrawMap, PinMap } from './IntakeMaps';
import { displayAnswer, measureValue, type Measurement } from './FlowRenderer';

type Kind = 'quote' | 'hiring';
const fmt = (s?: string | null) => { try { return s ? format(new Date(s), 'MMM d, yyyy h:mm a') : '—'; } catch { return '—'; } };
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const errMsg = (e: unknown, f: string) => (e as { data?: { error?: string } })?.data?.error ?? (e instanceof Error ? e.message : f);
const tone = (s: string): 'default' | 'secondary' | 'outline' | 'destructive' => s === 'approved' ? 'default' : s === 'declined' ? 'destructive' : s === 'reviewed' ? 'secondary' : 'outline';
const nameOf = (s: WebsiteSubmission) => {
  const a = s.payload?.answers ?? {};
  const q = (s.snapshot?.steps ?? []).flatMap(x => x.questions).find(q => /name/i.test(q.label) && typeof a[q.id] === 'string');
  return (q && String(a[q.id])) || `Submission #${s.id}`;
};

const originalName = (s: WebsiteSubmission) => {
  const n = s.payload?.answers?.name;
  return typeof n === 'string' && n.trim() ? n.trim() : nameOf(s);
};

export default function SubmissionInbox({ kind }: { kind: Kind }) {
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['website-submissions', kind],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => loadWebsiteSubmissions(kind, pageParam),
    getNextPageParam: last => last.nextCursor ?? undefined,
  });
  const all = useMemo(() => (q.data?.pages ?? []).flatMap(p => p.submissions), [q.data]);
  const list = status === 'all' ? all : all.filter(s => s.status === status);
  const open = all.find(s => s.id === openId) ?? null;
  const statuses = ['all', ...Array.from(new Set(all.map(s => s.status)))];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {statuses.map(s => (
          <button key={s} onClick={() => setStatus(s)} data-testid={`filter-status-${s}`}
            className={`px-3 py-1 rounded-full text-xs border capitalize transition ${status === s ? 'bg-primary text-primary-foreground border-primary' : 'hover:border-primary/50'}`}>
            {s}{s !== 'all' && ` · ${all.filter(x => x.status === s).length}`}
          </button>
        ))}
      </div>
      {q.isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}</div>
        : q.isError ? <div className="flex items-center gap-3 text-sm text-destructive py-6"><AlertTriangle className="w-4 h-4" />{errMsg(q.error, 'Could not load submissions.')}<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>
          : list.length === 0 ? (
            <div className="text-center py-16 rounded-xl border border-dashed space-y-2">
              <Inbox className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium">Nothing here yet</p>
              <p className="text-xs text-muted-foreground">Publish your form and share the link. New submissions land here for review.</p>
            </div>
          ) : (
            <div className="rounded-xl border divide-y bg-card">
              {list.map(s => (
                <button key={s.id} onClick={() => setOpenId(s.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/40" data-testid={`row-submission-${s.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{nameOf(s)}</p>
                    <p className="text-xs text-muted-foreground">{fmt(s.createdAt)}{s.preview ? ` · preliminary ${money(s.preview.total)}` : ''}</p>
                  </div>
                  <Badge variant={tone(s.status)} className="capitalize">{s.status}</Badge>
                </button>
              ))}
            </div>
          )}
      {q.hasNextPage && <Button variant="outline" className="w-full" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} data-testid="button-load-more">{q.isFetchingNextPage ? 'Loading…' : 'Load older'}</Button>}
      <ReviewSheet kind={kind} sub={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ReviewSheet({ kind, sub, onClose }: { kind: Kind; sub: WebsiteSubmission | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [cust, setCust] = useState({ name: '', email: '', phone: '', address: '', city: '', state: '', zip: '' });
  const [createEstimate, setCreateEstimate] = useState(false);
  const [area, setArea] = useState('');
  const [length, setLength] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setNotes(sub?.reviewNotes ?? ''); setErr(null); setArea(''); setLength('');
    setCust({ name: '', email: '', phone: '', address: '', city: '', state: '', zip: '' });
    setCreateEstimate(!!sub?.preview?.items?.length);
  }, [sub?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = useMutation({
    mutationFn: (action: 'approve' | 'decline' | 'review') => {
      const customer = Object.fromEntries(Object.entries(cust).filter(([, v]) => v.trim()));
      return reviewWebsiteSubmission(sub!.id, {
        action, notes,
        ...(kind === 'quote' && action === 'approve' ? {
          customer: Object.keys(customer).length ? ({ ...customer, name: cust.name.trim() || originalName(sub!) } as ReviewInput['customer']) : undefined, createEstimate: createEstimate && canEstimate,
          areaSqft: area ? Number(area) : undefined, lengthFt: length ? Number(length) : undefined,
        } : {}),
      });
    },
    onSuccess: () => { toast.success('Review saved'); setErr(null); qc.invalidateQueries({ queryKey: ['website-submissions', kind] }); },
    onError: e => setErr(errMsg(e, 'Could not save this review.')),
  });

  const snap = sub?.snapshot;
  const answers = sub?.payload?.answers ?? {};
  const measurements = (sub?.payload?.measurements ?? {}) as Record<string, Measurement>;
  const visibleIds = useMemo(() => snap ? new Set(visibleFlow(snap, answers).steps.map(s => s.id)) : new Set<string>(), [snap, answers]);
  const lat = typeof answers.lat === 'number' ? answers.lat : null, lng = typeof answers.lng === 'number' ? answers.lng : null;
  const canEstimate = !!sub?.preview?.items?.length || Number(area) > 0 || Number(length) > 0;
  const decided = sub?.status === 'approved' || sub?.status === 'declined';

  return (
    <Sheet open={!!sub} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {sub && snap && (
          <div className="space-y-6">
            <SheetHeader>
              <SheetTitle data-testid="text-submission-title">{nameOf(sub)}</SheetTitle>
              <SheetDescription>{snap.title} · received {fmt(sub.createdAt)} · <span className="capitalize">{sub.status}</span></SheetDescription>
            </SheetHeader>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Path and answers (original wording)</h3>
              <ol className="space-y-2">
                {snap.steps.map((s, i) => {
                  const shown = visibleIds.has(s.id);
                  const ms = measurements[s.id];
                  return (
                    <li key={s.id} className={`rounded-lg border p-3 ${shown ? '' : 'opacity-50 border-dashed'}`} data-testid={`review-step-${s.id}`}>
                      <p className="text-xs font-medium flex items-center gap-1.5"><span className="font-mono text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>{s.title}
                        {!shown && <Badge variant="outline" className="text-[10px]">Skipped by condition</Badge>}
                        {shown && s.kind === 'measurement' && !ms && <Badge variant="outline" className="text-[10px]">Skipped by customer</Badge>}</p>
                      {shown && s.questions.length > 0 && <dl className="mt-2 space-y-1">{s.questions.map(q => (
                        <div key={q.id} className="grid grid-cols-5 gap-2 text-sm"><dt className="col-span-2 text-muted-foreground">{q.label}</dt>
                          <dd className="col-span-3 whitespace-pre-wrap break-words">{displayAnswer(answers[q.id], q.id === 'serviceIds' ? sub.preview?.items.map(it => ({ value: String(it.serviceId), label: it.name })) : undefined)}</dd></div>
                      ))}</dl>}
                      {shown && s.kind === 'property' && lat != null && lng != null && (
                        <div className="mt-2 space-y-1"><PinMap center={{ lat, lng }} draggable={false} onMove={() => undefined} />
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{lat.toFixed(6)}, {lng.toFixed(6)} · pin {answers.pinConfirmed ? 'confirmed' : 'not confirmed'} by customer</p></div>
                      )}
                      {shown && ms && (
                        <div className="mt-2 space-y-1">
                          {ms.points.length > 0 && lat != null && lng != null && <DrawMap center={{ lat, lng }} mode={ms.mode} points={ms.points} readOnly />}
                          <p className="text-xs flex items-center gap-1"><Ruler className="w-3 h-3" />{measureValue(ms)?.toLocaleString() ?? '—'} {ms.mode === 'area' ? 'sq ft' : 'ft'} · {ms.source === 'approximate' || (!ms.points.length && ms.manual) ? <Badge variant="outline" className="text-[10px]">Approximate, customer estimated</Badge> : `drawn on map, ${ms.points.length} points`} · unverified</p>
                          {(ms.source === 'approximate' || (!ms.points.length && ms.manual)) && (
                            <div className="rounded-md bg-muted/50 p-2 text-xs space-y-1" data-testid={`approx-terms-${s.id}`}>
                              <p className="font-medium">{ms.acceptedTerms ? `Terms accepted by customer at submission, ${fmt(sub.createdAt)}` : 'Terms acceptance not recorded'}</p>
                              <p className="whitespace-pre-wrap text-muted-foreground">{s.approximateTerms?.trim() || APPROXIMATE_SIZE_TERMS}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>

            <AttachmentList sub={sub} />

            {sub.preview && (
              <section className="rounded-lg border p-3 space-y-1" data-testid="section-preview">
                <h3 className="text-sm font-semibold">Server price preview (preliminary)</h3>
                {sub.preview.items.map(it => <p key={it.serviceId} className="text-sm flex justify-between"><span>{it.name}</span><span>{money(it.price)}</span></p>)}
                <p className="text-sm font-semibold flex justify-between border-t pt-1"><span>Total</span><span>{money(sub.preview.total)}</span></p>
              </section>
            )}

            {(sub.customerId || sub.propertyId || sub.estimateId || sub.applicationId) && (
              <section className="flex flex-wrap gap-2">
                {sub.customerId && <Button asChild size="sm" variant="outline"><Link href={`/customers/${sub.customerId}`} data-testid="link-customer"><ExternalLink className="w-3.5 h-3.5 mr-1" />Customer</Link></Button>}
                {sub.propertyId && <Button asChild size="sm" variant="outline"><Link href={`/properties/${sub.propertyId}`} data-testid="link-property"><ExternalLink className="w-3.5 h-3.5 mr-1" />Property</Link></Button>}
                {sub.estimateId && <Button asChild size="sm" variant="outline"><Link href="/estimates" data-testid="link-estimate"><ExternalLink className="w-3.5 h-3.5 mr-1" />Draft estimate #{sub.estimateId}</Link></Button>}
                {sub.applicationId && <Button asChild size="sm" variant="outline"><Link href="/hiring" data-testid="link-application"><ExternalLink className="w-3.5 h-3.5 mr-1" />Hiring application #{sub.applicationId}</Link></Button>}
              </section>
            )}

            <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
              <h3 className="text-sm font-semibold">Review</h3>
              {kind === 'quote' && !decided && (<>
                <p className="text-xs text-muted-foreground">Fill in anything missing. These corrections are used for the CRM record only; the customer's original answers stay untouched.</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(cust) as (keyof typeof cust)[]).map(k => (
                    <Input key={k} placeholder={k === 'name' ? `name (blank keeps "${originalName(sub)}")` : k} className={`capitalize ${k === 'address' || k === 'name' ? 'col-span-2' : ''}`} value={cust[k]} onChange={e => setCust(c => ({ ...c, [k]: e.target.value }))} data-testid={`input-correct-${k}`} />
                  ))}
                  <Input type="number" placeholder="Verified sq ft" value={area} onChange={e => setArea(e.target.value)} data-testid="input-correct-area" />
                  <Input type="number" placeholder="Verified linear ft" value={length} onChange={e => setLength(e.target.value)} data-testid="input-correct-length" />
                </div>
                <label className={`flex items-start gap-2 text-sm ${canEstimate ? '' : 'opacity-50'}`}>
                  <Checkbox checked={createEstimate && canEstimate} disabled={!canEstimate} onCheckedChange={v => setCreateEstimate(v === true)} data-testid="checkbox-create-estimate" />
                  Create an unsent draft estimate (prices recalculated by the server from the verified or submitted measurement)
                </label>
              </>)}
              {kind === 'hiring' && <p className="text-xs text-muted-foreground">Marking reviewed does not hire anyone. Stage changes and hires happen on the Hiring page.</p>}
              <Textarea rows={3} placeholder="Reviewer notes" value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-review-notes" />
              {err && <p className="text-sm text-destructive flex gap-1.5" data-testid="text-review-error"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{err}</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-1.5" disabled={m.isPending} onClick={() => m.mutate('review')} data-testid="button-mark-reviewed"><Eye className="w-4 h-4" />Mark reviewed</Button>
                {kind === 'quote' && !decided && <Button className="gap-1.5" disabled={m.isPending} onClick={() => m.mutate('approve')} data-testid="button-approve"><CheckCircle2 className="w-4 h-4" />Approve and add to CRM</Button>}
                {!decided && <Button variant="ghost" className="gap-1.5 text-destructive" disabled={m.isPending} onClick={() => m.mutate('decline')} data-testid="button-decline"><XCircle className="w-4 h-4" />Decline</Button>}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

type Attachment = { id: number | string; fileName: string; mimeType: string; sizeBytes: number; role: 'attachment' | 'resume' };
function AttachmentList({ sub }: { sub: WebsiteSubmission }) {
  const list = (Array.isArray((sub.payload as { attachments?: unknown }).attachments) ? (sub.payload as unknown as { attachments: Attachment[] }).attachments : []);
  const [busy, setBusy] = useState<string | number | null>(null);
  if (!list.length) return null;
  const download = async (f: Attachment) => {
    setBusy(f.id);
    try {
      const blob = await customFetch<Blob>(`/api/website-intake/submissions/${sub.id}/files/${encodeURIComponent(String(f.id))}`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = f.fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(errMsg(e, 'Download failed')); } finally { setBusy(null); }
  };
  return (
    <section className="space-y-2" data-testid="section-attachments">
      <h3 className="text-sm font-semibold flex items-center gap-1.5"><Paperclip className="w-4 h-4" />Files ({list.length})</h3>
      <ul className="divide-y rounded-md border">{list.map(f => (
        <li key={f.id} className="flex items-center gap-3 p-2.5" data-testid={`row-attachment-${f.id}`}>
          <div className="flex-1 min-w-0"><p className="text-sm truncate">{f.fileName}</p>
            <p className="text-xs text-muted-foreground">{f.role === 'resume' ? 'Resume' : 'Attachment'} · {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB</p></div>
          <Button size="sm" variant="ghost" className="gap-1" disabled={busy === f.id} onClick={() => download(f)} aria-label={`Download ${f.fileName}`} data-testid={`button-download-attachment-${f.id}`}>
            <Download className="w-4 h-4" />{busy === f.id ? '…' : 'Download'}</Button>
        </li>))}</ul>
    </section>
  );
}
