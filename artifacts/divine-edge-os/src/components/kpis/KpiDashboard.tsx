import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Info, RefreshCw, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { loadKpiReport, loadKpiSettings, KPI_CATALOG, type KpiId, type KpiMetric } from '@/lib/kpiApi';
import { buildKpiMetrics } from '@/lib/kpiMetrics';
import { getKpiDefaultRange, validateKpiRange } from '@/lib/kpiDates';

const PAGE_SIZE = 25;
const MAX_YEARS = 10;

export function formatKpiValue(m: Pick<KpiMetric, 'value' | 'format'>): string {
  if (m.value == null || !Number.isFinite(m.value)) return 'Not enough data';
  if (m.format === 'money') return m.value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  if (m.format === 'percent') return `${m.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  return m.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const rangeError = (from: string, to: string): string | null =>
  !from || !to ? 'Choose both a start and end date.' : validateKpiRange(from, to);

export function todayInZone(tz?: string | null): string {
  if(!tz) return '';
  try { return new Date().toLocaleDateString('en-CA', { timeZone: tz }); }
  catch { return ''; }
}

export function KpiDashboard() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { data: tenant, isLoading: tenantLoading, isError: tenantError, refetch: refetchTenant } = useGetTenantSettings({ query: { queryKey: [...getGetTenantSettingsQueryKey(), tenantId], enabled: tenantId != null } });
  const tz = tenant?.timezone ?? null;
  const today = todayInZone(tz);
  const timezoneError = tenantError || (!tenantLoading && !today);
  const thisYear = Number(today.slice(0, 4));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const userAdjusted = useRef(false);
  const [selectedId, setSelectedId] = useState<KpiId | null>(null);
  const [page, setPage] = useState(0);
  const draftError = rangeError(draftFrom, draftTo);

  const settingsQ = useQuery({
    queryKey: ['kpi-settings', tenantId],
    queryFn: loadKpiSettings,
    enabled: tenantId != null,
    staleTime: 60_000, refetchOnMount: true, refetchOnWindowFocus: true,
  });
  const reportQ = useQuery({
    queryKey: ['kpi-report', tenantId, from, to],
    queryFn: () => loadKpiReport(from, to),
    enabled: tenantId != null && !!from && !!to && !rangeError(from, to),
    staleTime: 60_000, refetchOnMount: true, refetchOnWindowFocus: true,
  });

  const sd = settingsQ.data as (typeof settingsQ.data & { defaultDateRange?: string | null; customFrom?: string | null; customTo?: string | null }) | undefined;
  const defaultKey = sd ? `${sd.defaultDateRange ?? 'year_to_date'}|${sd.customFrom ?? ''}|${sd.customTo ?? ''}|${today}` : null;
  useEffect(() => {
    if (!sd || tenantLoading || !today || userAdjusted.current) return;
    const r = getKpiDefaultRange(sd, today);
    setFrom(r.from); setTo(r.to); setDraftFrom(r.from); setDraftTo(r.to); setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultKey, tenantLoading]);

  const metrics = useMemo<KpiMetric[]>(() => (reportQ.data ? buildKpiMetrics(reportQ.data) : []), [reportQ.data]);
  const byId = useMemo(() => new Map<KpiId, KpiMetric>(metrics.map((m: KpiMetric) => [m.id, m])), [metrics]);
  const mainIds = settingsQ.data?.mainKpis ?? [];
  const detailIds = settingsQ.data?.detailKpis ?? [];
  const activeId = selectedId && detailIds.includes(selectedId) ? selectedId : detailIds[0] ?? null;
  const active = activeId ? byId.get(activeId) : undefined;
  const rows = active?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);

  const select = (id: KpiId) => { setSelectedId(id); setPage(0); };
  const applyRange = (f: string, t: string) => { setDraftFrom(f); setDraftTo(t); if (!rangeError(f, t)) { userAdjusted.current = true; setFrom(f); setTo(t); setPage(0); } };
  const resetRange = () => { if (!sd) return; userAdjusted.current = false; const r = getKpiDefaultRange(sd, today); setFrom(r.from); setTo(r.to); setDraftFrom(r.from); setDraftTo(r.to); setPage(0); };
  const years = today ? Array.from({ length: MAX_YEARS }, (_, i) => thisYear - i) : [];
  const nameOf = (id: KpiId) => KPI_CATALOG.find(k => k.id === id)?.name ?? id;

  return (
    <section className="space-y-4" data-testid="section-kpi-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Company KPIs</h2>
          <p className="text-sm text-muted-foreground">
            {from ? `${from} to ${to}` : 'Loading date range'}{userAdjusted.current && <> · <button type="button" className="text-primary hover:underline" onClick={resetRange} data-testid="button-kpi-reset-range">Reset to default</button></>}
            {reportQ.data && <> · {reportQ.data.timezone} · data as of {new Date(reportQ.data.asOf).toLocaleString()}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Quick year">
            {years.slice(0, 4).map(y => {
              const f = `${y}-01-01`, t = y === thisYear ? today : `${y}-12-31`;
              const on = from === f && to === t;
              return <Button key={y} size="sm" variant={on ? 'default' : 'outline'} onClick={() => applyRange(f, t)} data-testid={`button-kpi-year-${y}`}>{y}</Button>;
            })}
          </div>
          <div className="flex items-end gap-1">
            <div><label className="text-[11px] text-muted-foreground block">From</label>
              <Input type="date" className="h-8 w-[140px]" value={draftFrom} onChange={e => setDraftFrom(e.target.value)} data-testid="input-kpi-from" /></div>
            <div><label className="text-[11px] text-muted-foreground block">To</label>
              <Input type="date" className="h-8 w-[140px]" value={draftTo} max={today} onChange={e => setDraftTo(e.target.value)} data-testid="input-kpi-to" /></div>
            <Button size="sm" variant="secondary" disabled={!!draftError || (draftFrom === from && draftTo === to)} onClick={() => applyRange(draftFrom, draftTo)} data-testid="button-kpi-apply-range">
              <CalendarRange className="w-4 h-4 mr-1" />Apply
            </Button>
          </div>
          <Link href="/settings?tab=kpis" className="inline-flex items-center gap-1 h-8 px-2 text-sm rounded-md border hover:bg-muted" title="KPI settings" data-testid="link-kpi-settings"><Settings2 className="w-4 h-4" />Settings</Link>
          <Button size="sm" variant="ghost" onClick={() => { void settingsQ.refetch(); void reportQ.refetch(); }} disabled={reportQ.isFetching || settingsQ.isFetching} data-testid="button-kpi-refresh" title="Refresh KPIs">
            <RefreshCw className={`w-4 h-4 ${reportQ.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
      {draftError && <p className="text-xs text-red-600" data-testid="text-kpi-range-error">{draftError}</p>}

      {(settingsQ.isError || reportQ.isError || timezoneError) ? (
        <Card className="border-red-200"><CardContent className="p-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-red-700"><AlertTriangle className="w-4 h-4" />
            {timezoneError ? 'Could not load the company timezone for KPI dates.' : settingsQ.isError ? 'Could not load KPI settings.' : 'Could not load KPI data for this date range.'}
            <span className="text-muted-foreground">{String(((settingsQ.error ?? reportQ.error) as Error)?.message ?? '')}</span></div>
          <Button size="sm" variant="outline" onClick={() => { if(timezoneError) void refetchTenant(); if (settingsQ.isError) void settingsQ.refetch(); if (reportQ.isError) void reportQ.refetch(); }} data-testid="button-kpi-retry">Retry</Button>
        </CardContent></Card>
      ) : settingsQ.isLoading || reportQ.isLoading || !settingsQ.data || (!from && (mainIds.length > 0 || detailIds.length > 0)) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardContent className="p-6 space-y-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-40" /></CardContent></Card>)}
        </div>
      ) : mainIds.length === 0 && detailIds.length === 0 ? (
        <Card><CardContent className="p-8 text-center space-y-2">
          <p className="font-medium">No KPIs are enabled.</p>
          <p className="text-sm text-muted-foreground">Choose KPI dashboard and detailed view metrics in Settings to start tracking.</p>
          <Link href="/settings?tab=kpis" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid="link-kpi-settings-empty"><Settings2 className="w-4 h-4" />Open KPI settings</Link>
        </CardContent></Card>
      ) : (
        <>
          {mainIds.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {mainIds.map(id => {
                const m = byId.get(id);
                const canOpen = detailIds.includes(id);
                const isActive = canOpen && activeId === id;
                return (
                  <button key={id} type="button" disabled={!canOpen} onClick={() => select(id)}
                    className={`text-left rounded-xl border bg-card p-5 transition-colors ${canOpen ? 'hover:border-primary/60 cursor-pointer' : 'cursor-default'} ${isActive ? 'border-primary ring-1 ring-primary/30' : ''}`}
                    data-testid={`card-kpi-${id}`}>
                    <p className="text-sm font-medium text-muted-foreground">{m?.name ?? nameOf(id)}</p>
                    <p className={`mt-2 tracking-tight ${m?.value == null ? 'text-base font-medium text-muted-foreground' : 'text-3xl font-bold'}`} data-testid={`text-kpi-value-${id}`}>
                      {m ? formatKpiValue(m) : 'Not enough data'}
                    </p>
                    {m?.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.summary}</p>}
                    {m?.warning && <p className="text-xs text-amber-700 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{m.value == null ? 'Data gap' : 'Calculation notes'}</p>}
                  </button>
                );
              })}
            </div>
          )}

          {detailIds.length > 0 && (
            <Card data-testid="card-kpi-detail">
              <CardHeader className="pb-3 space-y-3">
                <div className="flex flex-wrap gap-1.5" role="tablist">
                  {detailIds.map(id => (
                    <Button key={id} size="sm" variant={activeId === id ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => select(id)} data-testid={`button-kpi-detail-${id}`}>
                      {nameOf(id)}
                    </Button>
                  ))}
                </div>
                {activeId && (
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <CardTitle>{active?.name ?? nameOf(activeId)}</CardTitle>
                      <CardDescription>{active?.summary ?? KPI_CATALOG.find(k => k.id === activeId)?.description}</CardDescription>
                    </div>
                    <p className="text-2xl font-bold" data-testid="text-kpi-detail-value">{active ? formatKpiValue(active) : 'Not enough data'}</p>
                  </div>
                )}
              </CardHeader>
              {active && (
                <CardContent className="space-y-3">
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-xs flex gap-2"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span><span className="font-medium">Formula:</span> {active.formula}</span></div>
                  {active.warning && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex gap-2" data-testid="text-kpi-warning">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{active.warning}</div>}
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">No supporting records in this date range.</p>
                  ) : (
                    <>
                      <div className="divide-y rounded-md border">
                        {rows.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE).map((r, i) => {
                          const inner = (<>
                            <div className="min-w-0"><p className="text-sm truncate">{r.label}</p>{r.note && <p className="text-xs text-muted-foreground truncate">{r.note}</p>}</div>
                            <span className="text-sm font-medium tabular-nums shrink-0">{r.value}</span>
                          </>);
                          const key = curPage * PAGE_SIZE + i;
                          return r.href
                            ? <Link key={key} href={r.href} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/40" data-testid={`link-kpi-row-${key}`}>{inner}</Link>
                            : <div key={key} className="flex items-center justify-between gap-3 px-3 py-2" data-testid={`row-kpi-${key}`}>{inner}</div>;
                        })}
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Showing {curPage * PAGE_SIZE + 1}–{Math.min(rows.length, (curPage + 1) * PAGE_SIZE)} of {rows.length}</span>
                        {pageCount > 1 && <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-7 w-7" disabled={curPage === 0} onClick={() => setPage(curPage - 1)} data-testid="button-kpi-prev"><ChevronLeft className="w-4 h-4" /></Button>
                          <span>Page {curPage + 1} / {pageCount}</span>
                          <Button size="icon" variant="outline" className="h-7 w-7" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)} data-testid="button-kpi-next"><ChevronRight className="w-4 h-4" /></Button>
                        </div>}
                      </div>
                    </>
                  )}
                  <p className="text-[11px] text-muted-foreground">Source: jobs, invoices, estimates, callbacks, time clock and receipts recorded {from} to {to}{reportQ.data ? ` (${reportQ.data.timezone})` : ''}.</p>
                </CardContent>
              )}
            </Card>
          )}
        </>
      )}
    </section>
  );
}

export default KpiDashboard;
