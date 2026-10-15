import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, type PayrollPreview, type PayrollPeriod, type PayrollPeriodInfo, type PayrollAdjustment } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const api = "/api/p4p/payroll";
const post = <T,>(path: string, data: unknown) => customFetch<T>(`${api}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});

export function PayrollApprovals({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const canApprove = user?.role === "company_owner" || user?.role === "office_manager";
  const cache = useQueryClient();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [employee, setEmployee] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [p4pOnlyReason, setP4pOnlyReason] = useState("");
  const periods = useQuery({
    queryKey: ["final-payroll"], queryFn: () => customFetch<PayrollPeriodInfo[]>(`${api}/periods`),
    staleTime: 0, refetchInterval: 30000,
  });
  const detail = useQuery({
    queryKey: ["final-payroll", selected], queryFn: () => customFetch<PayrollPeriod>(`${api}/periods/${selected}`),
    enabled: selected != null, staleTime: 0, refetchInterval: 30000,
  });
  const review = useMutation({
    mutationFn: () => post<PayrollPreview>("/preview", { dateFrom, dateTo }),
    onSuccess: data => { setPreview(data); setSelected(null); setP4pOnlyReason(""); },
    onError: () => setPreview(null),
  });
  const approve = useMutation({
    mutationFn: () => post<PayrollPeriod>("/periods", { dateFrom, dateTo, digest: preview?.digest, ...(p4pOnlyReason.trim() ? { p4pOnlyReason: p4pOnlyReason.trim() } : {}) }),
    onSuccess: data => {
      setPreview(null); setSelected(data.id);
      void cache.invalidateQueries({ queryKey: ["final-payroll"] });
      toast.success("Payroll finalized. Original amounts are locked.");
    },
    onError: () => setPreview(null),
  });
  const adjustment = useMutation({
    mutationFn: () => post<PayrollAdjustment>(`/periods/${selected}/adjustments`, { userId: Number(employee), amount: Number(amount), reason }),
    onSuccess: () => {
      setAmount(""); setReason("");
      void cache.invalidateQueries({ queryKey: ["final-payroll", selected] });
      toast.success("Audited adjustment recorded.");
    },
  });
  const saved = selected == null ? null : detail.data;
  const data = saved?.snapshot ?? (selected == null ? preview?.snapshot : undefined);
  const adjustments = saved?.adjustments ?? [];
  const error = review.error || approve.error || adjustment.error || periods.error || detail.error;
  const busy = review.isPending || approve.isPending || adjustment.isPending;
  const changeRange = (setter: (value: string) => void, value: string) => {
    setter(value); setPreview(null); review.reset(); approve.reset();
  };
  const knownGross = (t: { userId: number; grossPay: number | null; p4pEarnings: number; acquisitionBonusPay?: number }) =>
    t.grossPay ?? (data?.p4pOnlyApproval?.employeeIds.includes(t.userId) ? t.p4pEarnings + (t.acquisitionBonusPay ?? 0) : null);
  const originalTotal = data?.summary.technicians.some(t => knownGross(t) == null) ? null
    : data?.summary.technicians.reduce((sum, t) => sum + (knownGross(t) ?? 0), 0) ?? 0;
  const adjustmentTotal = adjustments.reduce((cents, a) => cents + Math.round(a.amount * 100), 0) / 100;
  const missingGuarantee = data?.summary.technicians.filter(t => t.clockHours > 0 && t.basePay == null) ?? [];
  const missingDamageGuarantee = data?.summary.technicians.filter(t => (t.damageDeduction ?? 0) > 0 && t.basePay == null) ?? [];

  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4">
      <div><h1 className="text-3xl font-bold">Finalized Payroll</h1><p className="text-muted-foreground">Review, approve, and correct payroll without rewriting history.</p></div>
      <Button variant="outline" onClick={onBack}>Back to live estimates</Button>
    </div>
    <p className="text-sm text-muted-foreground">Payroll uses the greater of the hourly guarantee or P4P earnings. Rate edits take effect when saved. Rates from before history tracking began use the existing rate as their baseline. Daily task pay is informational in live estimates and is not added to this gross pay.</p>
    {canApprove && <Card><CardHeader><CardTitle>Finalize a completed period</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Choose inclusive dates in your company timezone. Review all employees before approval. Finalized periods cannot overlap or be reopened.</p>
      <div className="flex gap-4 items-end flex-wrap">
        <div><Label htmlFor="payroll-from">From</Label><Input id="payroll-from" type="date" value={dateFrom} disabled={busy} onChange={e => changeRange(setDateFrom, e.target.value)} /></div>
        <div><Label htmlFor="payroll-to">Through</Label><Input id="payroll-to" type="date" value={dateTo} disabled={busy} onChange={e => changeRange(setDateTo, e.target.value)} /></div>
        <Button disabled={busy || !dateFrom || !dateTo} onClick={() => { setSelected(null); review.mutate(); }}>Review payroll</Button>
      </div>
    </CardContent></Card>}
    <div className="space-y-2"><Label htmlFor="payroll-history">Approved periods</Label>
      <select id="payroll-history" className="w-full rounded-md border bg-background p-2" disabled={busy} value={selected ?? ""} onChange={e => {
        setSelected(e.target.value ? Number(e.target.value) : null); setPreview(null);
        setEmployee(""); setAmount(""); setReason(""); adjustment.reset(); review.reset(); approve.reset();
      }}>
        <option value="">{periods.isLoading ? "Loading…" : "Select finalized payroll"}</option>
        {periods.data?.map(p => <option key={p.id} value={p.id}>
          {p.dateFrom} – {p.dateTo} ({p.timezone}) · approved by {p.approvedByName}
        </option>)}
      </select>
      {periods.data?.length === 0 && <p className="text-sm text-muted-foreground">No finalized periods yet.</p>}
    </div>
    {error && <div role="alert" className="rounded-md border border-destructive p-3 text-destructive">{error instanceof Error ? error.message : "Unable to load payroll. Please retry."}</div>}
    {selected != null && detail.isLoading && <p>Loading finalized payroll…</p>}
    {data && <>
      <Card><CardHeader><CardTitle>{saved ? "Locked original payroll" : "Payroll review"}</CardTitle>
        <p className="text-sm text-muted-foreground">{data.dateFrom} through {data.dateTo} ({data.timezone})</p>
        {saved && <p className="text-sm">Approved by {saved.approvedByName} · {new Date(saved.approvedAt).toLocaleString()}</p>}
      </CardHeader><CardContent className="space-y-4">
        <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Hours at each rate</TableHead><TableHead>Base guarantee</TableHead><TableHead>P4P before damage</TableHead><TableHead>Approved damage</TableHead><TableHead>Net P4P</TableHead><TableHead>Damage pay impact</TableHead><TableHead>Original gross</TableHead><TableHead>Adjustments</TableHead><TableHead>Adjusted gross</TableHead></TableRow></TableHeader>
          <TableBody>{data.summary.technicians.map(t => {
            const delta = adjustments.filter(a => a.userId === t.userId).reduce((cents, a) => cents + Math.round(a.amount * 100), 0) / 100;
             const gross = knownGross(t);
            return <TableRow key={t.userId}><TableCell>{t.name}</TableCell>
              <TableCell>{t.rateSegments.length ? t.rateSegments.map((s, i) => <div key={i}>{s.hours.toFixed(2)}h × {s.rate == null ? "Not configured" : `${money(s.rate)}/hr`}</div>) : `0h · ${t.baseHourlyRate == null ? "No base rate" : money(t.baseHourlyRate) + "/hr"}`}</TableCell>
              <TableCell>{t.basePay == null ? (t.clockHours > 0 ? "Missing historical rate — P4P only" : "Not configured") : money(t.basePay)}</TableCell><TableCell>{money(t.p4pBeforeDamage ?? t.p4pEarnings)}</TableCell>
              <TableCell data-testid={`text-snapshot-damage-${t.userId}`}>{(t.damageDeduction ?? 0) > 0 ? <span className="text-rose-700">−{money(t.damageDeduction ?? 0)}</span> : "—"}
                {t.damageReportIds?.length ? <div className="text-xs text-muted-foreground">Report{t.damageReportIds.length > 1 ? "s" : ""} {t.damageReportIds.map(id => `#${id}`).join(", ")}</div> : null}</TableCell>
              <TableCell className="font-medium">{money(t.p4pEarnings)}</TableCell>
              <TableCell>{!(t.damageDeduction ?? 0) ? "—" : t.damagePayReduction == null ? <span className="text-amber-700">Not configured</span> : t.damagePayReduction > 0 ? money(t.damagePayReduction) : "Hourly floor protected"}</TableCell>
              <TableCell>{gross == null ? "Not configured" : money(gross)}</TableCell><TableCell>{money(delta)}</TableCell><TableCell className="font-bold">{gross == null ? "Not configured" : money(gross + delta)}</TableCell>
            </TableRow>;
          })}</TableBody>
        </Table></div>
        {data.summary.technicians.some(t => t.damageReportIds?.length) && <p className="text-xs text-muted-foreground">Damage report numbers match the P4P Damage Reports section on the live estimates screen, where each report keeps its approval and void audit trail. Approving a damage report is not final payroll approval; only this screen locks payroll. Deductions are capped at this period's P4P and unused amounts do not carry forward.</p>}
        {!saved && missingDamageGuarantee.length > 0 && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">Approved damage applies to employees with no known hourly guarantee ({missingDamageGuarantee.map(t => t.name).join(", ")}). This period cannot be finalized, even with a P4P-only reason. Resolve missing rate history or void the damage report first. Saving a current rate does not backdate historical pay.</div>}
        <p className="font-semibold">Original total: {originalTotal == null ? "Not configured" : money(originalTotal)} · Adjustments: {money(adjustmentTotal)} · Adjusted total: {originalTotal == null ? "Not configured" : money(originalTotal + adjustmentTotal)}</p>
        {data.p4pOnlyApproval && <div className="rounded-md border border-amber-400 p-3 text-sm">
          <p className="font-semibold">P4P-only approval — no complete historical hourly guarantee</p>
          <p>Employees: {data.summary.technicians.filter(t => data.p4pOnlyApproval?.employeeIds.includes(t.userId)).map(t => t.name).join(", ")}</p>
          <p>Recorded reason: {data.p4pOnlyApproval.reason}</p>
          <p>Authorized by {saved?.approvedByName} at {saved ? new Date(saved.approvedAt).toLocaleString() : ""}. Original hourly rates remain unconfigured; later corrections require an audited adjustment.</p>
        </div>}
        {!saved && canApprove && preview && <div className="space-y-2">
          {missingGuarantee.length > 0 && missingDamageGuarantee.length === 0 && <div className="rounded-md border border-amber-400 p-3 space-y-2">
            <p className="font-semibold">Explicit P4P-only approval required</p>
            <p className="text-sm">Historical hourly rates are missing for {missingGuarantee.map(t => t.name).join(", ")}. Their proposed gross is P4P earnings only, which may be $0. Saving a current hourly rate will not backdate it. Approve only if this pay basis is appropriate; any later correction must be an audited adjustment.</p>
            <Label htmlFor="p4p-only-reason">Why is P4P-only pay appropriate for these employees?</Label>
            <Input id="p4p-only-reason" required maxLength={2000} value={p4pOnlyReason} disabled={busy} onChange={e => setP4pOnlyReason(e.target.value)} />
          </div>}
          <p className="text-sm">Approval permanently locks these values. Later corrections must be entered as separate, audited adjustments.</p>
          <Button disabled={busy || !data.summary.technicians.length || missingDamageGuarantee.length > 0 || (missingGuarantee.length > 0 && !p4pOnlyReason.trim())} onClick={() => approve.mutate()}>{approve.isPending ? "Finalizing…" : "Approve and lock payroll"}</Button>
        </div>}
      </CardContent></Card>
      <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Recorded job breakdown ({data.jobs.length})</summary>
        <div className="overflow-x-auto mt-3"><Table><TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Revenue</TableHead><TableHead>Materials</TableHead><TableHead>P4P rate</TableHead><TableHead>P4P pool</TableHead><TableHead>Employee earnings</TableHead></TableRow></TableHeader>
          <TableBody>{data.jobs.map(j => <TableRow key={j.jobId}><TableCell>{j.jobTitle}</TableCell><TableCell>{money(j.totalAmount)}</TableCell><TableCell>{money(j.materialCost)}</TableCell><TableCell>{j.p4pPct}%</TableCell><TableCell>{money(j.p4pPool)}</TableCell><TableCell>{j.splits.map(s => <div key={s.userId}>{s.name}: {money(s.earnings)} ({s.contributionPct}%)</div>)}</TableCell></TableRow>)}</TableBody>
        </Table></div>
      </details>
      {saved && <Card><CardHeader><CardTitle>Audited adjustments</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Original rates and totals never change. To reverse a correction, add an opposite amount with an explanation.</p>
        {adjustments.length === 0 ? <p>No adjustments recorded.</p> : <ul className="space-y-3">{adjustments.map(a => <li key={a.id} className="border-b pb-2">
          <strong>{data.summary.technicians.find(t => t.userId === a.userId)?.name}: {money(a.amount)}</strong> — {a.reason}
          <p className="text-xs text-muted-foreground">{a.createdByName} · {new Date(a.createdAt).toLocaleString()}</p>
        </li>)}</ul>}
        {canApprove && <form className="space-y-3" onSubmit={e => { e.preventDefault(); adjustment.mutate(); }}>
          <Label htmlFor="adjustment-employee">Employee</Label>
          <select required id="adjustment-employee" className="block w-full rounded-md border bg-background p-2" value={employee} onChange={e => setEmployee(e.target.value)} disabled={busy}>
            <option value="">Choose employee</option>{data.summary.technicians.map(t => <option key={t.userId} value={t.userId}>{t.name}</option>)}
          </select>
          <Label htmlFor="adjustment-amount">Signed adjustment ($; negative to deduct)</Label>
          <Input required id="adjustment-amount" type="number" step="0.01" min="-1000000" max="1000000" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} />
          <Label htmlFor="adjustment-reason">Reason (required)</Label>
          <Input required id="adjustment-reason" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} />
          <Button disabled={busy || !employee || !Number(amount) || !reason.trim()}>Record audited adjustment</Button>
        </form>}
      </CardContent></Card>}
    </>}
  </div>;
}
