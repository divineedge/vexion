import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft, Printer, Plus, FileText, Download, Upload, Eye, EyeOff, CheckCircle2, ClipboardList, MapPin, Clock, History, Lock, ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmpFormFields, displayEmpAnswer } from '@/components/hr/EmpFormFields';
import {
  useHrMeta, useHrEmployee, useAccountSetup, useHrAudit, useSaveProfile, useAddHistory, useShareHistory, useAcknowledgeHistory,
  useUploadDocument, useShareDocument, downloadHrDocument, useAssignForm, useSaveAssignment, useEmployeeFormTemplates,
  templateActive, fetchActivity, evidenceItems, evidenceSummary, validateEmpAnswers, hrErr, fmtBytes, historyLabel,
  EMPLOYMENT_STATUSES, HISTORY_TYPES, ALLOWED_UPLOAD, MAX_UPLOAD,
  type HrEmployeeDetail, type HrProfile, type HistoryType, type EmpAnswer, type HrAssignment, type HrActivity, type GpsPoint, type HrHistoryEntry,
} from '@/lib/hr';

const d = (s: string | null | undefined) => (s ? format(new Date(s.length === 10 ? `${s}T12:00:00` : s), 'MMM d, yyyy') : '—');
const dt = (s: string | null | undefined) => (s ? format(new Date(s), 'MMM d, yyyy h:mm a') : '—');
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
const gps = (p: GpsPoint | null | undefined) => p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.accuracy != null ? ` (±${Math.round(p.accuracy)} m)` : ''}` : 'GPS unknown';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const typeTone: Record<string, string> = {
  yellow_card: 'bg-amber-50 text-amber-800 border-amber-200', incident: 'bg-rose-50 text-rose-700 border-rose-200',
  complaint: 'bg-rose-50 text-rose-700 border-rose-200', review: 'bg-sky-50 text-sky-700 border-sky-200',
  correction: 'bg-violet-50 text-violet-700 border-violet-200',
};

const PROFILE_KEYS: Array<keyof HrProfile> = ['legalName', 'phone', 'personalEmail', 'address', 'jobTitle', 'department', 'hireDate', 'endDate', 'employmentStatus', 'emergencyContactName', 'emergencyContactPhone', 'notes'];

function AccountSetupCard({ id, name }: { id: number; name: string }) {
  const setup = useAccountSetup(id);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [confirm, setConfirm] = useState(false);
  const tooShort = pw.length < 12, tooLong = pw.length > 128, mismatch = pw !== pw2;
  const run = () => setup.mutate(pw, {
    onSuccess: () => { setPw(''); setPw2(''); setConfirm(false); toast.success('Password set and account activated'); },
    onError: e => { setConfirm(false); toast.error(hrErr(e, 'Could not set up this account')); },
  });
  return (
    <Card className="border-amber-300/70 bg-amber-50/40" data-testid="card-account-setup">
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Lock className="w-4 h-4" /> Set password and activate account</CardTitle>
        <CardDescription>{name} is a pending hire without a login. Owner only. Share the password privately; it isn't shown again, printed, or logged.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <form className="grid sm:grid-cols-2 gap-3" onSubmit={ev => { ev.preventDefault(); if (!tooShort && !tooLong && !mismatch) setConfirm(true); }}>
          <div className="space-y-1"><label className="text-xs font-medium" htmlFor="setup-pw">New password</label>
            <Input id="setup-pw" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} maxLength={128} data-testid="input-setup-password" /></div>
          <div className="space-y-1"><label className="text-xs font-medium" htmlFor="setup-pw2">Confirm password</label>
            <Input id="setup-pw2" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} maxLength={128} data-testid="input-setup-password-confirm" /></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{pw && tooShort ? 'At least 12 characters.' : pw2 && mismatch ? 'Passwords don\u2019t match.' : '12–128 characters.'}</p>
          <div className="sm:col-span-2"><Button type="submit" disabled={tooShort || tooLong || mismatch || setup.isPending} data-testid="button-account-setup">{setup.isPending ? 'Activating…' : 'Set password and activate'}</Button></div>
        </form>
      </CardContent>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Activate {name}'s login?</AlertDialogTitle>
            <AlertDialogDescription>This sets their password and lets them sign in. The action is recorded in the audit log without the password.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={ev => { ev.preventDefault(); run(); }} disabled={setup.isPending}>Activate</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ProfileCard({ id, data }: { id: number; data: HrEmployeeDetail }) {
  const save = useSaveProfile(id);
  const initFor = useRef<number | null>(null);
  const [p, setP] = useState<HrProfile>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (initFor.current === id && dirty) return;
    initFor.current = id;
    const src = data.profile ?? {};
    const next: HrProfile = {};
    for (const k of PROFILE_KEYS) (next as Record<string, unknown>)[k] = (src as Record<string, unknown>)[k] ?? '';
    setP(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, data.profile]);
  const set = (k: keyof HrProfile, v: string) => { setP(x => ({ ...x, [k]: v })); setDirty(true); };
  const field = (k: keyof HrProfile, label: string, type = 'text') => (
    <div className="space-y-1.5"><label className="text-sm font-medium">{label}</label><Input type={type} value={String(p[k] ?? '')} onChange={e => set(k, e.target.value)} data-testid={`input-profile-${k}`} /></div>
  );
  const submit = () => {
    const out: Record<string, string | null> = {};
    for (const k of PROFILE_KEYS) { const v = String(p[k] ?? '').trim(); out[k] = v || null; }
    save.mutate(out as HrProfile, { onSuccess: () => { setDirty(false); toast.success('Personnel record saved. Login access was not changed.'); }, onError: e => toast.error(hrErr(e, 'Could not save profile')) });
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Personnel record</CardTitle><CardDescription>Changes the HR record only. It never changes login credentials or deactivates the account.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          {field('legalName', 'Legal name')}{field('jobTitle', 'Job title')}
          {field('department', 'Department')}
          <div className="space-y-1.5"><label className="text-sm font-medium">Employment status</label>
            <Select value={String(p.employmentStatus || '')} onValueChange={v => set('employmentStatus', v)}>
              <SelectTrigger data-testid="select-profile-status"><SelectValue placeholder="Not set" /></SelectTrigger>
              <SelectContent>{EMPLOYMENT_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {field('hireDate', 'Hire date', 'date')}{field('endDate', 'End date', 'date')}
          {field('phone', 'Phone', 'tel')}{field('personalEmail', 'Personal email', 'email')}
          <div className="sm:col-span-2">{field('address', 'Address')}</div>
          {field('emergencyContactName', 'Emergency contact')}{field('emergencyContactPhone', 'Emergency contact phone', 'tel')}
        </div>
        <div className="space-y-1.5"><label className="text-sm font-medium flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Private HR notes</label><Textarea rows={3} value={String(p.notes ?? '')} onChange={e => set('notes', e.target.value)} /><p className="text-xs text-muted-foreground">Never shown to the employee.</p></div>
        {data.employee.hourlyRate != null && <p className="text-sm text-muted-foreground">Hourly rate: <span className="font-medium text-foreground tabular-nums">${Number(data.employee.hourlyRate).toFixed(2)}</span> (edit in Settings → Team)</p>}
        <div className="flex justify-end gap-2">
          {dirty && <span className="text-xs text-muted-foreground self-center">Unsaved changes</span>}
          <Button onClick={submit} disabled={!dirty || save.isPending} data-testid="button-save-profile">{save.isPending ? 'Saving…' : 'Save record'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryList({ id, data, isSelf, onAdd }: { id: number; data: HrEmployeeDetail; isSelf: boolean; onAdd: () => void }) {
  const share = useShareHistory(id);
  const ack = useAcknowledgeHistory(id);
  const [ackTarget, setAckTarget] = useState<HrHistoryEntry | null>(null);
  const docsFor = (hid: number) => data.documents.filter(x => x.historyEntryId === hid);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{data.canManage ? 'Records are append-only. To fix a mistake, add a correction.' : 'Records your employer has shared with you.'}</p>
        {data.canManage && <Button size="sm" className="gap-2" onClick={onAdd} data-testid="button-add-history"><Plus className="w-4 h-4" /> Add record</Button>}
      </div>
      {data.history.length === 0 ? (
        <Card><CardContent className="p-10 text-center space-y-2"><History className="w-9 h-9 mx-auto text-muted-foreground/50" /><p className="font-medium">No records yet</p></CardContent></Card>
      ) : data.history.map(h => (
        <Card key={h.id} data-testid={`history-${h.id}`}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start gap-2 flex-wrap">
              <Badge variant="outline" className={`text-xs ${typeTone[h.type] ?? ''}`}>{historyLabel(h.type)}</Badge>
              <span className="font-medium flex-1 min-w-0">{h.title}</span>
              {data.canManage && (h.sharedWithEmployee ? <Badge variant="outline" className="text-xs gap-1"><Eye className="w-3 h-3" /> Shared</Badge> : <Badge variant="outline" className="text-xs gap-1 text-muted-foreground"><EyeOff className="w-3 h-3" /> Private</Badge>)}
            </div>
            <p className="text-xs text-muted-foreground">Occurred {d(h.occurredOn)} · recorded {dt(h.createdAt)}{h.createdByName ? ` by ${h.createdByName}` : ''}</p>
            {h.notes && <p className="text-sm whitespace-pre-wrap">{h.notes}</p>}
            {h.formSnapshot?.fields?.length ? (
              <div className="rounded-md border bg-muted/20 p-3 space-y-1">
                <p className="text-xs font-medium">{h.formSnapshot.name ?? 'Form'}</p>
                {h.formSnapshot.fields.map(f => <p key={f.id} className="text-xs"><span className="text-muted-foreground">{f.label}:</span> {displayEmpAnswer(f, h.formData?.[f.id])}</p>)}
              </div>
            ) : null}
            <EvidenceView evidence={h.evidence} />
            {docsFor(h.id).length > 0 && <p className="text-xs text-muted-foreground">Attachments: {docsFor(h.id).map(x => x.title).join(', ')}</p>}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {h.acknowledgedAt && <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Acknowledged {dt(h.acknowledgedAt)}</span>}
              {isSelf && h.sharedWithEmployee && !h.acknowledgedAt && <Button size="sm" variant="outline" onClick={() => setAckTarget(h)} data-testid={`button-ack-${h.id}`}>Acknowledge</Button>}
              {data.canManage && <Button size="sm" variant="ghost" className="ml-auto text-xs" disabled={share.isPending}
                onClick={() => share.mutate({ id: h.id, shared: !h.sharedWithEmployee }, { onSuccess: () => toast.success(h.sharedWithEmployee ? 'Hidden from employee' : 'Shared with employee'), onError: e => toast.error(hrErr(e, 'Could not change sharing')) })}>
                {h.sharedWithEmployee ? 'Make private' : 'Share with employee'}</Button>}
            </div>
          </CardContent>
        </Card>
      ))}
      <AlertDialog open={!!ackTarget} onOpenChange={o => { if (!o) setAckTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Acknowledge this record?</AlertDialogTitle>
            <AlertDialogDescription>Acknowledging confirms you have seen it. It does not mean you agree with it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (ackTarget) ack.mutate(ackTarget.id, { onSuccess: () => toast.success('Acknowledged'), onError: e => toast.error(hrErr(e, 'Could not acknowledge')) }); setAckTarget(null); }}>Acknowledge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const gpsText = (g: GpsPoint | null) => g ? `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}` : 'GPS unknown';
const tsText = (v: string | null) => v ? dt(v) : '—';
function EvidenceView({ evidence }: { evidence: unknown }) {
  const items = evidenceItems(evidence);
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="rounded-md border bg-muted/20">
      <button type="button" className="w-full text-left text-xs px-3 py-2 font-medium flex items-center justify-between" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="button-toggle-evidence">
        <span>{items.length} clock/timer record{items.length === 1 ? '' : 's'} — stored snapshot</span><span className="text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-2">
          {items.map(e => { const s = evidenceSummary(e); const adjusted = s.effStart !== s.rawStart || s.effEnd !== s.rawEnd; return (
            <div key={`${e.kind}-${e.id}`} className="text-xs space-y-0.5">
              <p className="font-medium">{s.label}{s.jobId ? ` · job #${s.jobId}` : ''}</p>
              <p><span className="text-muted-foreground">Recorded:</span> {tsText(s.rawStart)} → {tsText(s.rawEnd)}</p>
              {adjusted && <p><span className="text-muted-foreground">Adjusted:</span> {tsText(s.effStart)} → {tsText(s.effEnd)}</p>}
              <p><span className="text-muted-foreground">Start GPS:</span> {gpsText(s.startGps)} · <span className="text-muted-foreground">Stop GPS:</span> {gpsText(s.endGps)}</p>
              {e.capturedAt && <p className="text-muted-foreground">Snapshot taken {dt(e.capturedAt)}</p>}
            </div>
          ); })}
          <p className="text-[11px] text-muted-foreground">As stored when the record was created; later edits to time entries do not change it. GPS is captured only at start/stop and is not proof of presence.</p>
        </div>
      )}
    </div>
  );
}
const evidenceHtml = (ev: unknown) => { const items = evidenceItems(ev); if (!items.length) return ''; return `<div class="muted" style="margin-top:4px"><i>Evidence (stored snapshot):</i>${items.map(e => { const s = evidenceSummary(e); return `<div>${esc(s.label)}${s.jobId ? ` · job #${s.jobId}` : ''} — recorded ${esc(tsText(s.rawStart))} → ${esc(tsText(s.rawEnd))}${s.effStart !== s.rawStart || s.effEnd !== s.rawEnd ? `; adjusted ${esc(tsText(s.effStart))} → ${esc(tsText(s.effEnd))}` : ''}; start GPS ${esc(gpsText(s.startGps))}; stop GPS ${esc(gpsText(s.endGps))}${e.capturedAt ? `; snapshot ${esc(dt(e.capturedAt))}` : ''}</div>`; }).join('')}<div>GPS is captured only at start/stop and is not proof of presence.</div></div>`; };

