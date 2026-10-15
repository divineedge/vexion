import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { KPI_DATE_PRESETS, validateKpiRange } from '@/lib/kpiDates';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KPI_CATALOG, DEFAULT_KPIS, loadKpiSettings, saveKpiSettings, type KpiId, type KpiSettings as KpiSettingsT } from '@/lib/kpiApi';
import { useAutosaveFields, useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';

const order = (ids: KpiId[]) => KPI_CATALOG.map(k => k.id).filter(id => ids.includes(id));
type Ext = KpiSettingsT & { defaultDateRange?: string | null; customFrom?: string | null; customTo?: string | null };

export function KpiSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['kpi-settings', user?.tenantId];
  const q = useQuery({ queryKey: key, queryFn: loadKpiSettings, enabled: user?.tenantId != null, staleTime: 60_000, refetchOnMount: true, refetchOnWindowFocus: true });
  const [main, setMain] = useState<KpiId[]>([]);
  const [detail, setDetail] = useState<KpiId[]>([]);
  const [range, setRange] = useState<NonNullable<KpiSettingsT['defaultDateRange']>>('year_to_date');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);
  const [ready, setReady] = useState(false);

  const hydrateRange = (d: Ext) => { setRange((d.defaultDateRange ?? 'year_to_date') as typeof range); setCFrom(d.customFrom ?? ''); setCTo(d.customTo ?? ''); };
  useEffect(() => {
    if (q.data && !initRef.current) { initRef.current = true; setMain(q.data.mainKpis); setDetail(q.data.detailKpis); hydrateRange(q.data as Ext); setReady(true); }
  }, [q.data]);

  const save = useMutation({
    mutationFn: (s: Ext) => saveKpiSettings(s as KpiSettingsT),
    onSuccess: saved => { qc.setQueryData(key, saved); setError(null); qc.invalidateQueries({ queryKey: ['kpi-report', user?.tenantId] }); },
    onError: (e: Error) => { setError(e?.message || 'Could not save KPI settings'); toast.error('Could not save KPI settings'); },
  });

  const customError = range === 'custom' ? (!cFrom || !cTo ? 'Enter both custom start and end dates.' : validateKpiRange(cFrom, cTo)) : null;
  const saveRef = useRef(save.mutateAsync); saveRef.current = save.mutateAsync;
  const autosave = useSettingsAutosave(patch => saveRef.current(patch.settings as Ext));
  useAutosaveFields({ settings: {
    mainKpis: order(main), detailKpis: order(Array.from(new Set([...detail, ...main]))),
    defaultDateRange: range, customFrom: range === 'custom' ? cFrom : null, customTo: range === 'custom' ? cTo : null,
  } }, ready, autosave.queue, !customError);
  const toggleMain = (id: KpiId) => {
    if (main.includes(id)) setMain(main.filter(x => x !== id));
    else { setMain([...main, id]); if (!detail.includes(id)) setDetail([...detail, id]); }
  };
  const toggleDetail = (id: KpiId) => {
    if (detail.includes(id)) { setDetail(detail.filter(x => x !== id)); setMain(main.filter(x => x !== id)); }
    else setDetail([...detail, id]);
  };

  if (q.isLoading || (!q.data && !q.isError)) return <Card><CardContent className="p-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>;
  if (q.isError) return (
    <Card className="border-red-200"><CardContent className="p-6 flex items-center justify-between gap-3">
      <span className="text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Could not load saved KPI settings.</span>
      <Button size="sm" variant="outline" onClick={() => void q.refetch()} data-testid="button-kpi-settings-retry">Retry</Button>
    </CardContent></Card>
  );

  return (
    <Card data-testid="card-kpi-settings">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">KPI Dashboard</CardTitle>
            <CardDescription>These settings control the dedicated KPI Dashboard page; no KPIs appear on the main Dashboard. KPI dashboard metrics show as cards. Detailed view metrics can be opened for formula, warnings and supporting records; every KPI dashboard metric is included in the detailed view.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setMain([...DEFAULT_KPIS]); setDetail([...DEFAULT_KPIS]); setRange('year_to_date'); }} data-testid="button-kpi-defaults"><RotateCcw className="w-4 h-4 mr-1" />Defaults</Button>
            {!customError && <AutosaveIndicator status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={() => { void autosave.retry(); }} />}
          </div>
        </div>
        {error && <p className="text-sm text-red-600 flex items-center gap-1" data-testid="text-kpi-save-error"><AlertTriangle className="w-4 h-4" />{error}</p>}
      </CardHeader>
      <CardContent>
        <div className="rounded-md border p-3 mb-5 space-y-2" data-testid="section-kpi-default-range">
          <p className="text-sm font-medium">Default date range</p>
          <p className="text-xs text-muted-foreground">Used when the KPI Dashboard opens, based on the company timezone. People can still change the range while viewing.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={range} onValueChange={v => setRange(v as typeof range)}>
              <SelectTrigger className="w-[200px] h-9" data-testid="select-kpi-default-range"><SelectValue /></SelectTrigger>
              <SelectContent>{KPI_DATE_PRESETS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
            {range === 'custom' && <>
              <div><label className="text-[11px] text-muted-foreground block">Start</label><Input type="date" className="h-9 w-[150px]" value={cFrom} onChange={e => setCFrom(e.target.value)} data-testid="input-kpi-custom-from" /></div>
              <div><label className="text-[11px] text-muted-foreground block">End</label><Input type="date" className="h-9 w-[150px]" value={cTo} onChange={e => setCTo(e.target.value)} data-testid="input-kpi-custom-to" /></div>
            </>}
          </div>
          {customError && <p className="text-xs text-red-600" data-testid="text-kpi-custom-error">{customError}</p>}
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 text-xs font-medium text-muted-foreground border-b pb-2">
          <span>Metric</span><span className="w-20 text-center">KPI dashboard</span><span className="w-20 text-center">Detailed view</span>
        </div>
        <div className="divide-y">
          {KPI_CATALOG.map(k => (
            <div key={k.id} className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{k.name}{DEFAULT_KPIS.includes(k.id) && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">Recommended</span>}</p>
                <p className="text-xs text-muted-foreground">{k.description}</p>
              </div>
              <div className="w-20 flex justify-center"><Checkbox checked={main.includes(k.id)} onCheckedChange={() => toggleMain(k.id)} aria-label={`Show ${k.name} on KPI dashboard`} data-testid={`checkbox-kpi-main-${k.id}`} /></div>
              <div className="w-20 flex justify-center"><Checkbox checked={detail.includes(k.id)} onCheckedChange={() => toggleDetail(k.id)} aria-label={`Enable ${k.name} detailed view`} data-testid={`checkbox-kpi-detail-${k.id}`} /></div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">{main.length} on KPI dashboard · {detail.length} in detailed view. Both may be left empty.</p>
      </CardContent>
    </Card>
  );
}

export default KpiSettings;
