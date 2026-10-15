import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGetJobEconomicsReport, getGetJobEconomicsReportQueryKey, useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import { AlertTriangle, CalendarRange, Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { loadKpiSettings } from '@/lib/kpiApi';
import { getKpiDefaultRange } from '@/lib/kpiDates';
import { filterJobs, validateEconomicsRange } from '@/lib/jobEconomics';
import { todayInZone } from './KpiDashboard';
import { SearchSelect } from './SearchSelect';
import { ServicePerformanceReport } from './ServicePerformanceReport';
import { JobProfitabilityReport } from './JobProfitabilityReport';

export interface EconomicsState { from: string; to: string; customer: string; service: string }

export function JobEconomicsReports({ view, state, setState }: { view: 'service' | 'jobs'; state: EconomicsState; setState: (s: EconomicsState) => void }) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const session = { tenantId, userId: user?.id, role: user?.role };
  const tenantQ = useGetTenantSettings({ query: { queryKey: [...getGetTenantSettingsQueryKey(), tenantId], enabled: tenantId != null } });
  const today = todayInZone(tenantQ.data?.timezone);
  const settingsQ = useQuery({ queryKey: ['kpi-settings', tenantId], queryFn: loadKpiSettings, enabled: tenantId != null, staleTime: 60_000 });
  const [draft, setDraft] = useState({ from: state.from, to: state.to });
  const stateRef = useRef(state); stateRef.current = state;
  useEffect(() => {
    if (state.from || !settingsQ.data || !today) return;
    const r = getKpiDefaultRange(settingsQ.data, today);
    setState({ ...stateRef.current, from: r.from, to: r.to }); setDraft(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.data, today, state.from]);
  useEffect(() => { setDraft({ from: state.from, to: state.to }); }, [state.from, state.to]);

  const valid = !!state.from && !validateEconomicsRange(state.from, state.to);
  const params = { from: state.from, to: state.to };
  const reportQ = useGetJobEconomicsReport(params, { query: { queryKey: [...getGetJobEconomicsReportQueryKey(params), session], enabled: valid && tenantId != null, staleTime: 5 * 60_000, refetchOnWindowFocus: false } });
  const draftErr = validateEconomicsRange(draft.from, draft.to);
  const data = reportQ.data;

  const customerOpts = useMemo(() => [{ value: 'all', label: 'All customers' }, ...(data?.customers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ value: String(c.id), label: c.name }))], [data]);
  const serviceOpts = useMemo(() => [{ value: 'all', label: 'All services' }, { value: '0', label: 'Unspecified service' }, ...(data?.services ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => ({ value: String(s.id), label: s.name }))], [data]);
  const filtered = useMemo(() => filterJobs(data?.jobs ?? [], { customerId: state.customer === 'all' ? null : Number(state.customer), serviceId: state.service === 'all' ? null : Number(state.service) }), [data, state.customer, state.service]);
  const custLabel = customerOpts.find(o => o.value === state.customer)?.label ?? 'All customers';
  const svcLabel = serviceOpts.find(o => o.value === state.service)?.label ?? 'All services';
  const header = [['Report', view === 'service' ? 'Service performance' : 'Job profitability'], ['Completed dates', `${state.from} to ${state.to}`, data?.timezone ?? ''], ['Customer', custLabel], ['Service', svcLabel], ['Generated', data?.generatedAt ?? ''], ['Note', 'Contribution = job-price revenue minus recorded cost, before overhead/payroll burden/P4P top-ups/unallocated fleet. Incomplete = cost not fully recorded, not $0.']];
  const fileStem = `job-economics-${state.from}-${state.to}`;
  const status = (reportQ.error as { status?: number } | null)?.status;
  const err = timezoneOrSettingsError(tenantQ.isError, settingsQ.isError) ?? (reportQ.isError ? (status === 422 ? 'Too many jobs in this range (over 10,000). Narrow the date range.' : `Could not load the report. ${(reportQ.error as Error)?.message ?? ''}`) : null);
  const coverage = useMemo(() => ({ cc: filtered.filter(j => j.totalCost != null).length, open: filtered.filter(j => j.hasOpenTimers).length, cur: filtered.filter(j => j.measurementSource === 'current_property').length, multi: filtered.filter(j => j.multiService).length }), [filtered]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <div><label className="text-[11px] text-muted-foreground block" htmlFor="econ-from">Completed from</label>
          <Input id="econ-from" type="date" className="h-8 w-[140px]" value={draft.from} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} data-testid="input-econ-from" /></div>
        <div><label className="text-[11px] text-muted-foreground block" htmlFor="econ-to">To</label>
          <Input id="econ-to" type="date" className="h-8 w-[140px]" value={draft.to} max={today || undefined} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} data-testid="input-econ-to" /></div>
        <Button size="sm" variant="secondary" disabled={!!draftErr || (draft.from === state.from && draft.to === state.to)} onClick={() => setState({ ...state, ...draft })} data-testid="button-econ-apply"><CalendarRange className="w-4 h-4 mr-1" />Apply</Button>
        <SearchSelect label="Customer" value={state.customer} options={customerOpts} onChange={v => setState({ ...state, customer: v })} testId="select-econ-customer" />
        <SearchSelect label="Service" value={state.service} options={serviceOpts} onChange={v => setState({ ...state, service: v })} testId="select-econ-service" />
        <Button size="sm" variant="ghost" className="ml-auto" title="Refresh report" aria-label="Refresh report" disabled={!valid || reportQ.isFetching} onClick={() => void reportQ.refetch()} data-testid="button-econ-refresh"><RefreshCw className={`w-4 h-4 ${reportQ.isFetching ? 'animate-spin' : ''}`} /></Button>
      </div>
      {draft.from && draftErr && <p className="text-xs text-red-600" data-testid="text-econ-range-error">{draftErr}</p>}

      {err ? (
        <Card className="border-red-200"><CardContent className="p-6 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{err}</p>
          <Button size="sm" variant="outline" onClick={() => { if (tenantQ.isError) void tenantQ.refetch(); if (settingsQ.isError) void settingsQ.refetch(); if (reportQ.isError) void reportQ.refetch(); }} data-testid="button-econ-retry">Retry</Button>
        </CardContent></Card>
      ) : !data ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground" data-testid="text-econ-coverage">
            <span>{filtered.length} of {data.jobs.length} jobs · {custLabel} · {svcLabel}</span>
            <span className={coverage.cc < filtered.length ? 'text-amber-700' : ''}>Cost complete {coverage.cc}/{filtered.length}</span>
            {coverage.open > 0 && <span className="text-amber-700">{coverage.open} with open timers (excluded from time)</span>}
            {coverage.multi > 0 && <span>{coverage.multi} multi-service</span>}
            {coverage.cur > 0 && <span className="text-amber-700">{coverage.cur} sized from current property (historical size not saved)</span>}
            <span>{data.timezone} · generated {new Date(data.generatedAt).toLocaleString()}</span>
          </div>
          {view === 'service' ? <ServicePerformanceReport jobs={filtered} header={header} fileStem={fileStem} /> : <JobProfitabilityReport jobs={filtered} header={header} fileStem={fileStem} />}
          {data.notes.length > 0 && <div className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground flex gap-2"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /><ul className="space-y-0.5">{data.notes.map(n => <li key={n}>{n}</li>)}</ul></div>}
        </>
      )}
    </section>
  );
}

function timezoneOrSettingsError(tz: boolean, settings: boolean): string | null {
  return tz ? 'Could not load the company timezone for report dates.' : settings ? 'Could not load KPI settings for default dates.' : null;
}