function AddHistorySheet({ id, open, onClose, evidence }: { id: number; open: boolean; onClose: () => void; evidence: { timeEntryIds: number[]; subTimerIds: number[] } }) {
  const add = useAddHistory(id);
  const templates = useEmployeeFormTemplates(open);
  const [type, setType] = useState<HistoryType>('note');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [occurredOn, setOccurredOn] = useState(today());
  const [shared, setShared] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [answers, setAnswers] = useState<Record<string, EmpAnswer>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) { setType(evidence.timeEntryIds.length || evidence.subTimerIds.length ? 'yellow_card' : 'note'); setTitle(''); setNotes(''); setOccurredOn(today()); setShared(false); setTemplateId(''); setAnswers({}); setErrors({}); }
  }, [open, evidence]);
  const tmpl = (templates.data ?? []).find(t => String(t.id) === templateId);
  const evCount = evidence.timeEntryIds.length + evidence.subTimerIds.length;
  const submit = () => {
    if (!title.trim()) { toast.error('Add a title'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) { toast.error('Pick the date it happened'); return; }
    if (type === 'custom_form' && !tmpl) { toast.error('Pick the employee form for a Form record'); return; }
    if (tmpl) { const e = validateEmpAnswers(tmpl.fields, answers); setErrors(e); if (Object.keys(e).length) { toast.error('Complete the required form questions'); return; } }
    add.mutate({
      type, title: title.trim(), notes: notes.trim(), occurredOn, sharedWithEmployee: shared,
      ...(tmpl ? { formTemplateId: tmpl.id, formData: answers } : {}),
      ...(evidence.timeEntryIds.length ? { timeEntryIds: evidence.timeEntryIds } : {}),
      ...(evidence.subTimerIds.length ? { subTimerIds: evidence.subTimerIds } : {}),
    }, { onSuccess: () => { toast.success('Record added'); onClose(); }, onError: e => toast.error(hrErr(e, 'Could not add record')) });
  };
  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-5"><SheetTitle>Add record</SheetTitle><SheetDescription>Records can't be edited or deleted after saving. Add a correction later if needed.</SheetDescription></SheetHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-sm font-medium">Type</label>
              <Select value={type} onValueChange={v => setType(v as HistoryType)}><SelectTrigger data-testid="select-history-type"><SelectValue /></SelectTrigger>
                <SelectContent>{HISTORY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Date it happened</label><Input type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Title</label><Input value={title} onChange={e => setTitle(e.target.value)} data-testid="input-history-title" /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Notes</label><Textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Attach employee form (optional)</label>
            <Select value={templateId || '__none__'} onValueChange={v => { setTemplateId(v === '__none__' ? '' : v); setAnswers({}); setErrors({}); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none__">— None —</SelectItem>{(templates.data ?? []).filter(templateActive).map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {tmpl && <div className="rounded-lg border p-4"><EmpFormFields idPrefix="hist" fields={tmpl.fields} answers={answers} errors={errors} onChange={(k, v) => setAnswers(a => ({ ...a, [k]: v }))} /></div>}
          {evCount > 0 && <p className="text-sm rounded-md border bg-muted/30 p-3">{evCount} clock/timer record{evCount === 1 ? '' : 's'} selected as evidence. The server saves a snapshot of them with this record.</p>}
          <label className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span><span className="text-sm font-medium block">Share with employee</span><span className="text-xs text-muted-foreground">Off by default. Private records are never visible to the employee.</span></span>
            <Switch checked={shared} onCheckedChange={setShared} />
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={add.isPending} data-testid="button-save-history">{add.isPending ? 'Saving…' : 'Save record'}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DocumentsTab({ id, data }: { id: number; data: HrEmployeeDetail }) {
  const upload = useUploadDocument(id);
  const share = useShareDocument(id);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [shared, setShared] = useState(false);
  const [hist, setHist] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const pick = (f: File | null) => {
    if (f && f.size > MAX_UPLOAD) { toast.error('Files must be 10 MB or smaller'); return; }
    if (f && !ALLOWED_UPLOAD.includes(f.type)) { toast.error('Upload a PDF, image, or Word (.docx) file'); return; }
    setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };
  const submit = () => {
    if (!file) { toast.error('Choose a file'); return; }
    upload.mutate({ file, title: title.trim() || file.name, shared, historyEntryId: hist ? Number(hist) : null }, {
      onSuccess: () => { toast.success('Document uploaded'); setOpen(false); setFile(null); setTitle(''); setShared(false); setHist(''); },
      onError: e => toast.error(hrErr(e, 'Upload failed')),
    });
  };
  const dl = async (doc: HrEmployeeDetail['documents'][number]) => {
    setBusyId(doc.id);
    try { await downloadHrDocument(doc); } catch (e) { toast.error(hrErr(e, 'Download failed')); } finally { setBusyId(null); }
  };
  return (
    <div className="space-y-3">
      {data.canManage && <div className="flex justify-end"><Button size="sm" className="gap-2" onClick={() => setOpen(true)} data-testid="button-upload-document"><Upload className="w-4 h-4" /> Upload document</Button></div>}
      <Card><CardContent className="p-0">
        {data.documents.length === 0 ? <div className="p-10 text-center space-y-2"><FileText className="w-9 h-9 mx-auto text-muted-foreground/50" /><p className="font-medium">No documents</p></div> : (
          <div className="divide-y">{data.documents.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3" data-testid={`document-${doc.id}`}>
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{doc.title}</p><p className="text-xs text-muted-foreground">{doc.fileName} · {fmtBytes(doc.sizeBytes)} · {d(doc.createdAt)}{doc.historyEntryId ? ' · linked to a record' : ''}</p></div>
              {data.canManage && <Button size="sm" variant="ghost" className="text-xs" disabled={share.isPending} onClick={() => share.mutate({ id: doc.id, shared: !doc.sharedWithEmployee }, { onError: e => toast.error(hrErr(e, 'Could not change sharing')) })}>{doc.sharedWithEmployee ? <><Eye className="w-3.5 h-3.5 mr-1" />Shared</> : <><EyeOff className="w-3.5 h-3.5 mr-1" />Private</>}</Button>}
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busyId === doc.id} onClick={() => dl(doc)}><Download className="w-3.5 h-3.5" />{busyId === doc.id ? '…' : 'Download'}</Button>
            </div>
          ))}</div>
        )}
      </CardContent></Card>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-5"><SheetTitle>Upload document</SheetTitle><SheetDescription>PDF, image, or Word (.docx), up to 10 MB.</SheetDescription></SheetHeader>
          <div className="space-y-4">
            <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.docx" onChange={e => pick(e.target.files?.[0] ?? null)} data-testid="input-document-file" />
            <div className="space-y-1.5"><label className="text-sm font-medium">Title</label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Link to record (optional)</label>
              <Select value={hist || '__none__'} onValueChange={v => setHist(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">— None —</SelectItem>{data.history.map(h => <SelectItem key={h.id} value={String(h.id)}>{historyLabel(h.type)}: {h.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-3"><span className="text-sm">Share with employee</span><Switch checked={shared} onCheckedChange={setShared} /></label>
            <div className="flex justify-end gap-2 pt-2 border-t"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={upload.isPending || !file}>{upload.isPending ? 'Uploading…' : 'Upload'}</Button></div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AssignmentCard({ id, a, canFill }: { id: number; a: HrAssignment; canFill: boolean }) {
  const save = useSaveAssignment(id);
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, EmpAnswer>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submitted = !!a.submittedAt;
  const start = () => { setAnswers({ ...(a.answers ?? {}) }); setErrors({}); setOpen(true); };
  const go = (submit: boolean) => {
    if (submit) { const e = validateEmpAnswers(a.snapshot.fields, answers); setErrors(e); if (Object.keys(e).length) { toast.error('Complete the required questions'); return; } }
    save.mutate({ id: a.id, answers, submit }, { onSuccess: () => { toast.success(submit ? 'Form submitted' : 'Draft saved'); if (submit) setOpen(false); }, onError: e => toast.error(hrErr(e, 'Could not save form')) });
  };
  return (
    <Card data-testid={`assignment-${a.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <ClipboardList className="w-4 h-4 text-muted-foreground" /><span className="font-medium flex-1">{a.title || a.snapshot.name}</span>
          {a.required && <Badge variant="outline" className="text-xs bg-rose-50 text-rose-700 border-rose-200">Required</Badge>}
          <Badge variant="outline" className="text-xs">{submitted ? `Submitted ${d(a.submittedAt)}` : a.answers && Object.keys(a.answers).length ? 'Draft' : 'Not started'}</Badge>
          {a.dueDate && !submitted && <span className="text-xs text-muted-foreground">Due {d(a.dueDate)}</span>}
        </div>
        {submitted ? <EmpFormFields idPrefix={`asg-${a.id}`} fields={a.snapshot.fields} answers={a.answers ?? {}} readOnly />
        : open ? (
          <>
            <EmpFormFields idPrefix={`asg-${a.id}`} fields={a.snapshot.fields} answers={answers} errors={errors} onChange={(k, v) => setAnswers(x => ({ ...x, [k]: v }))} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
              <Button variant="outline" disabled={save.isPending} onClick={() => go(false)}>Save draft</Button>
              <Button disabled={save.isPending} onClick={() => go(true)}>Submit</Button>
            </div>
            <p className="text-xs text-muted-foreground">Submitted answers are locked.</p>
          </>
        ) : canFill ? <Button size="sm" variant="outline" onClick={start}>{a.answers && Object.keys(a.answers).length ? 'Continue draft' : 'Fill out'}</Button> : null}
      </CardContent>
    </Card>
  );
}

function FormsTab({ id, data, isSelf }: { id: number; data: HrEmployeeDetail; isSelf: boolean }) {
  const templates = useEmployeeFormTemplates(data.canManage);
  const assign = useAssignForm(id);
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [required, setRequired] = useState(false);
  const [due, setDue] = useState('');
  const submit = () => {
    if (!templateId) { toast.error('Pick a form'); return; }
    assign.mutate({ templateId: Number(templateId), required, dueDate: due || null }, { onSuccess: () => { toast.success('Form assigned'); setOpen(false); setTemplateId(''); setRequired(false); setDue(''); }, onError: e => toast.error(hrErr(e, 'Could not assign form')) });
  };
  return (
    <div className="space-y-3">
      {data.canManage && <div className="flex justify-end"><Button size="sm" className="gap-2" onClick={() => setOpen(true)} data-testid="button-assign-form"><Plus className="w-4 h-4" /> Assign form</Button></div>}
      {data.assignments.length === 0 ? <Card><CardContent className="p-10 text-center space-y-2"><ClipboardList className="w-9 h-9 mx-auto text-muted-foreground/50" /><p className="font-medium">No assigned forms</p></CardContent></Card>
        : data.assignments.map(a => <AssignmentCard key={a.id} id={id} a={a} canFill={isSelf || data.canManage} />)}
      {data.canManage && <p className="text-xs text-muted-foreground">HR can fill a form on the employee's behalf. Drafts are visible to both.</p>}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader className="mb-5"><SheetTitle>Assign form</SheetTitle><SheetDescription>The employee sees it in their record. Questions are copied now.</SheetDescription></SheetHeader>
          <div className="space-y-4">
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger data-testid="select-assign-template"><SelectValue placeholder={templates.isLoading ? 'Loading…' : 'Choose a form'} /></SelectTrigger>
              <SelectContent>{(templates.data ?? []).filter(templateActive).map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="space-y-1.5"><label className="text-sm font-medium">Due date (optional)</label><Input type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
            <label className="flex items-center justify-between"><span className="text-sm">Required</span><Switch checked={required} onCheckedChange={setRequired} /></label>
            <div className="flex justify-end gap-2 pt-2 border-t"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={assign.isPending}>{assign.isPending ? 'Assigning…' : 'Assign'}</Button></div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActivityTab({ id, onUseEvidence }: { id: number; onUseEvidence: (ev: { timeEntryIds: number[]; subTimerIds: number[] }) => void }) {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [act, setAct] = useState<HrActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selT, setSelT] = useState<number[]>([]);
  const [selS, setSelS] = useState<number[]>([]);
  const load = async (before: string | null) => {
    setLoading(true); setError(null);
    try {
      const r = await fetchActivity(id, from, to, before);
      setAct(cur => before && cur ? { timeEntries: [...cur.timeEntries, ...r.timeEntries], subTimers: [...cur.subTimers, ...r.subTimers], callbacks: [...cur.callbacks, ...r.callbacks], nextBefore: r.nextBefore ?? null } : { ...r, nextBefore: r.nextBefore ?? null });
      if (!before) { setSelT([]); setSelS([]); }
    } catch (e) { setError(hrErr(e, 'Could not load activity')); } finally { setLoading(false); }
  };
  const toggle = (arr: number[], set: (x: number[]) => void, v: number) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-3 flex gap-2"><MapPin className="w-4 h-4 shrink-0 mt-0.5" />
        <span>GPS is captured only at clock and timer start/stop when the device allowed it. It is not continuous tracking and does not prove where someone was between those points. "GPS unknown" means no location was recorded.</span></div>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="space-y-1"><label className="text-xs font-medium">From</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9" /></div>
        <div className="space-y-1"><label className="text-xs font-medium">To</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9" /></div>
        <Button size="sm" onClick={() => load(null)} disabled={loading} data-testid="button-load-activity">{loading && !act ? 'Loading…' : 'Load activity'}</Button>
        {(selT.length + selS.length) > 0 && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => onUseEvidence({ timeEntryIds: selT, subTimerIds: selS })} data-testid="button-use-evidence">New record with {selT.length + selS.length} selected</Button>}
      </div>
      {error && <div className="text-sm border rounded-md p-3 flex items-center justify-between"><span className="text-destructive">{error}</span><Button size="sm" variant="outline" onClick={() => load(null)}>Retry</Button></div>}
      {loading && !act && <Skeleton className="h-40" />}
      {act && <>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Clock className="w-4 h-4" /> Clock entries ({act.timeEntries.length})</CardTitle></CardHeader>
          <CardContent className="p-0"><div className="divide-y">{act.timeEntries.length === 0 ? <p className="p-4 text-sm text-muted-foreground">None in this range.</p> : act.timeEntries.map(t => {
            const edited = (t.effectiveClockInAt && t.effectiveClockInAt !== t.clockInAt) || (t.effectiveClockOutAt && t.effectiveClockOutAt !== t.clockOutAt);
            return (
              <label key={t.id} className="flex gap-3 px-4 py-3 text-sm cursor-pointer hover:bg-muted/30">
                <Checkbox checked={selT.includes(t.id)} onCheckedChange={() => toggle(selT, setSelT, t.id)} className="mt-0.5" />
                <div className="flex-1 space-y-0.5">
                  <p className="font-medium">{t.jobTitle ?? 'Shift'} {edited && <Badge variant="outline" className="text-[10px] ml-1">Adjusted</Badge>}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">Raw: {dt(t.clockInAt)} → {t.clockOutAt ? dt(t.clockOutAt) : 'still open'}</p>
                  {edited && <p className="text-xs text-muted-foreground tabular-nums">Effective: {dt(t.effectiveClockInAt)} → {dt(t.effectiveClockOutAt)}</p>}
                  <p className="text-xs text-muted-foreground">Start: {gps(t.clockInLocation)} · End: {gps(t.clockOutLocation)}</p>
                </div>
              </label>
            );
          })}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Job timers ({act.subTimers.length})</CardTitle></CardHeader>
          <CardContent className="p-0"><div className="divide-y">{act.subTimers.length === 0 ? <p className="p-4 text-sm text-muted-foreground">None in this range.</p> : act.subTimers.map(s => (
            <label key={s.id} className="flex gap-3 px-4 py-3 text-sm cursor-pointer hover:bg-muted/30">
              <Checkbox checked={selS.includes(s.id)} onCheckedChange={() => toggle(selS, setSelS, s.id)} className="mt-0.5" />
              <div className="flex-1 space-y-0.5">
                <p className="font-medium">{s.jobTitle ?? s.label ?? `Timer #${s.id}`}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{dt(s.startedAt)} → {s.stoppedAt ? dt(s.stoppedAt) : 'still running'}</p>
                <p className="text-xs text-muted-foreground">Start: {gps(s.startLocation)} · End: {gps(s.stopLocation)}</p>
              </div>
            </label>
          ))}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Callbacks ({act.callbacks.length})</CardTitle></CardHeader>
          <CardContent className="p-0"><div className="divide-y">{act.callbacks.length === 0 ? <p className="p-4 text-sm text-muted-foreground">None in this range.</p> : act.callbacks.map(c => (
            <div key={c.id} className="px-4 py-3 text-sm"><p className="font-medium">{c.jobTitle ?? `Callback #${c.id}`} {c.status && <Badge variant="outline" className="text-[10px] ml-1 capitalize">{c.status.replace(/_/g, ' ')}</Badge>}</p><p className="text-xs text-muted-foreground">{dt(c.createdAt)}{c.reason ? ` · ${c.reason}` : ''}</p></div>
          ))}</div></CardContent></Card>
        {act.nextBefore && <Button size="sm" variant="outline" disabled={loading} onClick={() => load(act.nextBefore)}>{loading ? 'Loading…' : 'Load older'}</Button>}
      </>}
    </div>
  );
}

function AuditTab({ id }: { id: number }) {
  const q = useHrAudit(id, true);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <div className="p-6 text-center space-y-2"><p className="text-sm text-destructive">Could not load audit log.</p><Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>;
  const ev = q.data?.events ?? [];
  return (
    <Card><CardContent className="p-0">{ev.length === 0 ? <p className="p-6 text-sm text-muted-foreground text-center">No changes recorded yet.</p> : (
      <div className="divide-y">{ev.map(e => (
        <details key={e.id} className="px-4 py-3 text-sm">
          <summary className="cursor-pointer"><span className="font-medium capitalize">{e.action.replace(/[_.]/g, ' ')}</span> <span className="text-muted-foreground text-xs">· {e.actorName ?? 'System'} · {dt(e.createdAt)}</span></summary>
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">{e.before == null ? '—' : JSON.stringify(e.before, null, 2)}</pre>
            <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">{e.after == null ? '—' : JSON.stringify(e.after, null, 2)}</pre>
          </div>
        </details>
      ))}</div>
    )}</CardContent></Card>
  );
}

function printFile(data: HrEmployeeDetail) {
  const e = data.employee, p = data.profile;
  const rows = (pairs: Array<[string, unknown]>) => pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><title>${esc(e.name)} — employee file</title><style>
    body{font-family:Georgia,serif;color:#222;margin:32px;font-size:12px}h1{font-size:20px;margin:0}h2{font-size:14px;border-bottom:1px solid #999;margin-top:22px;padding-bottom:3px}
    table{border-collapse:collapse;width:100%}th{text-align:left;width:32%;padding:3px 6px;color:#555;font-weight:normal}td{padding:3px 6px}.entry{margin:8px 0;padding:6px 0;border-bottom:1px dotted #bbb}.muted{color:#666}.note{font-size:10px;color:#666;margin-top:24px}
  </style></head><body>
  <h1>${esc(e.name)}</h1><div class="muted">${esc(e.email ?? '')} · ${esc(e.role.replace(/_/g, ' '))} · printed ${esc(new Date().toLocaleString())}</div>
  ${p ? `<h2>Personnel record</h2><table>${rows([['Legal name', p.legalName], ['Job title', p.jobTitle], ['Department', p.department], ['Status', p.employmentStatus], ['Hire date', p.hireDate], ['End date', p.endDate], ['Phone', p.phone], ['Personal email', p.personalEmail], ['Address', p.address], ['Emergency contact', [p.emergencyContactName, p.emergencyContactPhone].filter(Boolean).join(' ')], ['HR notes', p.notes]])}</table>` : ''}
  <h2>Records (${data.history.length})</h2>${data.history.map(h => `<div class="entry"><b>${esc(historyLabel(h.type))}: ${esc(h.title)}</b> <span class="muted">— occurred ${esc(h.occurredOn ?? '')}, recorded ${esc(new Date(h.createdAt).toLocaleString())}${h.createdByName ? ` by ${esc(h.createdByName)}` : ''}${h.acknowledgedAt ? `, acknowledged ${esc(new Date(h.acknowledgedAt).toLocaleString())}` : ''}</span>${h.notes ? `<div>${esc(h.notes).replace(/\n/g, '<br>')}</div>` : ''}${(h.formSnapshot?.fields ?? []).map(f => `<div class="muted">${esc(f.label)}: ${esc(displayEmpAnswer(f, h.formData?.[f.id]))}</div>`).join('')}${evidenceHtml(h.evidence)}</div>`).join('') || '<p class="muted">None.</p>'}
  <h2>Assigned forms (${data.assignments.length})</h2>${data.assignments.map(a => `<div class="entry"><b>${esc(a.title || a.snapshot.name)}</b> <span class="muted">${a.submittedAt ? `submitted ${esc(new Date(a.submittedAt).toLocaleString())}` : 'not submitted'}</span>${a.snapshot.fields.map(f => `<div class="muted">${esc(f.label)}: ${esc(displayEmpAnswer(f, a.answers?.[f.id]))}</div>`).join('')}</div>`).join('') || '<p class="muted">None.</p>'}
  <h2>Documents (${data.documents.length})</h2>${data.documents.map(x => `<div>${esc(x.title)} <span class="muted">(${esc(x.fileName)}, ${esc(new Date(x.createdAt).toLocaleDateString())})</span></div>`).join('') || '<p class="muted">None.</p>'}
  <p class="note">Contains only the records currently loaded and visible to the person who printed it. It is not a complete legal file and contains no recommendations.</p>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast.error('Allow pop-ups to print'); return; }
  w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
}

export default function EmployeeFilePage() {
  const params = useParams<{ id?: string }>();
  const meta = useHrMeta();
  const id = params.id ? Number(params.id) : (meta.data?.ownUserId ?? NaN);
  const q = useHrEmployee(id);
  const hasHr = !!meta.data?.hasHrAccess;
  const isSelf = meta.data?.ownUserId === id;
  const [addOpen, setAddOpen] = useState(false);
  const [evidence, setEvidence] = useState<{ timeEntryIds: number[]; subTimerIds: number[] }>({ timeEntryIds: [], subTimerIds: [] });
  const [tab, setTab] = useState('history');
  const noEvidence = useMemo(() => ({ timeEntryIds: [] as number[], subTimerIds: [] as number[] }), []);

  if (meta.isLoading || q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>;
  if (q.isError || !q.data) {
    const status = (q.error as { status?: number } | null)?.status;
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <ShieldCheck className="w-10 h-10 mx-auto text-muted-foreground/50" />
        <p className="font-medium">{status === 403 || status === 404 ? 'This employee record isn\u2019t available to you' : 'Could not load this employee record'}</p>
        <p className="text-sm text-muted-foreground">Personnel records are private to the owner and designated HR staff. You can always view your own record.</p>
        <div className="flex justify-center gap-2">
          {status !== 403 && status !== 404 && <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}
          <Link href="/my-record" className="text-sm underline self-center">My record</Link>
        </div>
      </div>
    );
  }
  const data = q.data;
  const e = data.employee;
  const openAdd = (ev = noEvidence) => { setEvidence(ev); setAddOpen(true); };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start gap-4 flex-wrap">
        {hasHr && <Link href="/employees" className="mt-1.5 text-muted-foreground hover:text-foreground" aria-label="Back to employees"><ArrowLeft className="w-5 h-5" /></Link>}
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">{e.name.slice(0, 2).toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{e.name}{isSelf && <span className="text-sm font-normal text-muted-foreground ml-2">(you)</span>}</h1>
          <p className="text-muted-foreground text-sm capitalize">{data.profile?.jobTitle || e.role.replace(/_/g, ' ')}{e.email ? <span className="normal-case"> · {e.email}</span> : null}{!e.isActive && ' · login disabled'}</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => printFile(data)} data-testid="button-print-employee"><Printer className="w-4 h-4" /> Print file</Button>
      </div>
      {!data.canManage && <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-3">You're seeing records your employer has shared with you and forms assigned to you.</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          {data.canManage && <TabsTrigger value="profile">Profile</TabsTrigger>}
          <TabsTrigger value="history">Records ({data.history.length})</TabsTrigger>
          <TabsTrigger value="forms">Forms ({data.assignments.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({data.documents.length})</TabsTrigger>
          {data.canManage && <TabsTrigger value="activity">Time & GPS</TabsTrigger>}
          {data.canManage && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>
        {data.canManage && <TabsContent value="profile" className="mt-4 space-y-4">{meta.data?.isOwner && e.needsAccountSetup && <AccountSetupCard id={id} name={e.name} />}<ProfileCard id={id} data={data} /></TabsContent>}
        <TabsContent value="history" className="mt-4"><HistoryList id={id} data={data} isSelf={isSelf} onAdd={() => openAdd()} /></TabsContent>
        <TabsContent value="forms" className="mt-4"><FormsTab id={id} data={data} isSelf={isSelf} /></TabsContent>
        <TabsContent value="documents" className="mt-4"><DocumentsTab id={id} data={data} /></TabsContent>
        {data.canManage && <TabsContent value="activity" className="mt-4"><ActivityTab id={id} onUseEvidence={ev => { openAdd(ev); }} /></TabsContent>}
        {data.canManage && <TabsContent value="audit" className="mt-4"><AuditTab id={id} /></TabsContent>}
      </Tabs>
      {data.canManage && <AddHistorySheet id={id} open={addOpen} onClose={() => setAddOpen(false)} evidence={evidence} />}
    </div>
  );
}
