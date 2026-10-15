import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateJobOtherCost, useVoidJobOtherCost, type JobEconomicsJob, type JobOtherCost } from '@workspace/api-client-react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { budgetTotalCost, fmtMoney, fmtMin, fmtNum, fmtPct, isTimed } from '@/lib/jobEconomics';

const errMsg = (e: unknown) => (e as { data?: { error?: string; message?: string } })?.data?.error ?? (e as { data?: { message?: string } })?.data?.message ?? (e as Error)?.message ?? 'Request failed';
const Row = ({ l, p, a, warn }: { l: string; p: string; a: string; warn?: boolean }) => (
  <tr className="[&>td]:py-1 [&>td]:px-2"><td className="text-muted-foreground">{l}</td><td className="tabular-nums">{p}</td><td className={`tabular-nums ${warn ? 'text-red-600 font-semibold' : ''}`}>{a}</td></tr>
);

function VoidCost({ jobId, cost, onDone }: { jobId: number; cost: JobOtherCost; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState('');
  const m = useVoidJobOtherCost();
  if (!open) return <Button size="sm" variant="ghost" className="h-6 text-xs text-red-600" onClick={() => setOpen(true)} data-testid={`button-void-cost-${cost.id}`}>Void</Button>;
  return (
    <div className="mt-2 space-y-1 w-full">
      <Textarea rows={2} maxLength={1000} placeholder="Reason for voiding (kept in history)" value={reason} onChange={e => setReason(e.target.value)} data-testid={`input-void-reason-${cost.id}`} />
      {m.isError && <p className="text-xs text-red-600">{errMsg(m.error)}</p>}
      <div className="flex gap-1">
        <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={!reason.trim() || m.isPending} onClick={() => m.mutate({ jobId, costId: cost.id, data: { reason: reason.trim() } }, { onSuccess: () => { setOpen(false); onDone(); } })} data-testid={`button-confirm-void-${cost.id}`}>{m.isPending ? 'Voiding…' : 'Confirm void'}</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function JobEconomicsDetail({ job, onClose }: { job: JobEconomicsJob | null; onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreateJobOtherCost();
  const [desc, setDesc] = useState(''); const [amount, setAmount] = useState(''); const [expenseId, setExpenseId] = useState('');
  const requestId = useRef<string>(crypto.randomUUID());
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['/api/reports/job-economics'] }); };
  const amt = Number(amount);
  const amountOk = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && amt > 0 && amt <= 1_000_000;
  const expOk = !expenseId.trim() || /^\d+$/.test(expenseId.trim());
  const j = job;
  const submit = () => {
    if (!j || !desc.trim() || !amountOk || !expOk || create.isPending) return;
    create.mutate({ jobId: j.id, data: { description: desc.trim(), amount: Math.round(amt * 100) / 100, requestId: requestId.current, expenseId: expenseId.trim() ? Number(expenseId) : null } },
      { onSuccess: () => { setDesc(''); setAmount(''); setExpenseId(''); requestId.current = crypto.randomUUID(); create.reset(); refresh(); } });
  };
  const bTotal = j ? budgetTotalCost(j) : null;
  return (
    <Sheet open={!!j} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="panel-job-economics">
        {j && <>
          <SheetHeader>
            <SheetTitle className="pr-6">{j.title}</SheetTitle>
            <SheetDescription>{j.customerName} · {j.serviceName}{j.multiService ? ' (multiple services)' : ''} · completed {j.completedDate}</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 py-4 text-sm">
            <div className="flex flex-wrap gap-3 text-xs">
              <Link href={`/schedule?jobId=${j.id}`} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="link-detail-job"><ExternalLink className="w-3 h-3" />Open job</Link>
              {j.estimateId != null && <Link href={`/estimates?estimateId=${j.estimateId}`} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="link-detail-estimate"><ExternalLink className="w-3 h-3" />Linked estimate #{j.estimateId}</Link>}
              <span className="text-muted-foreground">Baseline: {j.baselineSource}</span>
              <span className="text-muted-foreground">Measurement: {j.measurement != null ? `${fmtNum(j.measurement, 0)} ${j.measurementUnit === 'linear_ft' ? 'lin ft' : 'sq ft'}` : 'none'} ({j.measurementSource === 'current_property' ? 'Current property / matrix; historical size not saved' : j.measurementSource})</span>
            </div>
            {j.issues.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-0.5" data-testid="text-detail-issues">{j.issues.map(i => <p key={i} className="flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{i}</p>)}</div>}

            <section><h3 className="font-semibold mb-1">Planned vs actual</h3>
              <table className="w-full text-xs"><thead className="text-muted-foreground"><tr className="[&>th]:text-left [&>th]:px-2"><th></th><th>Planned</th><th>Actual</th></tr></thead><tbody className="divide-y">
                <Row l="Price / revenue" p={fmtMoney(j.budgetRevenue, 'Not saved')} a={fmtMoney(j.revenue)} />
                <Row l="Person-minutes" p={fmtMin(j.budgetMinutes, 'Not saved')} a={j.hasOpenTimers ? 'Open timer' : fmtMin(isTimed(j) ? j.minutes : null)} warn={j.budgetMinutes != null && isTimed(j) && j.minutes > j.budgetMinutes} />
                <Row l="Labor cost" p={fmtMoney(j.budgetLaborCost, 'Not saved')} a={fmtMoney(j.laborCost)} warn={j.budgetLaborCost != null && j.laborCost != null && j.laborCost > j.budgetLaborCost} />
                <Row l="Material cost" p={fmtMoney(j.budgetMaterialCost, 'Not saved')} a={fmtMoney(j.materialCost)} warn={j.budgetMaterialCost != null && j.materialCost != null && j.materialCost > j.budgetMaterialCost} />
                <Row l="Linked fuel" p="—" a={fmtMoney(j.fuelCost)} />
                <Row l="Other costs" p="—" a={fmtMoney(j.otherCost)} />
                <Row l="Total cost" p={bTotal == null ? 'Not comparable' : fmtMoney(bTotal)} a={fmtMoney(j.totalCost, `Incomplete (known ${fmtMoney(j.knownCost)})`)} warn={bTotal != null && j.totalCost != null && j.totalCost > bTotal} />
                <Row l="Contribution" p={bTotal != null && j.budgetRevenue != null ? fmtMoney(j.budgetRevenue - bTotal) : '—'} a={fmtMoney(j.profit, 'Incomplete')} warn={j.profit != null && j.profit < 0} />
                <Row l="Margin" p="—" a={fmtPct(j.marginPct)} />
              </tbody></table>
              <p className="text-[11px] text-muted-foreground mt-1">Planned total compares labor + material only (other planned costs are not saved). Actual includes linked fuel and other costs. Contribution is before overhead.</p>
            </section>

            <section><h3 className="font-semibold mb-1">Workers</h3>
              {j.workers.length === 0 ? <p className="text-xs text-muted-foreground">No time recorded.</p> : <div className="divide-y rounded border text-xs">{j.workers.map(w => <div key={w.id} className="flex justify-between px-2 py-1"><span>{w.name}</span><span className="tabular-nums">{fmtMin(w.minutes)} · {fmtMoney(w.cost, 'Rate not recorded')}{w.cost != null && w.minutes > 0 && <span className="text-muted-foreground"> ({fmtMoney(w.cost / (w.minutes / 60))}/hr hist.)</span>}</span></div>)}</div>}
            </section>
            <section><h3 className="font-semibold mb-1">Inventory used (frozen cost)</h3>
              {j.materials.length === 0 ? <p className="text-xs text-muted-foreground">No materials recorded.</p> : <div className="divide-y rounded border text-xs">{j.materials.map((m, i) => <div key={i} className="flex justify-between gap-2 px-2 py-1"><span className="min-w-0 truncate">{m.name} <span className="text-muted-foreground">× {fmtNum(m.quantity)} · {m.source}</span></span><span className="tabular-nums shrink-0">{fmtMoney(m.cost, 'Cost not recorded')}</span></div>)}</div>}
            </section>

            <section className="space-y-2"><h3 className="font-semibold">Other job costs (report-only)</h3>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Enter only separate costs like disposal, subcontractors or delivery. Do not re-enter supplies or fuel already recorded. This does not create a cash expense or change inventory or payroll.</div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px_110px] gap-2">
                <Input placeholder="Description" maxLength={300} value={desc} onChange={e => setDesc(e.target.value)} data-testid="input-other-cost-description" />
                <Input placeholder="Amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-invalid={!!amount && !amountOk} data-testid="input-other-cost-amount" />
                <Input placeholder="Expense ID (opt.)" inputMode="numeric" value={expenseId} onChange={e => setExpenseId(e.target.value)} aria-invalid={!expOk} data-testid="input-other-cost-expense" />
              </div>
              {amount && !amountOk && <p className="text-xs text-red-600">Amount must be greater than 0 with at most two decimals.</p>}
              {create.isError && <p className="text-xs text-red-600" data-testid="text-other-cost-error">{errMsg(create.error)}</p>}
              <Button size="sm" disabled={!desc.trim() || !amountOk || !expOk || create.isPending} onClick={submit} data-testid="button-add-other-cost">{create.isPending ? 'Saving…' : 'Add cost allocation'}</Button>
              <div className="divide-y rounded border text-xs">
                {j.otherCosts.length === 0 ? <p className="p-2 text-muted-foreground">No other costs allocated.</p> : j.otherCosts.map(c => (
                  <div key={c.id} className={`px-2 py-1.5 flex flex-wrap items-center justify-between gap-1 ${c.voidedAt ? 'opacity-60' : ''}`} data-testid={`row-other-cost-${c.id}`}>
                    <div className="min-w-0"><p className={c.voidedAt ? 'line-through' : ''}>{c.description} · <span className="tabular-nums">{fmtMoney(c.amount)}</span>{c.expenseId != null && <span className="text-muted-foreground"> · expense #{c.expenseId}</span>}</p>
                      <p className="text-muted-foreground">{c.createdByName} · {new Date(c.createdAt).toLocaleString()}</p>
                      {c.voidedAt && <p className="text-red-700">Voided {new Date(c.voidedAt).toLocaleString()}: {c.voidReason}</p>}</div>
                    {!c.voidedAt && <VoidCost jobId={j.id} cost={c} onDone={refresh} />}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  );
}
