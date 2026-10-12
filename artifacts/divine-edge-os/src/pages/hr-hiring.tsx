/**
 * Private hiring workspace — owner and designated HR only.
 * All stage changes are human decisions; nothing is ranked or decided automatically.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Lock, Plus, AlertTriangle, FileText, Download, Upload, UserCheck, Copy, ExternalLink, Briefcase, Pencil, Users } from 'lucide-react';
import HrAccessSettings from '@/components/hr/HrAccessSettings';
import { FieldInputs, FieldsEditor, cleanFields, formatAnswer } from '@/components/hr/HrFields';
import {
  STAGES, stageLabel, hrErr, fmtBytes, validateDoc, missingRequired, downloadHrDocument, ACCEPTED_DOCS,
  useHrMeta, useHrSettings, useSaveHrSettings, usePostings, useSavePosting, useApplications, useApplication,
  useCreateApplication, useUpdateApplication, useHireApplicant, useUploadHrDocument, useHrAccess, useHrScope,
  type Stage, type Posting, type FormField, type AnswerValue, type HrSettings,
} from '@/components/hr/hrApi';

const fmtDate = (s: string | null | undefined) => { try { return s ? format(new Date(s), 'MMM d, yyyy h:mm a') : '—'; } catch { return '—'; } };
const stageTone: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  applied: 'outline', screening: 'secondary', interview: 'secondary', offer: 'default', declined: 'destructive', withdrawn: 'outline',
};

function ErrorRow({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return <div className="flex items-center gap-3 text-sm text-destructive py-6"><AlertTriangle className="w-4 h-4" />{msg}<Button size="sm" variant="outline" onClick={onRetry}>Retry</Button></div>;
}
const Skeleton = ({ rows = 4 }: { rows?: number }) => <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />)}</div>;

export default function HrHiringPage() {
  const meta = useHrMeta();
  const allowed = !!(meta.data?.hasHrAccess || meta.data?.isOwner);
  const qc = useQueryClient();
  const [uid, tid] = useHrScope();
  // Drop any private HR cache belonging to a different user/tenant in this browser.
  useEffect(() => {
    qc.removeQueries({ predicate: q => q.queryKey[0] === 'hr' && (q.queryKey[1] !== uid || q.queryKey[2] !== tid) });
  }, [qc, uid, tid]);

  if (meta.isLoading) return <div className="p-6"><Skeleton /></div>;
  if (meta.isError) return <div className="p-6"><ErrorRow msg="Couldn’t check your HR access." onRetry={() => meta.refetch()} /></div>;
  if (!allowed) return (
    <div className="p-6 max-w-lg mx-auto text-center space-y-3 py-20" data-testid="text-hr-no-access">
      <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
      <h1 className="text-xl font-semibold">Hiring is private</h1>
      <p className="text-sm text-muted-foreground">Only the business owner and staff they designate for HR can view applicants. Ask the owner if you need access.</p>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Users className="w-6 h-6 text-primary" />Hiring</h1>
          <p className="text-sm text-muted-foreground">Applications, job postings, and your public careers page. Private to owner and HR.</p>
        </div>
        <Badge variant="outline" className="gap-1 w-fit"><Lock className="w-3 h-3" />{meta.data?.isOwner ? 'Owner' : 'HR access'}</Badge>
      </div>
      <Tabs defaultValue="applications">
        <TabsList>
          <TabsTrigger value="applications" data-testid="tab-applications">Applications</TabsTrigger>
          <TabsTrigger value="postings" data-testid="tab-postings">Postings</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-hiring-settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="applications" className="mt-4"><ApplicationsTab /></TabsContent>
        <TabsContent value="postings" className="mt-4"><PostingsTab /></TabsContent>
        <TabsContent value="settings" className="mt-4 space-y-6">
          <SettingsTab isOwner={!!meta.data?.isOwner} careersUrl={meta.data?.publicCareersUrl ?? null} />
          {meta.data?.isOwner && <HrAccessSettings />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Applications ───────────────────────────────────────────────────────── */
