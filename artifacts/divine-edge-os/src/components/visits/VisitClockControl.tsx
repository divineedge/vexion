import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { toast } from 'sonner';
import { Timer, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Contract (main/backend): GET /api/visits/clock-active (shared list), GET /api/visits/:id/clock, POST /api/visits/:id/clock-in, POST /api/visits/:id/clock-out. */
export interface VisitClockState { active: boolean; entryId: number | null; clockedInAt: string | null }
export const visitClockKey = (id: number) => ['visit-clock', id] as const;
export interface ActiveVisitClocks { entries: Array<{ visitId: number; entryId: number; clockedInAt: string }> }
export const visitClockActiveKey = (userId?: number | string | null, tenantId?: number | string | null) => ['/api/visits/clock-active', tenantId ?? null, userId ?? null] as const;

/** One shared request for every visit row; refetched every 30s and after start/stop. */
export function useActiveVisitClocks() {
  const { user } = useAuth();
  const u = user as { id?: number; tenantId?: number } | null;
  return useQuery({
    queryKey: visitClockActiveKey(u?.id, u?.tenantId),
    queryFn: () => customFetch<ActiveVisitClocks>('/api/visits/clock-active'),
    enabled: !!u?.id,
    refetchInterval: 30_000,
    retry: false,
  });
}

const errStatus = (e: unknown) => (e as { status?: number })?.status;
const errMsg = (e: unknown, fallback: string) => {
  const d = (e as { data?: { error?: string; message?: string } })?.data;
  return d?.error || d?.message || fallback;
};

function elapsed(from: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
}

export function VisitClockControl({ visitId, completed, compact = false }: { visitId: number; completed?: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<'in' | 'out' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const all = useActiveVisitClocks();
  const entry = all.data?.entries.find(e => e.visitId === visitId);
  const q = {
    isLoading: all.isLoading, isError: all.isError, error: all.error, refetch: all.refetch,
    data: all.data ? { active: !!entry, entryId: entry?.entryId ?? null, clockedInAt: entry?.clockedInAt ?? null } as VisitClockState : undefined,
  };
  const active = !!q.data?.active;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const m = useMutation({
    mutationFn: (dir: 'in' | 'out') => customFetch<VisitClockState>(`/api/visits/${visitId}/clock-${dir}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    onSuccess: (data, dir) => {
      void data;
      qc.invalidateQueries({ queryKey: ['/api/visits/clock-active'] });
      qc.invalidateQueries({ queryKey: visitClockKey(visitId) });
      qc.invalidateQueries({ queryKey: ['/api/time-tracking/entries'] });
      toast.success(dir === 'in' ? 'Clocked in to visit' : 'Clocked out of visit');
    },
    onError: (e, dir) => {
      const st = errStatus(e);
      toast.error(st === 403 ? 'You are not assigned to this visit.'
        : st === 409 ? errMsg(e, dir === 'in' ? 'You are already clocked in somewhere else.' : 'You are not clocked in to this visit.')
        : errMsg(e, `Could not clock ${dir}.`));
    },
  });

  if (q.isLoading) return <Skeleton className={compact ? 'h-7 w-24' : 'h-14'} />;
  const unsupported = q.isError && (errStatus(q.error) === 404 || errStatus(q.error) === 501);
  if (q.isError) {
    if (compact) return null;
    return (
      <div className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground flex items-center justify-between gap-2" data-testid="visit-clock-unavailable">
        <span className="flex items-center gap-1.5"><Timer className="w-4 h-4" />{unsupported ? 'Visit time clock is not available yet.' : errMsg(q.error, 'Could not load clock status.')}</span>
        {!unsupported && <Button size="sm" variant="outline" className="h-7" onClick={() => q.refetch()}>Retry</Button>}
      </div>
    );
  }

  const dialog = (
    <AlertDialog open={confirm != null} onOpenChange={o => { if (!o) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm === 'in' ? 'Start visit?' : 'Stop visit?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirm === 'in'
              ? 'Clocks you in to this visit and starts its timer. Your day clock is started automatically if it is not running.'
              : `Clocks you out of this visit${q.data?.clockedInAt ? ` after ${elapsed(q.data.clockedInAt, now)}` : ''}. This does not mark the visit complete.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction data-testid={`button-confirm-visit-clock-${confirm}`} onClick={() => { if (confirm) m.mutate(confirm); setConfirm(null); }}>
            {confirm === 'in' ? 'Start visit' : 'Stop visit'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const button = active ? (
    <Button size="sm" variant="outline" className="gap-1.5 h-8 border-amber-300 text-amber-700 hover:bg-amber-100" disabled={m.isPending} onClick={e => { e.stopPropagation(); setConfirm('out'); }} data-testid={`button-stop-visit-${visitId}`}>
      <Square className="w-3.5 h-3.5" /> Stop Visit
    </Button>
  ) : (
    <Button size="sm" variant={compact ? 'outline' : 'default'} className="gap-1.5 h-8" disabled={m.isPending || completed} title={completed ? 'Visit is completed' : 'Clock in to this visit'} onClick={e => { e.stopPropagation(); setConfirm('in'); }} data-testid={`button-start-visit-${visitId}`}>
      <Play className="w-3.5 h-3.5" /> Start Visit
    </Button>
  );

  if (compact) return <span onClick={e => e.stopPropagation()}>{button}{dialog}</span>;
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${active ? 'border-amber-200 bg-amber-50' : ''}`} data-testid="visit-clock">
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5"><Timer className="w-3.5 h-3.5" /> Time on visit</p>
        {active && q.data?.clockedInAt
          ? <p className="text-sm font-semibold text-amber-800 tabular-nums">{elapsed(q.data.clockedInAt, now)} <span className="font-normal text-amber-600">· clocked in</span></p>
          : <p className="text-sm text-muted-foreground">{completed ? 'Visit completed' : 'Not clocked in'}</p>}
      </div>
      {button}
      {dialog}
    </div>
  );
}

export default VisitClockControl;
