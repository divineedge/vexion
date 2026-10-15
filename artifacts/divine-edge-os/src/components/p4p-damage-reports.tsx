import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListP4pDamageReports, useCreateP4pDamageReport, useUpdateP4pDamageReport, useDecideP4pDamageReport, useListUsers, getListP4pDamageReportsQueryKey, getListUsersQueryKey,
  type P4pDamageReport, type P4pDamageInput,
} from '@workspace/api-client-react';
import { toast } from 'sonner';
import { AlertTriangle, Plus, Trash2, Lock, RotateCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '');
const today = () => new Date().toISOString().slice(0, 10);
const errMsg = (e: unknown, fallback: string) => {
  const any = e as { data?: { error?: string; message?: string }; message?: string } | null;
  return any?.data?.error || any?.data?.message || (e instanceof Error && e.message) || fallback;
};
const statusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-rose-50 text-rose-700 border-rose-200',
  void: 'bg-muted text-muted-foreground',
};

type AllocRow = { userId: string; amount: string };

/** Approved P4P damage reports. Pass employeeId to show only allocations for that employee (read-only history). */
export function P4pDamageReports({ employeeId, readOnly = false }: { employeeId?: number; readOnly?: boolean }) {
  const { user, isTechnician } = useAuth();
  const canDecide = user?.role === 'company_owner' || user?.role === 'office_manager';
  const canEdit = canDecide && !readOnly;
  const cache = useQueryClient();
  const list = useListP4pDamageReports({ query: { queryKey: [...getListP4pDamageReportsQueryKey(), user?.id, user?.role], enabled: !!user, refetchInterval: 30000, refetchIntervalInBackground: false, staleTime: 0 } });
  const users = useListUsers({ query: { enabled: canEdit, queryKey: [...getListUsersQueryKey(), user?.id, user?.role] } });
  const create = useCreateP4pDamageReport();
  const update = useUpdateP4pDamageReport();
  const decide = useDecideP4pDamageReport();

  const [sheet, setSheet] = useState<{ open: boolean; edit: P4pDamageReport | null }>({ open: false, edit: null });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [occurredOn, setOccurredOn] = useState(today());
  const [payrollDate, setPayrollDate] = useState(today());
  const [jobId, setJobId] = useState('');
  const [allocs, setAllocs] = useState<AllocRow[]>([{ userId: '', amount: '' }]);
  const [decision, setDecision] = useState<{ report: P4pDamageReport; action: 'approve' | 'void' } | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const refresh = () => cache.invalidateQueries({
    predicate: q => {
      const k = String(q.queryKey[0] ?? '');
      return k.includes('p4p') || k.includes('damage') || k === 'final-payroll';
    },
  });

  const reports = useMemo(() => {
    const all = (list.data ?? []) as P4pDamageReport[];
    const scoped = employeeId == null ? all : all.filter(r => r.allocations.some(a => a.userId === employeeId));
    return [...scoped].sort((a, b) => b.payrollDate.localeCompare(a.payrollDate) || b.id - a.id);
  }, [list.data, employeeId]);

  const staff = ((users.data ?? []) as Array<{ id: number; name?: string | null; isActive?: boolean | null }>);

  const openSheet = (r: P4pDamageReport | null) => {
    setTitle(r?.title ?? ''); setDescription(r?.description ?? '');
    setOccurredOn(r?.occurredOn ?? today()); setPayrollDate(r?.payrollDate ?? today());
    setJobId(r?.jobId != null ? String(r.jobId) : '');
    setAllocs(r?.allocations.length ? r.allocations.map(a => ({ userId: String(a.userId), amount: a.amount.toFixed(2) })) : [{ userId: '', amount: '' }]);
    setSheet({ open: true, edit: r });
  };

  const amountOk = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim());
  const total = allocs.reduce((c, a) => c + (amountOk(a.amount) ? Math.round(Number(a.amount) * 100) : 0), 0) / 100;
  const ids = allocs.map(a => a.userId).filter(Boolean);
  const formError = !title.trim() ? 'Add a title'
    : !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || !/^\d{4}-\d{2}-\d{2}$/.test(payrollDate) ? 'Pick both dates'
    : jobId.trim() && !/^\d+$/.test(jobId.trim()) ? 'Job number must be a whole number'
    : !allocs.length || allocs.some(a => !a.userId) ? 'Assign every row to an employee'
    : new Set(ids).size !== ids.length ? 'Each employee can appear only once'
    : allocs.some(a => !amountOk(a.amount)) ? 'Amounts must be 0 or more with at most 2 decimals'
    : null;

  const submit = () => {
    if (formError) { toast.error(formError); return; }
    const data: P4pDamageInput = {
      title: title.trim(), description: description.trim(), occurredOn, payrollDate,
      jobId: jobId.trim() ? Number(jobId.trim()) : null,
      allocations: allocs.map(a => ({ userId: Number(a.userId), amount: Math.round(Number(a.amount) * 100) / 100 })),
    };
    const opts = {
      onSuccess: () => { toast.success(sheet.edit ? 'Pending report updated' : 'Pending damage report created'); setSheet({ open: false, edit: null }); void refresh(); },
      onError: (e: unknown) => toast.error(errMsg(e, 'Could not save the report. Please retry.')),
    };
    if (sheet.edit) update.mutate({ id: sheet.edit.id, data }, opts); else create.mutate({ data }, opts);
  };

  const runDecision = () => {
    if (!decision || !reason.trim() || !confirmed) return;
    decide.mutate({ id: decision.report.id, data: { action: decision.action, reason: reason.trim() } }, {
      onSuccess: () => { toast.success(decision.action === 'approve' ? 'Report approved. Live P4P totals updated.' : 'Report voided.'); setDecision(null); void refresh(); },
      onError: e => toast.error(errMsg(e, 'Could not record the decision. Please retry.')),
    });
  };

  const reportTotal = (r: P4pDamageReport) => r.allocations.reduce((c, a) => c + Math.round(a.amount * 100), 0) / 100;
  const busy = create.isPending || update.isPending;

  return (
    <Card data-testid="card-p4p-damage">
      <CardHeader className="pb-3 flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-600" /> P4P Damage Reports</CardTitle>
          <CardDescription>
            {employeeId != null
              ? 'Damage allocations linked to this employee. Manage reports from P4P Payroll.'
              : isTechnician
                ? 'Approved damage allocated to you. It only reduces P4P in the payroll period containing its payroll date, never below zero, with no automatic carry-forward, and never your hourly guarantee or acquisition bonus.'
                : 'Manually allocated damage per employee. The payroll date selects which payroll period the deduction belongs to. Approved amounts are capped at that period\u2019s P4P; any unused amount does not automatically carry forward. Approving a report is not final payroll approval. Hourly guarantee and acquisition bonuses are never reduced.'}
          </CardDescription>
        </div>
        {canEdit && employeeId == null && <Button size="sm" className="gap-1.5 shrink-0" onClick={() => openSheet(null)} data-testid="button-new-damage"><Plus className="w-3.5 h-3.5" /> New report</Button>}
      </CardHeader>
      <CardContent className="space-y-3">
        {list.isLoading ? (
          <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : list.error ? (
          <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{errMsg(list.error, 'Unable to load damage reports.')}</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => list.refetch()} data-testid="button-retry-damage"><RotateCw className="w-3.5 h-3.5" /> Retry</Button>
          </div>
        ) : reports.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <ShieldAlert className="w-9 h-9 mx-auto mb-2 opacity-25" />
            <p className="font-medium text-foreground">No damage reports</p>
            <p className="text-sm">{employeeId != null ? 'Nothing has been allocated to this employee.' : 'Nothing recorded. P4P is paid in full.'}</p>
          </div>
        ) : reports.map(r => {
          const locked = r.payrollPeriodId != null;
          const shown = employeeId != null ? r.allocations.filter(a => a.userId === employeeId) : r.allocations;
          return (
            <div key={r.id} className={`rounded-lg border p-4 space-y-2 ${r.status === 'void' ? 'opacity-70' : ''}`} data-testid={`damage-report-${r.id}`}>
              <div className="flex items-start gap-2 flex-wrap">
                <Badge variant="outline" className={`capitalize text-xs ${statusTone[r.status]}`}>{r.status}</Badge>
                {locked && <Badge variant="outline" className="text-xs gap-1"><Lock className="w-3 h-3" /> Finalized</Badge>}
                <span className={`font-medium flex-1 min-w-0 ${r.status === 'void' ? 'line-through' : ''}`}>{r.title}</span>
                <span className="text-sm font-semibold tabular-nums text-rose-700">{money(employeeId != null ? shown.reduce((s, a) => s + a.amount, 0) : reportTotal(r))}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Occurred {r.occurredOn} · Payroll date <span className="font-medium text-foreground">{r.payrollDate}</span>
                {r.jobId != null && <> · Source job #{r.jobId}</>} · Reported by {r.createdByName} {when(r.createdAt)}
              </p>
              {r.description && <p className="text-sm whitespace-pre-wrap">{r.description}</p>}
              <div className="flex flex-wrap gap-2">
                {shown.map(a => (
                  <span key={a.userId} className="text-xs px-2 py-1 rounded border bg-muted/40 tabular-nums">{a.employeeName ?? `User ${a.userId}`}: {money(a.amount)}</span>
                ))}
              </div>
              {r.approvedByName && <p className="text-xs">Approved by {r.approvedByName} {when(r.approvedAt)}{r.decisionReason ? ` — ${r.decisionReason}` : ''}</p>}
              {r.voidedByName && <p className="text-xs">Voided by {r.voidedByName} {when(r.voidedAt)}{r.voidReason ? ` — ${r.voidReason}` : ''}</p>}
              {locked && r.status !== 'void' && <p className="text-xs text-muted-foreground">Included in finalized payroll and cannot change. Use an audited adjustment under Finalize / history to correct it.</p>}
              {canEdit && !locked && r.status !== 'void' && (
                <div className="flex gap-2 pt-1 flex-wrap">
                  {r.status === 'pending' && <Button size="sm" variant="outline" onClick={() => openSheet(r)} data-testid={`button-edit-damage-${r.id}`}>Edit</Button>}
                  {r.status === 'pending' && <Button size="sm" disabled={reportTotal(r) <= 0} title={reportTotal(r) <= 0 ? 'Total must be greater than $0 to approve' : undefined}
                    onClick={() => { setDecision({ report: r, action: 'approve' }); setReason(''); setConfirmed(false); }} data-testid={`button-approve-damage-${r.id}`}>Approve</Button>}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setDecision({ report: r, action: 'void' }); setReason(''); setConfirmed(false); }} data-testid={`button-void-damage-${r.id}`}>Void</Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      <Sheet open={sheet.open} onOpenChange={o => { if (!o) setSheet({ open: false, edit: null }); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle>{sheet.edit ? 'Edit pending damage report' : 'New damage report'}</SheetTitle>
            <SheetDescription>Saved as pending. Nothing is deducted until an owner or office manager approves it with a reason.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="dmg-title">Title</label><Input id="dmg-title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} data-testid="input-damage-title" /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="dmg-desc">What happened</label><Textarea id="dmg-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)} data-testid="input-damage-description" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="dmg-occ">Date it happened</label><Input id="dmg-occ" type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)} data-testid="input-damage-occurred" /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="dmg-pay">Deduct on payroll date</label><Input id="dmg-pay" type="date" value={payrollDate} onChange={e => setPayrollDate(e.target.value)} data-testid="input-damage-payroll-date" /></div>
            </div>
            <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="dmg-job">Source job number (optional)</label><Input id="dmg-job" inputMode="numeric" value={jobId} onChange={e => setJobId(e.target.value)} placeholder="Reference only" data-testid="input-damage-job" />
              <p className="text-xs text-muted-foreground">For reference. Fault is never attributed automatically from job crews.</p></div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Employee allocations</p>
              <p className="text-xs text-muted-foreground">Enter each employee's amount manually. Amounts are not split automatically.</p>
              {users.isError && <p className="text-xs text-destructive">Could not load the team list. <button type="button" className="underline" onClick={() => users.refetch()}>Retry</button></p>}
              {allocs.map((a, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select className="flex-1 h-9 rounded-md border bg-background px-2 text-sm" value={a.userId} onChange={e => setAllocs(x => x.map((r, j) => j === i ? { ...r, userId: e.target.value } : r))} data-testid={`select-damage-employee-${i}`}>
                    <option value="">{users.isLoading ? 'Loading team...' : 'Choose employee'}</option>
                    {staff.filter(s => s.isActive !== false || String(s.id) === a.userId).map(s => <option key={s.id} value={s.id}>{s.name ?? `User ${s.id}`}</option>)}
                  </select>
                  <Input className="w-32 tabular-nums" type="number" min="0" step="0.01" placeholder="0.00" value={a.amount} onChange={e => setAllocs(x => x.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))} data-testid={`input-damage-amount-${i}`} />
                  <Button type="button" size="icon" variant="ghost" disabled={allocs.length === 1} onClick={() => setAllocs(x => x.filter((_, j) => j !== i))} aria-label="Remove employee"><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setAllocs(x => [...x, { userId: '', amount: '' }])} data-testid="button-add-allocation"><Plus className="w-3.5 h-3.5" /> Add employee</Button>
                <span className="text-sm">Total <span className="font-semibold tabular-nums">{money(total)}</span></span>
              </div>
              {total <= 0 && <p className="text-xs text-amber-700">A $0 total can be saved as pending but cannot be approved.</p>}
            </div>
            {formError && <p className="text-xs text-muted-foreground">{formError}</p>}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setSheet({ open: false, edit: null })}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !!formError} data-testid="button-save-damage">{busy ? 'Saving...' : sheet.edit ? 'Save changes' : 'Save as pending'}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!decision} onOpenChange={o => { if (!o) setDecision(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{decision?.action === 'approve' ? 'Approve damage deduction?' : 'Void this report?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {decision?.action === 'approve'
                ? `${money(decision ? reportTotal(decision.report) : 0)} will reduce P4P in the payroll period containing ${decision?.report.payrollDate} for the listed employees, capped at that period's P4P. Unused amounts do not automatically carry forward. Hourly guarantee and acquisition bonuses are not reduced. This is not final payroll approval; payroll is still reviewed and locked separately.`
                : 'The report stays on record but no longer reduces pay. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="dmg-reason">Reason (required, recorded)</label>
            <Textarea id="dmg-reason" rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-damage-reason" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="checkbox-damage-confirm" /> I confirm this decision</label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!reason.trim() || !confirmed || decide.isPending} onClick={e => { e.preventDefault(); runDecision(); }} data-testid="button-confirm-damage-decision">
              {decide.isPending ? 'Saving...' : decision?.action === 'approve' ? 'Approve' : 'Void report'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