function ApplicationsTab() {
  const [stage, setStage] = useState('');
  const [postingId, setPostingId] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const postings = usePostings();
  const apps = useApplications(stage, postingId);
  const list = apps.data?.applications ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 space-y-0">
        <div className="flex flex-wrap gap-2">
          <Select value={stage || 'all'} onValueChange={v => setStage(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-40" data-testid="select-filter-stage"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All stages</SelectItem>{STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={postingId || 'all'} onValueChange={v => setPostingId(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-48" data-testid="select-filter-posting"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All postings</SelectItem>
              {(postings.data?.postings ?? []).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button className="gap-1.5" onClick={() => setNewOpen(true)} data-testid="button-new-application"><Plus className="w-4 h-4" />Add applicant</Button>
      </CardHeader>
      <CardContent>
        {apps.isLoading ? <Skeleton /> : apps.isError ? <ErrorRow msg={hrErr(apps.error, 'Couldn’t load applications.')} onRetry={() => apps.refetch()} />
          : list.length === 0 ? (
            <div className="text-center py-12 space-y-2"><Briefcase className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium">No applications{stage || postingId ? ' match these filters' : ' yet'}</p>
              <p className="text-xs text-muted-foreground">Share your careers page from Settings, or add an applicant you met in person.</p></div>
          ) : (
            <div className="divide-y">
              {list.map(a => (
                <button key={a.id} onClick={() => setOpenId(a.id)} className="w-full text-left py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 hover:bg-muted/40 px-2 rounded-md" data-testid={`row-application-${a.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{a.email} · {a.phone}</p>
                  </div>
                  <p className="text-xs text-muted-foreground sm:w-44 truncate">{a.postingTitle ?? 'General application'}</p>
                  <p className="text-xs text-muted-foreground sm:w-28">{a.source === 'staff' ? 'Staff entry' : 'Careers page'}</p>
                  <div className="flex items-center gap-2 sm:w-40 sm:justify-end">
                    {a.userId && <Badge variant="secondary">Hired</Badge>}
                    <Badge variant={stageTone[a.stage] ?? 'outline'}>{stageLabel(a.stage)}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
      </CardContent>
      <ApplicationSheet id={openId} onClose={() => setOpenId(null)} />
      <NewApplicationDialog open={newOpen} onOpenChange={setNewOpen} postings={postings.data?.postings ?? []} />
    </Card>
  );
}

function ApplicationSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useApplication(id);
  const update = useUpdateApplication();
  const upload = useUploadHrDocument();
  const hire = useHireApplicant();
  const meta = useHrMeta();
  const staff = useHrAccess(!!meta.data?.isOwner && id != null);
  const [stage, setStage] = useState<Stage>('applied');
  const [notes, setNotes] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [hireOpen, setHireOpen] = useState(false);
  const [linkUser, setLinkUser] = useState('new');
  const [hiredUserId, setHiredUserId] = useState<number | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const isOwner = !!meta.data?.isOwner;
  const fileRef = useRef<HTMLInputElement>(null);
  const initFor = useRef<number | null>(null);
  const app = q.data?.application;

  useEffect(() => {
    if (app && initFor.current !== app.id) {
      initFor.current = app.id;
      setStage(app.stage); setNotes(app.notes ?? ''); setHiredUserId(app.userId ?? null); setNeedsSetup(!!app.pendingAccountSetup);
    }
  }, [app]);
  useEffect(() => { if (id == null) initFor.current = null; }, [id]);

  const save = () => {
    if (!app) return;
    update.mutate({ id: app.id, data: { stage, notes } }, {
      onSuccess: () => { toast.success('Saved'); q.refetch(); },
      onError: e => toast.error(hrErr(e, 'Could not save')),
    });
  };
  const onFile = (f: File | undefined) => {
    if (!f || !app) return;
    const err = validateDoc(f);
    if (err) { toast.error(err); return; }
    upload.mutate({ id: app.id, file: f, title: docTitle.trim() || f.name }, {
      onSuccess: () => { toast.success('Document attached'); setDocTitle(''); },
      onError: e => toast.error(hrErr(e, 'Upload failed')),
    });
    if (fileRef.current) fileRef.current.value = '';
  };
  const doHire = () => {
    if (!app) return;
    hire.mutate({ id: app.id, existingUserId: linkUser !== 'new' ? Number(linkUser) : undefined }, {
      onSuccess: r => {
        setHiredUserId(r.userId); setNeedsSetup(!!r.needsAccountSetup);
        toast.success(r.needsAccountSetup ? 'Hire recorded. The account still needs owner setup.' : 'Hire recorded.');
        q.refetch();
      },
      onError: e => toast.error(hrErr(e, 'Could not record hire')),
      onSettled: () => setHireOpen(false),
    });
  };

  return (
    <Sheet open={id != null} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {q.isLoading ? <div className="pt-8"><Skeleton rows={6} /></div> : q.isError || !app ? (
          <div className="pt-8"><ErrorRow msg={hrErr(q.error, 'Couldn’t load this application.')} onRetry={() => q.refetch()} /></div>
        ) : (
          <div className="space-y-6">
            <SheetHeader>
              <SheetTitle data-testid="text-applicant-name">{app.fullName}</SheetTitle>
              <SheetDescription>{app.postingTitle ?? 'General application'} · received {fmtDate(app.createdAt)} · {app.source === 'staff' ? 'staff entry' : 'careers page'}</SheetDescription>
            </SheetHeader>

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Email</p><a className="underline break-all" href={`mailto:${app.email}`}>{app.email}</a></div>
              <div><p className="text-xs text-muted-foreground">Phone</p><a className="underline" href={`tel:${app.phone}`}>{app.phone}</a></div>
              <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Consent</p>
                <p>{app.consentAt ? `Storage and hiring-contact consent given ${fmtDate(app.consentAt)}` : app.source === 'staff' ? 'Entered by staff' : 'Not recorded'}</p></div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Answers</h3>
              {(app.fieldSnapshot ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No additional questions were asked.</p> : (
                <dl className="space-y-2">{app.fieldSnapshot.map(f => (
                  <div key={f.id} className="rounded-md border p-2.5"><dt className="text-xs text-muted-foreground">{f.label}</dt><dd className="text-sm whitespace-pre-wrap">{formatAnswer(app.answers?.[f.id])}</dd></div>
                ))}</dl>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Stage and notes</h3>
              <p className="text-xs text-muted-foreground">Stage changes are your decision and are recorded in the audit log.</p>
              <Select value={stage} onValueChange={v => setStage(v as Stage)}>
                <SelectTrigger data-testid="select-stage"><SelectValue /></SelectTrigger>
                <SelectContent>{STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <Textarea rows={4} placeholder="Private hiring notes" value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-notes" />
              <Button onClick={save} disabled={update.isPending} data-testid="button-save-application">{update.isPending ? 'Saving…' : 'Save'}</Button>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Documents</h3>
              {(q.data?.documents ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No documents attached.</p> : (
                <ul className="divide-y rounded-md border">{q.data!.documents.map(d => (
                  <li key={d.id} className="flex items-center gap-3 p-2.5" data-testid={`row-document-${d.id}`}>
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0"><p className="text-sm truncate">{d.title}</p><p className="text-xs text-muted-foreground truncate">{d.fileName} · {fmtBytes(d.sizeBytes)}</p></div>
                    <Button size="icon" variant="ghost" aria-label="Download" data-testid={`button-download-${d.id}`}
                      onClick={() => downloadHrDocument(d).catch(e => toast.error(hrErr(e, 'Download failed')))}><Download className="w-4 h-4" /></Button>
                  </li>))}</ul>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Input placeholder="Document title (optional)" value={docTitle} onChange={e => setDocTitle(e.target.value)} data-testid="input-doc-title" />
                <input ref={fileRef} type="file" accept={ACCEPTED_DOCS} className="hidden" onChange={e => onFile(e.target.files?.[0])} data-testid="input-doc-file" />
                <Button variant="outline" className="gap-1.5 shrink-0" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid="button-upload-doc">
                  <Upload className="w-4 h-4" />{upload.isPending ? 'Uploading…' : 'Attach file'}</Button>
              </div>
              <p className="text-xs text-muted-foreground">PDF, image, or .docx up to 10 MB. Documents stay private to HR; after hiring they remain private to the employee record and are not shared by default.</p>
            </section>

            <section className="space-y-2 rounded-md border p-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><UserCheck className="w-4 h-4" />Hire</h3>
              {hiredUserId ? (<>
                {needsSetup ? (
                  isOwner
                    ? <p className="text-sm" data-testid="text-hire-setup">Hired. Their login isn’t active yet. Open the employee record and use <strong>Set password and activate</strong> to give them access.</p>
                    : <p className="text-sm" data-testid="text-hire-setup">Hired. The business owner still needs to activate this employee’s login.</p>
                ) : <p className="text-sm" data-testid="text-hire-setup">Hired and linked to an active employee record.</p>}
                <Button asChild variant="outline" size="sm"><Link href={`/employees/${hiredUserId}`} data-testid="link-view-employee">{isOwner && needsSetup ? 'Open employee record' : 'View employee'}</Link></Button>
              </>) : (<>
                <p className="text-xs text-muted-foreground">Recording a hire creates an inactive staff account and onboarding profile with no password, or links someone already on staff. Only the owner can activate the login.</p>
                <Button size="sm" onClick={() => setHireOpen(true)} data-testid="button-hire">Record hire…</Button>
              </>)}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Audit history</h3>
              {(q.data?.audit ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No changes recorded yet.</p> : (
                <ol className="space-y-1.5">{q.data!.audit.map(a => (
                  <li key={a.id} className="text-xs flex gap-2"><span className="text-muted-foreground shrink-0 w-36">{fmtDate(a.createdAt)}</span>
                    <span><strong>{a.actorName ?? 'System'}</strong> {a.action.replace(/_/g, ' ')}</span></li>
                ))}</ol>
              )}
            </section>
          </div>
        )}

        <AlertDialog open={hireOpen} onOpenChange={setHireOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hire {app?.fullName}?</AlertDialogTitle>
              <AlertDialogDescription>This is your hiring decision and will be recorded. A new account stays inactive until the owner opens the employee record and uses Set password and activate.</AlertDialogDescription>
            </AlertDialogHeader>
            {meta.data?.isOwner && (
              <Select value={linkUser} onValueChange={setLinkUser}>
                <SelectTrigger data-testid="select-hire-link"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create new pending staff account</SelectItem>
                  {(staff.data?.members ?? []).map(m => <SelectItem key={m.id} value={String(m.id)}>Link to {m.name} ({m.email})</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={doHire} disabled={hire.isPending} data-testid="button-confirm-hire">Confirm hire</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function NewApplicationDialog({ open, onOpenChange, postings }: { open: boolean; onOpenChange: (o: boolean) => void; postings: Posting[] }) {
  const settings = useHrSettings(open);
  const create = useCreateApplication();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [postingId, setPostingId] = useState('general');
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const posting = postings.find(p => String(p.id) === postingId);
  const fields: FormField[] = posting?.fields?.length ? posting.fields : (settings.data?.applicationFields ?? []);

  const reset = () => { setFullName(''); setEmail(''); setPhone(''); setPostingId('general'); setAnswers({}); setNotes(''); setErr(null); };
  const submit = () => {
    if (!fullName.trim() || !phone.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Full name, a valid email, and phone are required.'); return; }
    const miss = missingRequired(fields, answers);
    if (miss.length) { setErr(`Required: ${miss.join(', ')}`); return; }
    setErr(null);
    create.mutate({ fullName: fullName.trim(), email: email.trim(), phone: phone.trim(), postingId: posting?.id, answers, notes: notes.trim(), source: 'staff' }, {
      onSuccess: () => { toast.success('Applicant added'); reset(); onOpenChange(false); },
      onError: e => setErr(hrErr(e, 'Could not add applicant')),
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add applicant</DialogTitle><DialogDescription>For someone who applied in person or by phone.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Select value={postingId} onValueChange={v => { setPostingId(v); setAnswers({}); }}>
            <SelectTrigger data-testid="select-new-posting"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="general">General application</SelectItem>{postings.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.title}{p.status === 'closed' ? ' (closed)' : ''}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Full name *" value={fullName} onChange={e => setFullName(e.target.value)} data-testid="input-new-fullname" />
          <Input type="email" placeholder="Email *" value={email} onChange={e => setEmail(e.target.value)} data-testid="input-new-email" />
          <Input type="tel" placeholder="Phone *" value={phone} onChange={e => setPhone(e.target.value)} data-testid="input-new-phone" />
          {settings.isLoading && !posting ? <Skeleton rows={2} /> : settings.isError && !posting
            ? <p className="text-xs text-destructive">Couldn’t load general application questions.</p>
            : <FieldInputs fields={fields} answers={answers} onChange={setAnswers} idPrefix="new" />}
          <Textarea rows={3} placeholder="Private notes" value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-new-notes" />
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter><Button onClick={submit} disabled={create.isPending} data-testid="button-submit-new-application">{create.isPending ? 'Saving…' : 'Add applicant'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Postings ───────────────────────────────────────────────────────────── */
function PostingsTab() {
  const q = usePostings();
  const [editing, setEditing] = useState<Posting | 'new' | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div><CardTitle>Job postings</CardTitle><CardDescription>Open postings appear on your public careers page. Posting questions replace the general questions.</CardDescription></div>
        <Button className="gap-1.5" onClick={() => setEditing('new')} data-testid="button-new-posting"><Plus className="w-4 h-4" />New posting</Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton /> : q.isError ? <ErrorRow msg={hrErr(q.error, 'Couldn’t load postings.')} onRetry={() => q.refetch()} />
          : (q.data?.postings ?? []).length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">No postings yet. Applicants can still send a general application when hiring is enabled.</p>
          : <ul className="divide-y">{q.data!.postings.map(p => (
            <li key={p.id} className="py-3 flex items-center gap-3" data-testid={`row-posting-${p.id}`}>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.title}</p>
                <p className="text-xs text-muted-foreground">{p.fields.length} question{p.fields.length === 1 ? '' : 's'} · created {fmtDate(p.createdAt)}</p></div>
              <Badge variant={p.status === 'open' ? 'default' : 'outline'}>{p.status === 'open' ? 'Open' : 'Closed'}</Badge>
              <Button size="icon" variant="ghost" onClick={() => setEditing(p)} aria-label="Edit posting" data-testid={`button-edit-posting-${p.id}`}><Pencil className="w-4 h-4" /></Button>
            </li>))}</ul>}
      </CardContent>
      {editing && <PostingDialog posting={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function PostingDialog({ posting, onClose }: { posting: Posting | null; onClose: () => void }) {
  const save = useSavePosting();
  const [title, setTitle] = useState(posting?.title ?? '');
  const [description, setDescription] = useState(posting?.description ?? '');
  const [open, setOpen] = useState(posting ? posting.status === 'open' : true);
  const [fields, setFields] = useState<FormField[]>(posting?.fields ?? []);
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    if (!title.trim()) { setErr('Title is required.'); return; }
    const cleaned = cleanFields(fields);
    if (typeof cleaned === 'string') { setErr(cleaned); return; }
    save.mutate({ id: posting?.id, data: { title: title.trim(), description: description.trim(), status: open ? 'open' : 'closed', fields: cleaned } }, {
      onSuccess: () => { toast.success('Posting saved'); onClose(); },
      onError: e => setErr(hrErr(e, 'Could not save posting')),
    });
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{posting ? 'Edit posting' : 'New posting'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Job title *" value={title} onChange={e => setTitle(e.target.value)} data-testid="input-posting-title" />
          <Textarea rows={5} placeholder="Description — duties, schedule, pay range, requirements" value={description} onChange={e => setDescription(e.target.value)} data-testid="input-posting-description" />
          <label className="flex items-center gap-2 text-sm"><Switch checked={open} onCheckedChange={setOpen} data-testid="switch-posting-open" />Open for applications</label>
          <div className="space-y-2"><p className="text-sm font-medium">Questions for this posting</p>
            <p className="text-xs text-muted-foreground">If you add questions here, they replace the general application questions for this posting.</p>
            <FieldsEditor fields={fields} onChange={setFields} /></div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter><Button onClick={submit} disabled={save.isPending} data-testid="button-save-posting">{save.isPending ? 'Saving…' : 'Save posting'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Settings ───────────────────────────────────────────────────────────── */
function SettingsTab({ isOwner, careersUrl }: { isOwner: boolean; careersUrl: string | null }) {
  const q = useHrSettings();
  const save = useSaveHrSettings();
  const [draft, setDraft] = useState<HrSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (q.data && !draft) setDraft(q.data); }, [q.data, draft]);

  if (q.isLoading || (!draft && !q.isError)) return <Card><CardContent className="pt-6"><Skeleton /></CardContent></Card>;
  if (q.isError || !draft) return <Card><CardContent className="pt-6"><ErrorRow msg={hrErr(q.error, 'Couldn’t load hiring settings.')} onRetry={() => q.refetch()} /></CardContent></Card>;

  const iframe = careersUrl ? `<iframe src="${careersUrl}" title="Careers" style="width:100%;max-width:640px;height:900px;border:0" loading="lazy"></iframe>` : '';
  const copy = (t: string, l: string) => navigator.clipboard.writeText(t).then(() => toast.success(`${l} copied`));
  const submit = () => {
    const cleaned = cleanFields(draft.applicationFields);
    if (typeof cleaned === 'string') { setErr(cleaned); return; }
    setErr(null);
    const data: Partial<HrSettings> = { applicationIntro: draft.applicationIntro, privacyNotice: draft.privacyNotice, applicationFields: cleaned };
    if (isOwner) data.publicHiringEnabled = draft.publicHiringEnabled;
    save.mutate(data, { onSuccess: d => { setDraft(d ?? draft); toast.success('Hiring settings saved'); }, onError: e => setErr(hrErr(e, 'Could not save')) });
  };

  return (<>
    <Card>
      <CardHeader><CardTitle>Public careers page</CardTitle><CardDescription>One public page where anyone can apply. Share the link or embed it on your website.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={draft.publicHiringEnabled} disabled={!isOwner} onCheckedChange={v => setDraft({ ...draft, publicHiringEnabled: v })} data-testid="switch-public-hiring" />
          Accept applications online {!isOwner && <span className="text-xs text-muted-foreground">(owner only)</span>}
        </label>
        {careersUrl ? (<>
          <div className="rounded-md bg-muted/50 border p-2.5 font-mono text-xs break-all" data-testid="text-careers-url">{careersUrl}</div>
          <Textarea readOnly rows={3} className="font-mono text-xs" value={iframe} data-testid="text-careers-iframe" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(careersUrl, 'Link')} data-testid="button-copy-careers-link"><Copy className="w-3.5 h-3.5" />Copy link</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(iframe, 'Embed code')} data-testid="button-copy-careers-iframe"><Copy className="w-3.5 h-3.5" />Copy embed code</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(careersUrl, '_blank')} data-testid="button-open-careers"><ExternalLink className="w-3.5 h-3.5" />Open</Button>
          </div>
        </>) : <p className="text-sm text-muted-foreground">The public careers link isn’t available yet.</p>}
        <div className="space-y-1.5"><p className="text-sm font-medium">Intro</p>
          <Textarea rows={3} placeholder="Tell applicants about working with you" value={draft.applicationIntro} onChange={e => setDraft({ ...draft, applicationIntro: e.target.value })} data-testid="input-application-intro" /></div>
        <div className="space-y-1.5"><p className="text-sm font-medium">Privacy notice</p>
          <Textarea rows={3} placeholder="How you store and use applicant information" value={draft.privacyNotice} onChange={e => setDraft({ ...draft, privacyNotice: e.target.value })} data-testid="input-privacy-notice" /></div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>General application questions</CardTitle><CardDescription>Asked on general applications and on postings without their own questions. Name, email, and phone are always required.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <FieldsEditor fields={draft.applicationFields} onChange={f => setDraft({ ...draft, applicationFields: f })} />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button onClick={submit} disabled={save.isPending} data-testid="button-save-hiring-settings">{save.isPending ? 'Saving…' : 'Save hiring settings'}</Button>
      </CardContent>
    </Card>
  </>);
}
