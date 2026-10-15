import { Fragment, useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { JobEconomicsJob } from '@workspace/api-client-react';
import { ChevronDown, ChevronRight, Download, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { buildGroups, groupsCsv, downloadCsv, areaFactor, areaLabel, fmtMoney, fmtMin, fmtPct, fmtNum, isTimed, type AreaDisplay, type GroupMode, type UnitStats } from '@/lib/jobEconomics';

function Ratio({ s, kind, mul, unit }: { s: UnitStats; kind: 'cost' | 'price' | 'time'; mul: number; unit: string }) {
  const v = kind === 'cost' ? s.costPerUnit : kind === 'price' ? s.pricePerUnit : s.minutesPerUnit;
  const n = kind === 'cost' ? s.costCohort : kind === 'price' ? s.priceCohort : s.timeCohort;
  if (v == null) return <span className="text-muted-foreground text-xs">Not enough data</span>;
  return <span title={`${n} of ${s.measured} measured jobs in cohort`}>{kind === 'time' ? `${fmtNum(v * mul, 1)} min` : fmtMoney(v * mul)}<span className="text-[10px] text-muted-foreground"> /{unit} · n={n}</span></span>;
}

export function ServicePerformanceReport({ jobs, header, fileStem }: { jobs: JobEconomicsJob[]; header: string[][]; fileStem: string }) {
  const [mode, setMode] = useState<GroupMode>('service');
  const [area, setArea] = useState<AreaDisplay>('k_sqft');
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => buildGroups(jobs, mode), [jobs, mode]);
  const f = areaFactor(area), al = areaLabel(area);
  const tot = useMemo(() => {
    const cc = jobs.filter(j => j.totalCost != null);
    const rev = cc.reduce((s, j) => s + j.revenue, 0), cost = cc.reduce((s, j) => s + (j.totalCost as number), 0);
    return { revenue: jobs.reduce((s, j) => s + j.revenue, 0), cc: cc.length, contribution: cc.length ? rev - cost : null, margin: cc.length && rev ? ((rev - cost) / rev) * 100 : null, hours: jobs.filter(isTimed).reduce((s, j) => s + j.minutes, 0) / 60 };
  }, [jobs]);

  return (
    <div className="space-y-3" data-testid="section-service-performance">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Job-price revenue', fmtMoney(tot.revenue), `${jobs.length} jobs`],
          ['Recorded-cost contribution', fmtMoney(tot.contribution, 'Incomplete'), `Before overhead · ${tot.cc} of ${jobs.length} cost-complete`],
          ['Contribution margin', fmtPct(tot.margin), 'Cost-complete jobs only'],
          ['Recorded person-hours', fmtNum(tot.hours, 1), 'Timed jobs, no open timers']].map(([l, v, s]) => (
          <div key={l} className="rounded-xl border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">{l}</p><p className="text-xl font-bold tabular-nums mt-1" data-testid={`text-sp-${l}`}>{v}</p><p className="text-[11px] text-muted-foreground">{s}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Group by">
            {(['service', 'matrix'] as const).map(m => <Button key={m} size="sm" variant={mode === m ? 'default' : 'ghost'} className="h-7 text-xs" aria-pressed={mode === m} onClick={() => { setMode(m); setOpen(null); }} data-testid={`button-group-${m}`}>{m === 'service' ? 'By service' : 'By pricing matrix'}</Button>)}
          </div>
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Area unit">
            {(['k_sqft', 'acre'] as const).map(a => <Button key={a} size="sm" variant={area === a ? 'secondary' : 'ghost'} className="h-7 text-xs" aria-pressed={area === a} onClick={() => setArea(a)} data-testid={`button-area-${a}`}>per {areaLabel(a)}</Button>)}
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={!groups.length} onClick={() => downloadCsv(`${fileStem}-service-${mode}.csv`, groupsCsv(groups, header, area))} data-testid="button-export-groups"><Download className="w-4 h-4 mr-1" />Export CSV</Button>
      </div>

      {groups.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No completed jobs match these filters.</CardContent></Card> : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-muted/50 text-muted-foreground"><tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium [&>th]:whitespace-nowrap">
              <th>{mode === 'service' ? 'Service' : 'Service / tier / unit'}</th><th>Jobs</th><th>Timed</th><th>Avg person-min</th><th>Person-hrs</th><th>Revenue</th><th>Cost coverage</th><th>Contribution</th><th>Margin</th>
              <th>Cost /{al}</th><th>Price /{al}</th><th>Time /{al}</th><th>Cost /lin ft</th><th>Price /lin ft</th><th>Time /lin ft</th>
            </tr></thead>
            <tbody className="divide-y">
              {groups.map(g => (
                <Fragment key={g.key}>
                  <tr className={`[&>td]:px-2 [&>td]:py-2 [&>td]:whitespace-nowrap hover:bg-muted/30 ${g.kind !== 'service' ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}`}>
                    <td className="min-w-[200px]">
                      <button type="button" className="flex items-start gap-1 text-left" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)} data-testid={`button-group-drill-${g.key}`}>
                        {open === g.key ? <ChevronDown className="w-3.5 h-3.5 mt-0.5" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5" />}
                        <span><span className="font-medium text-sm">{g.label}</span>{g.sub && <span className={`block text-[11px] whitespace-normal ${g.sub.includes('historical') ? 'text-amber-700' : 'text-muted-foreground'}`}>{g.sub}</span>}
                          {g.kind === 'multi' && <span className="block text-[11px] text-amber-700 whitespace-normal">Whole-job costs not split across services</span>}</span>
                      </button>
                    </td>
                    <td>{g.jobCount}</td><td>{g.timedCount}{g.openTimerCount > 0 && <span className="text-amber-700" title="Open timers excluded"> ({g.openTimerCount} open)</span>}</td>
                    <td>{fmtMin(g.avgMinutes, 'Not recorded')}</td><td>{fmtNum(g.personHours, 1)}</td><td>{fmtMoney(g.revenue)}</td>
                    <td><span className={g.costCompleteCount < g.jobCount ? 'text-amber-700' : ''}>{g.costCompleteCount}/{g.jobCount}</span></td>
                    <td className={g.contribution != null && g.contribution < 0 ? 'text-red-600 font-semibold' : ''}>{fmtMoney(g.contribution, 'Incomplete')}</td>
                    <td>{fmtPct(g.marginPct)}</td>
                    <td><Ratio s={g.sqft} kind="cost" mul={f} unit={al} /></td><td><Ratio s={g.sqft} kind="price" mul={f} unit={al} /></td><td><Ratio s={g.sqft} kind="time" mul={f} unit={al} /></td>
                    <td><Ratio s={g.linear} kind="cost" mul={1} unit="ft" /></td><td><Ratio s={g.linear} kind="price" mul={1} unit="ft" /></td><td><Ratio s={g.linear} kind="time" mul={1} unit="ft" /></td>
                  </tr>
                  {open === g.key && (
                    <tr><td colSpan={15} className="bg-muted/20 p-2">
                      <div className="divide-y rounded border bg-background">
                        {g.jobs.map(j => (
                          <div key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5" data-testid={`row-drill-job-${j.id}`}>
                            <Link href={`/schedule?jobId=${j.id}`} className="text-primary hover:underline font-medium min-w-[160px]" data-testid={`link-drill-job-${j.id}`}>{j.title}</Link>
                            <span className="text-muted-foreground">{j.completedDate} · {j.customerName}</span>
                            <span>{fmtMoney(j.revenue)}</span>
                            <span>{j.hasOpenTimers ? <span className="text-amber-700">Open timer</span> : fmtMin(j.minutes > 0 ? j.minutes : null)}</span>
                            <span>Cost {fmtMoney(j.totalCost, 'Incomplete')}</span>
                            <span className="text-muted-foreground truncate max-w-[260px]">{j.workers.map(w => w.name).join(', ') || 'No workers recorded'}</span>
                            {j.measurement != null && <span>{fmtNum(j.measurement, 0)} {j.measurementUnit === 'linear_ft' ? 'lin ft' : 'sq ft'}</span>}
                            {j.issues.length > 0 && <span className="text-amber-700">{j.issues.join('; ')}</span>}
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground flex gap-2"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>Contribution is job-price revenue minus recorded cost on cost-complete jobs only — before overhead, payroll burden, P4P top-ups and unallocated fleet expenses. It is not net profit. Per-unit ratios use matching cohorts (n): cost uses measured cost-complete jobs, price uses measured priced jobs, time uses measured timed jobs. Area and linear feet are never combined.</span></div>
    </div>
  );
}
