import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { KPI_CATALOG, DEFAULT_KPIS, loadKpiSettings, saveKpiSettings, type KpiId, type KpiSettings as KpiSettingsT } from '@/lib/kpiApi';

const order = (ids: KpiId[]) => KPI_CATALOG.map(k => k.id).filter(id => ids.includes(id));
const same = (a: KpiId[], b: KpiId[]) => order(a).join() === order(b).join();

export function KpiSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['kpi-settings', user?.tenantId];
  const q = useQuery({ queryKey: key, queryFn: loadKpiSettings, enabled: user?.tenantId != null, staleTime: 60_000, refetchOnMount: true, refetchOnWindowFocus: true });
  const [main, setMain] = useState<KpiId[]>([]);
  const [detail, setDetail] = useState<KpiId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (q.data && !initRef.current) { initRef.current = true; setMain(q.data.mainKpis); setDetail(q.data.detailKpis); }
  }, [q.data]);

  const save = useMutation({
    mutationFn: (s: KpiSettingsT) => saveKpiSettings(s),
    onSuccess: saved => { qc.setQueryData(key, saved); setMain(saved.mainKpis); setDetail(saved.detailKpis); setError(null); toast.success('KPI settings saved'); },
    onError: (e: Error) => { setError(e?.message || 'Could not save KPI settings'); toast.error('Could not save KPI settings'); },
  });

  const dirty = !!q.data && (!same(main, q.data.mainKpis) || !same(detail, q.data.detailKpis));
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
            <CardTitle className="flex items-center gap-2">Dashboard KPIs {dirty && <Badge variant="outline" className="border-amber-300 text-amber-700" data-testid="status-kpi-unsaved">Unsaved changes</Badge>}</CardTitle>
            <CardDescription>Main metrics appear as cards on the Dashboard. Detail metrics can be opened for formula, warnings and supporting records. A main metric is always included in details.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setMain([...DEFAULT_KPIS]); setDetail([...DEFAULT_KPIS]); }} data-testid="button-kpi-defaults"><RotateCcw className="w-4 h-4 mr-1" />Defaults</Button>
            <Button size="sm" variant="outline" disabled={!dirty || save.isPending} onClick={() => { setMain(q.data!.mainKpis); setDetail(q.data!.detailKpis); setError(null); }} data-testid="button-kpi-discard">Discard</Button>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate({ mainKpis: order(main), detailKpis: order(Array.from(new Set([...detail, ...main]))) })} data-testid="button-kpi-save">
              {save.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600 flex items-center gap-1" data-testid="text-kpi-save-error"><AlertTriangle className="w-4 h-4" />{error}</p>}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 text-xs font-medium text-muted-foreground border-b pb-2">
          <span>Metric</span><span className="w-14 text-center">Main</span><span className="w-14 text-center">Detail</span>
        </div>
        <div className="divide-y">
          {KPI_CATALOG.map(k => (
            <div key={k.id} className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{k.name}{DEFAULT_KPIS.includes(k.id) && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">Recommended</span>}</p>
                <p className="text-xs text-muted-foreground">{k.description}</p>
              </div>
              <div className="w-14 flex justify-center"><Checkbox checked={main.includes(k.id)} onCheckedChange={() => toggleMain(k.id)} aria-label={`Show ${k.name} on dashboard`} data-testid={`checkbox-kpi-main-${k.id}`} /></div>
              <div className="w-14 flex justify-center"><Checkbox checked={detail.includes(k.id)} onCheckedChange={() => toggleDetail(k.id)} aria-label={`Enable ${k.name} details`} data-testid={`checkbox-kpi-detail-${k.id}`} /></div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">{main.length} main · {detail.length} detail. Leaving both empty hides the KPI section.</p>
      </CardContent>
    </Card>
  );
}

export default KpiSettings;
