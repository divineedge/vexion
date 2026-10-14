import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ArrowUpRight, Calculator, Info, RefreshCw, Scale } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { migrateBudgetPayload } from '@/lib/budgetCalc';
import { pricingBudgetRate, recommendedJobPrice } from '@/lib/pricingBudget';

interface PricingJob {
  id: number; title: string; customerId: number | null; customerName: string | null; propertyAddress: string | null;
  serviceId: number | null; serviceName: string | null; pricingType: string | null; completedAt: string;
  recordedMinutes: number; totalAmount: number; materialSellAmount: number; hasOpenTimers: boolean; materialSnapshotMissing?: boolean;
}
interface PricingReport { budgetJson: string | null; jobs: PricingJob[]; missingCompletionDates: number }

type Exclusion = 'no_time' | 'open_timer' | 'no_price' | 'materials' | 'budget';
const EXCLUSION_LABEL: Record<Exclusion, string> = {
  no_time: 'No closed time recorded',
  open_timer: 'Has open timers',
  no_price: 'Historical price is $0 or less',
  materials: 'Material records invalid or missing price snapshot',
  budget: 'Budget missing or not configured',
};

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (n: number) => Math.round(n * 100);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function PricingReviewPage() {
  const { canManageOffice } = useAuth();
  const { can } = usePermissions();
  const allowed = canManageOffice && can('pages.billing');

  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), 0, 1)));
  const [to, setTo] = useState(iso(today));
  const [yearSel, setYearSel] = useState<string>('');
  const [target, setTarget] = useState<string>('auto');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [threshold, setThreshold] = useState('25');
  const [minSample, setMinSample] = useState('5');

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PricingReport>({
    queryKey: ['pricing-review', from, to],
    queryFn: () => customFetch<PricingReport>(`/api/reports/pricing-review?from=${from}&to=${to}`),
    enabled: allowed && !!from && !!to && from <= to,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const budgetYears = useMemo(() => {
    if (!data?.budgetJson) return [];
    try { return migrateBudgetPayload(JSON.parse(data.budgetJson)); } catch { return []; }
  }, [data?.budgetJson]);
  const year = budgetYears.find(y => String(y.year) === yearSel) ?? budgetYears.find(y => y.year === today.getFullYear()) ?? budgetYears[0];
  const perService = target === 'auto' && serviceFilter === 'all';
  const rate = useMemo(() => pricingBudgetRate(year, serviceFilter === 'all' ? null : Number(serviceFilter), target), [year, serviceFilter, target]);
  const budgetValid = perService ? !!year && year.divisions.some(d => {
    const divisionRate = pricingBudgetRate(year, null, d.id);
    return !!divisionRate && Number.isFinite(divisionRate.hourly) && divisionRate.hourly > 0;
  }) : !!rate && Number.isFinite(rate.hourly) && rate.hourly > 0;

  const services = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of data?.jobs ?? []) if (j.serviceId != null) m.set(String(j.serviceId), j.serviceName ?? `Service #${j.serviceId}`);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data?.jobs]);

  const rows = useMemo(() => (data?.jobs ?? [])
    .filter(j => serviceFilter === 'all' || String(j.serviceId) === serviceFilter)
    .map(j => {
      const jobRate = pricingBudgetRate(year, j.serviceId, target);
      const reasons: Exclusion[] = [];
      if (!jobRate || !Number.isFinite(jobRate.hourly) || jobRate.hourly <= 0 || !Number.isFinite(jobRate.floor)) reasons.push('budget');
      if (!(j.recordedMinutes > 0)) reasons.push('no_time');
      if (j.hasOpenTimers) reasons.push('open_timer');
      if (!(j.totalAmount > 0)) reasons.push('no_price');
      if (j.materialSnapshotMissing) reasons.push('materials');
      const hours = j.recordedMinutes / 60;
      let recommended: number | null = null;
      if (reasons.length === 0 && jobRate) {
        recommended = recommendedJobPrice(hours, j.materialSellAmount || 0, jobRate);
      }
      const comparable = reasons.length === 0 && recommended != null;
      const underpriced = comparable && cents(j.totalAmount) < cents(recommended!);
      const shortfall = underpriced ? recommended! - j.totalAmount : 0;
      return { j, hours, recommended, reasons, comparable, underpriced, shortfall, jobRate };
    }), [data?.jobs, serviceFilter, year, target]);

  const thresholdN = Math.max(0, Number(threshold) || 0);
  const minSampleN = Math.max(1, Math.floor(Number(minSample) || 1));

  const matrix = useMemo(() => {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      if (r.j.pricingType !== 'matrix' || r.j.serviceId == null) continue;
      const k = String(r.j.serviceId);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return Array.from(groups.entries()).map(([sid, rs]) => {
      const comp = rs.filter(r => r.comparable);
      const under = comp.filter(r => r.underpriced).length;
      const pct = comp.length ? (under / comp.length) * 100 : 0;
      const hist = comp.reduce((s, r) => s + r.j.totalAmount, 0);
      const short = comp.reduce((s, r) => s + r.shortfall, 0);
      return {
        sid, name: rs[0].j.serviceName ?? `Service #${sid}`, total: rs.length, comparable: comp.length, under, pct,
        excluded: rs.length - comp.length, uplift: hist > 0 ? (short / hist) * 100 : 0,
        sampleMet: comp.length >= minSampleN, review: comp.length >= minSampleN && pct > thresholdN,
      };
    }).sort((a, b) => b.pct - a.pct);
  }, [rows, minSampleN, thresholdN]);

  const exclusionCounts = useMemo(() => {
    const c: Record<Exclusion, number> = { no_time: 0, open_timer: 0, no_price: 0, materials: 0, budget: 0 };
    for (const r of rows) for (const x of r.reasons) c[x]++;
    return c;
  }, [rows]);
  const comparableCount = rows.filter(r => r.comparable).length;
  const underCount = rows.filter(r => r.underpriced).length;

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Scale className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Pricing review is restricted</h2>
        <p className="text-muted-foreground max-w-sm">Only users with Budget access can review job pricing against the budget.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500" data-testid="page-pricing-review">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Scale className="w-6 h-6 text-primary" /> Pricing Review</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Compares what completed jobs were charged against what your saved budget says they needed to earn. Advisory only. Nothing here changes prices.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} data-testid="button-refresh-pricing">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7 items-end">
          <Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} data-testid="input-from" /></Field>
          <Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} data-testid="input-to" /></Field>
          <Field label="Budget year">
            <Select value={year ? String(year.year) : ''} onValueChange={v => { setYearSel(v); setTarget('auto'); }} disabled={budgetYears.length === 0}>
              <SelectTrigger data-testid="select-budget-year"><SelectValue placeholder="No saved budget" /></SelectTrigger>
              <SelectContent>{budgetYears.map(y => <SelectItem key={y.year} value={String(y.year)}>{y.year}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Target">
            <Select value={target} onValueChange={setTarget} disabled={!year}>
              <SelectTrigger data-testid="select-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Service's budget division (automatic)</SelectItem>
                <SelectItem value="company">Company total</SelectItem>
                {(year?.divisions ?? []).map(d => <SelectItem key={d.id} value={d.id}>Division: {d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Service">
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger data-testid="select-service"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All services</SelectItem>
                {services.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Matrix threshold %"><Input type="number" min={0} step="1" value={threshold} onChange={e => setThreshold(e.target.value)} data-testid="input-threshold" /></Field>
          <Field label="Min comparable jobs"><Input type="number" min={1} step="1" value={minSample} onChange={e => setMinSample(e.target.value)} data-testid="input-min-sample" /></Field>
        </CardContent>
      </Card>

      {from > to && <Notice tone="warn">The From date is after the To date.</Notice>}

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : isError ? (
        <Card><CardContent className="p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto text-destructive" />
          <p className="text-sm">Pricing review could not be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </CardContent></Card>
      ) : data && (
        <>
          {!budgetValid && (
            <Notice tone="warn">
              {budgetYears.length === 0
                ? 'No saved budget was found. Jobs are listed but none can be compared. Set up and save a budget first; this page never creates one for you.'
                : `The selected budget target produces no usable required hourly rate. Check the ${rate?.label ?? 'selected'} budget inputs.`}
              {' '}<Link href="/budget" className="underline font-medium">Open Budget</Link>
            </Notice>
          )}

          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Required hourly rate" value={perService && budgetValid ? 'By service' : budgetValid && rate ? money(rate.hourly) : 'Not available'} hint={perService ? 'Each job uses its service division; unassigned uses company' : rate?.label ?? 'No budget target'} />
            <Stat label="Minimum show-up floor" value={perService && budgetValid ? 'By service' : budgetValid && rate ? (rate.floor > 0 ? money(rate.floor) : 'None') : '—'} hint={perService ? 'Applied separately to each job before materials' : 'From the selected budget minimum visit hours'} />
            <Stat label="Comparable jobs" value={`${comparableCount} of ${rows.length}`} hint={`${rows.length - comparableCount} excluded`} />
            <Stat label="Underpriced" value={String(underCount)} hint={comparableCount ? `${((underCount / comparableCount) * 100).toFixed(1)}% of comparable` : 'No comparable jobs'} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" /> Matrix services</CardTitle>
              <CardDescription>
                A whole-matrix review is recommended only when more than {thresholdN}% of comparable completed jobs were underpriced and at least {minSampleN} comparable jobs exist. Indicative uplift is the sum of job shortfalls divided by the sum of historical prices.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {matrix.length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 pb-6">No matrix-priced services completed in this period.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Service</TableHead><TableHead className="text-right">Comparable</TableHead>
                    <TableHead className="text-right">Underpriced</TableHead><TableHead className="text-right">Excluded</TableHead>
                    <TableHead className="text-right">Indicative uplift</TableHead><TableHead>Advice</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {matrix.map(m => (
                      <TableRow key={m.sid} data-testid={`row-matrix-${m.sid}`}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.comparable}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.under} <span className="text-muted-foreground">({m.pct.toFixed(1)}%)</span></TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{m.excluded}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.comparable ? `${m.uplift.toFixed(1)}%` : '—'}</TableCell>
                        <TableCell>
                          {m.review ? <Badge className="bg-amber-100 text-amber-900 border-transparent">Review whole matrix (advisory)</Badge>
                            : !m.sampleMet ? <span className="text-xs text-muted-foreground">Sample too small ({m.comparable}/{minSampleN})</span>
                            : <span className="text-xs text-muted-foreground">Within threshold</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Completed jobs</CardTitle>
              <CardDescription>Recommended = the greater of labor hours × budget hourly target or the budget minimum show-up cost, plus recorded material selling prices.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 pb-6">No completed jobs in this period{serviceFilter !== 'all' ? ' for this service' : ''}.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Job</TableHead><TableHead>Service</TableHead><TableHead>Budget used</TableHead><TableHead>Completed</TableHead>
                    <TableHead className="text-right">Person-hours</TableHead><TableHead className="text-right">Materials (sell)</TableHead>
                    <TableHead className="text-right">Charged</TableHead><TableHead className="text-right">Recommended</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rows.map(({ j, hours, recommended, reasons, underpriced, shortfall, jobRate }) => (
                      <TableRow key={j.id} data-testid={`row-job-${j.id}`}>
                        <TableCell>
                          <Link href={`/schedule?jobId=${j.id}`} className="font-medium hover:underline inline-flex items-center gap-1" data-testid={`link-job-${j.id}`}>
                            {j.title} <ArrowUpRight className="w-3 h-3" />
                          </Link>
                          <p className="text-xs text-muted-foreground truncate max-w-[220px]">{j.customerName ?? 'No customer'}{j.propertyAddress ? ` · ${j.propertyAddress}` : ''}</p>
                        </TableCell>
                        <TableCell className="text-sm">{j.serviceName ?? '—'}{j.pricingType === 'matrix' && <Badge variant="secondary" className="ml-1.5 font-normal">matrix</Badge>}</TableCell>
                        <TableCell className="text-xs" data-testid={`text-job-budget-${j.id}`}>
                          {jobRate ? <>{jobRate.label}<span className="block text-muted-foreground">{money(jobRate.hourly)}/person-hour · minimum {money(jobRate.floor)}</span></> : 'No valid budget assignment'}
                        </TableCell>
                        <TableCell className="text-sm">{new Date(j.completedAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{hours.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{j.materialSnapshotMissing ? 'Invalid' : money(j.materialSellAmount || 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(j.totalAmount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{recommended != null ? money(recommended) : '—'}</TableCell>
                        <TableCell>
                          {reasons.length > 0 ? (
                            <span className="text-xs text-muted-foreground">Excluded: {reasons.map(r => EXCLUSION_LABEL[r]).join('; ')}</span>
                          ) : underpriced ? (
                            <Badge className="bg-amber-100 text-amber-900 border-transparent">Under by {money(shortfall)}</Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-800 border-transparent">At or above</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="bg-muted/30">
            <CardContent className="p-4 text-xs text-muted-foreground space-y-1.5">
              <p className="font-medium text-foreground flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> How this was calculated</p>
              <p>Budget: {perService ? 'automatic by service assignment for the selected year; unassigned services use the company budget' : rate ? rate.label : 'none selected'}. Historical prices are each job's recorded total. Person-hours sum closed time entries for every worker on the job.</p>
              <p>Exclusions: {(Object.keys(exclusionCounts) as Exclusion[]).map(k => `${EXCLUSION_LABEL[k]} (${exclusionCounts[k]})`).join(', ')}.
                {data.missingCompletionDates > 0 && ` ${data.missingCompletionDates} completed job${data.missingCompletionDates > 1 ? 's' : ''} had no completion date and could not be placed in the period.`}</p>
              <p>A job counts as underpriced when its charged amount is below the recommended price, compared in rounded cents. This page is advisory: no service, matrix, or job price is changed automatically.</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>{children}</div>;
}
function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
    </CardContent></Card>
  );
}
function Notice({ tone, children }: { tone: 'warn'; children: React.ReactNode }) {
  return (
    <div className={`rounded-md border px-4 py-3 text-sm flex gap-2 ${tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : ''}`}>
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><div>{children}</div>
    </div>
  );
}
