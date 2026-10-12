import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, ArrowUpRight, Clock, MapPin, User, Layers, Inbox, RotateCw } from 'lucide-react';

export interface DrillJob {
  id: number;
  title: string | null;
  customerName: string | null;
  propertyAddress: string | null;
  serviceName: string | null;
  crewName: string | null;
  completedAt: string | null;
  estimatedDuration: number | null; // minutes
  actualSeconds: number | null;
  status: string | null;
}

interface DrillResponse {
  jobs: DrillJob[];
  rangeStart: string;
  rangeEnd: string;
}

export type DrillTarget =
  | { kind: 'service'; serviceId: number | null; label: string }
  | { kind: 'crew'; crewId: number; label: string };

function fmtMin(m: number) {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

function effColor(rate: number | null) {
  if (rate == null) return '#6B7280';
  return rate >= 100 ? '#10B981' : rate >= 80 ? '#F59E0B' : '#EF4444';
}

export function JobDrilldown({
  target, periodQuery, enabled, onClose,
}: {
  target: DrillTarget | null;
  periodQuery: string;
  enabled: boolean;
  onClose: () => void;
}) {
  const scope = target
    ? target.kind === 'service'
      ? `serviceId=${target.serviceId == null ? 'null' : target.serviceId}`
      : `crewId=${target.crewId}`
    : '';

  const { data, isLoading, isError, refetch, isFetching } = useQuery<DrillResponse>({
    queryKey: ['efficiency-jobs', periodQuery, scope],
    queryFn: () => customFetch<DrillResponse>(`/api/efficiency/jobs?${periodQuery}&${scope}`),
    enabled: enabled && !!target,
  });

  const jobs = data?.jobs ?? [];
  const totalBudget = jobs.reduce((s, j) => s + (j.estimatedDuration ?? 0), 0);
  const totalActual = jobs.reduce((s, j) => s + (j.actualSeconds ?? 0), 0) / 60;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <Sheet open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col gap-0" data-testid="sheet-job-drilldown">
        <SheetHeader className="px-5 pt-5 pb-4 border-b space-y-1.5 text-left">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            {target?.kind === 'crew' ? 'Crew drilldown' : 'Service drilldown'}
          </p>
          <SheetTitle className="text-lg leading-tight">{target?.label}</SheetTitle>
          <SheetDescription className="text-xs">
            {data ? `${fmtDate(data.rangeStart)} – ${fmtDate(data.rangeEnd)}` : 'Same period as the report'}
          </SheetDescription>
          {jobs.length > 0 && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Stat label="Jobs" value={String(jobs.length)} />
              <Stat label="Budget" value={totalBudget > 0 ? fmtMin(totalBudget) : '—'} />
              <Stat
                label="Actual"
                value={totalActual > 0 ? fmtMin(totalActual) : '—'}
                tone={totalBudget > 0 && totalActual > totalBudget ? 'bad' : totalActual > 0 ? 'good' : undefined}
              />
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
          ) : isError ? (
            <div className="py-14 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 mx-auto text-destructive opacity-70" />
              <p className="text-sm text-muted-foreground">Could not load jobs for this scope.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-retry-drilldown">
                <RotateCw className="w-3.5 h-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-14 text-center text-muted-foreground">
              <Inbox className="w-9 h-9 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No completed jobs in this period.</p>
            </div>
          ) : (
            jobs.map(job => {
              const budget = job.estimatedDuration ?? 0;
              const actual = (job.actualSeconds ?? 0) / 60;
              const eff = budget > 0 && actual > 0 ? Math.round((budget / actual) * 100) : null;
              const max = Math.max(budget, actual, 1);
              return (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="group block rounded-lg border bg-card p-3.5 hover:border-primary/50 hover:shadow-sm transition-all"
                  data-testid={`link-drill-job-${job.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                        {job.title || `Job #${job.id}`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                        <User className="w-3 h-3 shrink-0" /> {job.customerName || 'No customer'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold tabular-nums" style={{ color: effColor(eff) }}>
                        {eff != null ? `${eff}%` : '—'}
                      </span>
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {job.propertyAddress && (
                      <span className="flex items-center gap-1 min-w-0"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[220px]">{job.propertyAddress}</span></span>
                    )}
                    {target?.kind === 'crew'
                      ? <span>{job.serviceName || 'Unspecified service'}</span>
                      : <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{job.crewName || 'No crew'}</span>}
                    {job.completedAt && (
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(job.completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    )}
                    {job.status && <span className="capitalize">{job.status.replace(/_/g, ' ')}</span>}
                  </div>

                  <div className="mt-2.5 space-y-1">
                    <MiniBar label="Budget" pct={(budget / max) * 100} value={budget > 0 ? fmtMin(budget) : 'not set'} className="bg-blue-400" />
                    <MiniBar
                      label="Actual"
                      pct={(actual / max) * 100}
                      value={actual > 0 ? fmtMin(actual) : 'no time'}
                      className={budget > 0 && actual > budget ? 'bg-destructive' : 'bg-emerald-500'}
                    />
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${tone === 'bad' ? 'text-destructive' : tone === 'good' ? 'text-emerald-600' : ''}`}>{value}</p>
    </div>
  );
}

function MiniBar({ label, pct, value, className }: { label: string; pct: number; value: string; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-10 shrink-0">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-[10px] font-mono w-14 text-right text-muted-foreground">{value}</span>
    </div>
  );
}
