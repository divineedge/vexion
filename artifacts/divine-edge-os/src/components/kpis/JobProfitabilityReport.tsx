import { useMemo, useState } from 'react';
import type { JobEconomicsJob } from '@workspace/api-client-react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JobEconomicsDetail } from './JobEconomicsDetail';
import { budgetTotalCost, downloadCsv, fmtMoney, fmtMin, fmtPct, isTimed, jobsCsv, overCost, overTime } from '@/lib/jobEconomics';

const PAGE = 25;
type Key = 'completedDate' | 'title' | 'customerName' | 'revenue' | 'minutes' | 'totalCost' | 'profit' | 'marginPct';
const COLS: { k: Key; l: string }[] = [{ k: 'completedDate', l: 'Completed' }, { k: 'title', l: 'Job' }, { k: 'customerName', l: 'Customer' }, { k: 'revenue', l: 'Revenue' }, { k: 'minutes', l: 'Minutes' }, { k: 'totalCost', l: 'Total cost' }, { k: 'profit', l: 'Contribution' }, { k: 'marginPct', l: 'Margin' }];

export function JobProfitabilityReport({ jobs, header, fileStem }: { jobs: JobEconomicsJob[]; header: string[][]; fileStem: string }) {
  const [q, setQ] = useState(''); const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'completedDate', dir: -1 });
  const [page, setPage] = useState(0); const [openId, setOpenId] = useState<number | null>(null);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = s ? jobs.filter(j => `${j.id} ${j.title} ${j.customerName} ${j.serviceName} ${j.propertyAddress ?? ''}`.toLowerCase().includes(s)) : jobs;
    return [...r].sort((a, b) => { const x = a[sort.k], y = b[sort.k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [jobs, q, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); const cur = Math.min(page, pages - 1);
  const openJob = jobs.find(j => j.id === openId) ?? null;
  return (
    <div className="space-y-3" data-testid="section-job-profitability">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-72"><Search className="w-4 h-4 absolute left-2 top-2 text-muted-foreground" />
          <Input aria-label="Search jobs" placeholder="Search job, customer, service…" className="h-8 pl-8" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} data-testid="input-search-jobs" /></div>
        <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => downloadCsv(`${fileStem}-jobs.csv`, jobsCsv(rows, header))} data-testid="button-export-jobs"><Download className="w-4 h-4 mr-1" />Export CSV ({rows.length})</Button>
      </div>
      {rows.length === 0 ? <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">No completed jobs match.</div> : <>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-muted/50 text-muted-foreground"><tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium [&>th]:whitespace-nowrap">
              {COLS.slice(0, 4).map(c => <SortTh key={c.k} c={c} sort={sort} set={k => { setSort(s => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 })); setPage(0); }} />)}
              <th>Budget rev.</th><th>Budget min</th>
              <SortTh c={COLS[4]} sort={sort} set={k => setSort(s => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))} />
              <th>Labor</th><th>Inventory</th><th>Fuel</th><th>Other</th>
              {COLS.slice(5).map(c => <SortTh key={c.k} c={c} sort={sort} set={k => setSort(s => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))} />)}
            </tr></thead>
            <tbody className="divide-y">
              {rows.slice(cur * PAGE, (cur + 1) * PAGE).map(j => {
                const oc = overCost(j), ot = overTime(j), neg = j.profit != null && j.profit < 0;
                return (
                  <tr key={j.id} tabIndex={0} role="button" aria-label={`Open ${j.title}`} onClick={() => setOpenId(j.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(j.id); } }}
                    className={`[&>td]:px-2 [&>td]:py-1.5 [&>td]:whitespace-nowrap cursor-pointer hover:bg-muted/40 focus:outline-none focus:bg-muted/50 ${neg ? 'bg-red-50/60 dark:bg-red-950/20' : ''}`} data-testid={`row-job-${j.id}`}>
                    <td>{j.completedDate}</td>
                    <td className="max-w-[220px] truncate font-medium">{j.title}{j.issues.length > 0 && <span className="ml-1 text-amber-700" title={j.issues.join('; ')}>•</span>}</td>
                    <td className="max-w-[160px] truncate">{j.customerName}</td>
                    <td>{fmtMoney(j.revenue)}</td><td className="text-muted-foreground">{fmtMoney(j.budgetRevenue, '—')}</td>
                    <td className="text-muted-foreground">{fmtMin(j.budgetMinutes, '—')}</td>
                    <td className={ot ? 'text-red-600 font-semibold' : ''}>{j.hasOpenTimers ? <span className="text-amber-700">Open timer</span> : fmtMin(isTimed(j) ? j.minutes : null)}</td>
                    <td>{fmtMoney(j.laborCost)}</td><td>{fmtMoney(j.materialCost)}</td><td>{fmtMoney(j.fuelCost)}</td><td>{fmtMoney(j.otherCost)}</td>
                    <td className={oc ? 'text-red-600 font-semibold' : ''} title={budgetTotalCost(j) != null ? `Budget ${fmtMoney(budgetTotalCost(j))}` : undefined}>{fmtMoney(j.totalCost, 'Incomplete')}</td>
                    <td className={neg ? 'text-red-600 font-semibold' : ''}>{fmtMoney(j.profit, 'Incomplete')}</td>
                    <td className={neg ? 'text-red-600' : ''}>{fmtPct(j.marginPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {cur * PAGE + 1}–{Math.min(rows.length, (cur + 1) * PAGE)} of {rows.length} · red = over budget or negative contribution</span>
          {pages > 1 && <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Previous page" disabled={cur === 0} onClick={() => setPage(cur - 1)} data-testid="button-jobs-prev"><ChevronLeft className="w-4 h-4" /></Button>
            <span>Page {cur + 1} / {pages}</span>
            <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Next page" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} data-testid="button-jobs-next"><ChevronRight className="w-4 h-4" /></Button>
          </div>}
        </div>
      </>}
      <JobEconomicsDetail job={openJob} onClose={() => setOpenId(null)} />
    </div>
  );
}

function SortTh({ c, sort, set }: { c: { k: Key; l: string }; sort: { k: Key; dir: 1 | -1 }; set: (k: Key) => void }) {
  const on = sort.k === c.k;
  return <th aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => set(c.k)} data-testid={`button-sort-${c.k}`}>{c.l}{on && (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}</button></th>;
}
