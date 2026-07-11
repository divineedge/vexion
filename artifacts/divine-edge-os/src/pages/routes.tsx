import React, { useState, useMemo } from 'react';
import {
  useListDivisions, getListDivisionsQueryKey,
  useGetRoutesDashboard, getGetRoutesDashboardQueryKey,
  useGetRouteDayDetail, getGetRouteDayDetailQueryKey,
  useResequenceRoute,
  useUpdateJobRoute,
  useRescheduleJobOnce,
  useListJobs, getListJobsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, MapPinned, Route as RouteIcon, ArrowUp, ArrowDown,
  Wand2, Clock, User, Building, CalendarClock, Plus,
} from 'lucide-react';
import { startOfWeek, addWeeks, subWeeks, format, addDays } from 'date-fns';

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  biweekly_a: 'Biweekly (A)',
  biweekly_b: 'Biweekly (B)',
  monthly: 'Monthly',
};

function CapacityBadge({ openSpaceHours }: { openSpaceHours: number }) {
  if (openSpaceHours < 0) {
    return <Badge className="bg-red-100 text-red-700 border-red-200">Over by {Math.abs(openSpaceHours).toFixed(1)}h</Badge>;
  }
  if (openSpaceHours < 0.5) {
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200">{openSpaceHours.toFixed(1)}h open</Badge>;
  }
  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">{openSpaceHours.toFixed(1)}h open</Badge>;
}

export default function RoutesDashboardPage() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [divisionFilter, setDivisionFilter] = useState<string>('all');
  const [dayDetail, setDayDetail] = useState<{ routeTemplateId: number; date: string } | null>(null);
  const [rescheduleJobId, setRescheduleJobId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [addStopOpen, setAddStopOpen] = useState(false);
  const [addStopJobId, setAddStopJobId] = useState<string>('');

  const weekStartStr = format(weekStart, 'yyyy-MM-dd');

  const { data: divisions } = useListDivisions({ query: { queryKey: getListDivisionsQueryKey() } });
  const { data: dashboard, isLoading } = useGetRoutesDashboard(
    { weekStart: weekStartStr, divisionId: divisionFilter !== 'all' ? Number(divisionFilter) : undefined },
    { query: { queryKey: getGetRoutesDashboardQueryKey({ weekStart: weekStartStr, divisionId: divisionFilter !== 'all' ? Number(divisionFilter) : undefined }) } },
  );

  const { data: detail, isLoading: detailLoading } = useGetRouteDayDetail(
    dayDetail?.routeTemplateId ?? 0,
    { date: dayDetail?.date ?? '' },
    { query: { enabled: !!dayDetail, queryKey: getGetRouteDayDetailQueryKey(dayDetail?.routeTemplateId ?? 0, { date: dayDetail?.date ?? '' }) } },
  );

  // The jobs API's `endDate` filter is `scheduledAt <= endDate` (midnight), so passing the
  // same day as both start and end would exclude every job scheduled later that day. Use the
  // next calendar day as the (inclusive) end bound to capture the whole day.
  const dayDetailEndDate = dayDetail ? format(addDays(new Date(`${dayDetail.date}T00:00:00Z`), 1), 'yyyy-MM-dd') : undefined;
  const { data: dayJobs } = useListJobs(
    { startDate: dayDetail?.date, endDate: dayDetailEndDate },
    { query: { enabled: !!dayDetail, queryKey: getListJobsQueryKey({ startDate: dayDetail?.date, endDate: dayDetailEndDate }) } },
  );
  const unassignedJobsForDay = (dayJobs ?? []).filter(j => j.routeTemplateId !== dayDetail?.routeTemplateId);

  const resequence = useResequenceRoute();
  const updateJobRoute = useUpdateJobRoute();
  const rescheduleOnce = useRescheduleJobOnce();

  const invalidateDetail = () => {
    if (!dayDetail) return;
    qc.invalidateQueries({ queryKey: getGetRouteDayDetailQueryKey(dayDetail.routeTemplateId, { date: dayDetail.date }) });
    qc.invalidateQueries({ queryKey: getGetRoutesDashboardQueryKey({ weekStart: weekStartStr }) });
  };

  const grouped = useMemo(() => {
    const map = new Map<number, { divisionName: string; entries: NonNullable<typeof dashboard> }>();
    for (const entry of dashboard ?? []) {
      if (!map.has(entry.divisionId)) map.set(entry.divisionId, { divisionName: entry.divisionName, entries: [] });
      map.get(entry.divisionId)!.entries.push(entry);
    }
    return [...map.values()];
  }, [dashboard]);

  const moveStop = (fromIdx: number, toIdx: number) => {
    if (!detail || toIdx < 0 || toIdx >= detail.stops.length) return;
    const order = detail.stops.map(s => s.jobId);
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    resequence.mutate({ id: detail.routeTemplateId, data: { date: detail.date, jobOrder: order } }, {
      onSuccess: () => { invalidateDetail(); },
      onError: () => toast.error('Failed to reorder stops'),
    });
  };

  const handleAutoOptimize = () => {
    if (!detail) return;
    resequence.mutate({ id: detail.routeTemplateId, data: { date: detail.date } }, {
      onSuccess: () => { toast.success('Route re-optimized'); invalidateDetail(); },
      onError: () => toast.error('Failed to optimize route'),
    });
  };

  const handleReschedule = () => {
    if (!rescheduleJobId || !rescheduleDate) return;
    rescheduleOnce.mutate({ id: rescheduleJobId, data: { newScheduledAt: new Date(rescheduleDate).toISOString() } }, {
      onSuccess: (result) => {
        toast.success(result.exceptionFeeCharged > 0
          ? `Job rescheduled — $${result.exceptionFeeCharged.toFixed(2)} trip fee added`
          : 'Job rescheduled');
        setRescheduleJobId(null);
        setRescheduleDate('');
        invalidateDetail();
      },
      onError: (err: any) => toast.error(err?.data?.error ?? 'Failed to reschedule job'),
    });
  };

  const handleAddStop = () => {
    if (!addStopJobId || !dayDetail) return;
    updateJobRoute.mutate({ id: Number(addStopJobId), data: { routeTemplateId: dayDetail.routeTemplateId, scheduledAt: new Date(`${dayDetail.date}T09:00:00`).toISOString() } }, {
      onSuccess: () => {
        toast.success('Job added to route');
        setAddStopOpen(false);
        setAddStopJobId('');
        invalidateDetail();
        qc.invalidateQueries({ queryKey: getListJobsQueryKey({ startDate: dayDetail.date, endDate: dayDetailEndDate }) });
      },
      onError: () => toast.error('Failed to assign job to route'),
    });
  };

  const handleRemoveStop = (jobId: number) => {
    if (!window.confirm('Remove this job from the route?')) return;
    updateJobRoute.mutate({ id: jobId, data: { routeTemplateId: null } }, {
      onSuccess: () => { toast.success('Removed from route'); invalidateDetail(); },
      onError: () => toast.error('Failed to remove job from route'),
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Routes</h1>
          <p className="text-muted-foreground mt-1">Weekly route capacity by division — click a route to see and sequence its stops.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={divisionFilter} onValueChange={setDivisionFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All Divisions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Divisions</SelectItem>
              {(divisions ?? []).map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 border rounded-lg px-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekStart(w => subWeeks(w, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium px-2 whitespace-nowrap">
              {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekStart(w => addWeeks(w, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }))}>This Week</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading routes...</div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MapPinned className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="font-semibold text-lg mb-2">No routes this week</p>
            <p className="text-muted-foreground text-sm">Set up divisions and route templates in Settings → Routing.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(g => (
            <div key={g.divisionName} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{g.divisionName}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {g.entries.map(entry => {
                  const pctUsed = entry.capacity.shiftHours > 0 ? Math.min(100, (entry.capacity.usedHours / entry.capacity.shiftHours) * 100) : 0;
                  return (
                    <Card
                      key={entry.routeTemplateId}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => setDayDetail({ routeTemplateId: entry.routeTemplateId, date: entry.runDate })}
                    >
                      <CardContent className="pt-5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">{entry.routeTemplateName}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(`${entry.runDate}T00:00:00`), 'EEE, MMM d')} · {FREQUENCY_LABEL[entry.frequency] ?? entry.frequency}</p>
                          </div>
                          <Badge variant="secondary">{entry.stopCount} stop{entry.stopCount !== 1 ? 's' : ''}</Badge>
                        </div>
                        <Progress value={pctUsed} className={entry.capacity.openSpaceHours < 0 ? '[&>div]:bg-red-500' : undefined} />
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{entry.capacity.usedHours.toFixed(1)}h / {entry.capacity.shiftHours.toFixed(1)}h shift</span>
                          <CapacityBadge openSpaceHours={entry.capacity.openSpaceHours} />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Day Detail Sheet */}
      <Sheet open={!!dayDetail} onOpenChange={open => { if (!open) setDayDetail(null); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {detailLoading || !detail ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading...</div>
          ) : (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <RouteIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <SheetTitle className="text-xl">{detail.routeTemplateName}</SheetTitle>
                    <SheetDescription className="mt-0.5">
                      {format(new Date(`${detail.date}T00:00:00`), 'EEEE, MMM d, yyyy')} · {detail.divisionName}
                      {detail.depotLabel && ` · Depot: ${detail.depotLabel}`}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-5">
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Capacity</span>
                    <CapacityBadge openSpaceHours={detail.capacity.openSpaceHours} />
                  </div>
                  <Progress value={detail.capacity.shiftHours > 0 ? Math.min(100, (detail.capacity.usedHours / detail.capacity.shiftHours) * 100) : 0} />
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground pt-1">
                    <span>Jobs: {detail.capacity.budgetedJobHours.toFixed(1)}h</span>
                    <span>Drive: {detail.capacity.driveHours.toFixed(1)}h</span>
                    <span>Shift: {detail.capacity.shiftHours.toFixed(1)}h</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Stops ({detail.stops.length})</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setAddStopOpen(true)}>
                      <Plus className="w-3.5 h-3.5" /> Add Stop
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleAutoOptimize} disabled={resequence.isPending}>
                      <Wand2 className="w-3.5 h-3.5" /> Auto-Optimize
                    </Button>
                  </div>
                </div>

                {detail.stops.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center border rounded-lg border-dashed">No stops scheduled for this day.</p>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {detail.stops.map((stop, idx) => (
                      <div key={stop.jobId} className="p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="shrink-0 h-6 w-6 flex items-center justify-center p-0 rounded-full">{idx + 1}</Badge>
                            <div>
                              <p className="text-sm font-medium">{stop.title}</p>
                              {stop.customerName && <p className="text-xs text-muted-foreground">{stop.customerName}</p>}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant="secondary" className="text-xs">{stop.status.replace(/_/g, ' ')}</Badge>
                            {idx > 0 && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />+{stop.driveMinutesFromPrev}m drive</span>}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground pl-8">
                          {stop.propertyAddress && <span className="flex items-center gap-1"><Building className="w-3 h-3" />{stop.propertyAddress}</span>}
                          {(stop.assigneeName || stop.crewName) && <span className="flex items-center gap-1"><User className="w-3 h-3" />{stop.assigneeName ?? stop.crewName}</span>}
                          {stop.estimatedDuration != null && <span>{stop.estimatedDuration}min job</span>}
                        </div>
                        <div className="flex items-center gap-1 pl-8 pt-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveStop(idx, idx - 1)} disabled={idx === 0 || resequence.isPending}>
                            <ArrowUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveStop(idx, idx + 1)} disabled={idx === detail.stops.length - 1 || resequence.isPending}>
                            <ArrowDown className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => { setRescheduleJobId(stop.jobId); setRescheduleDate(detail.date); }}>
                            <CalendarClock className="w-3.5 h-3.5" /> Reschedule
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-xs ml-auto text-destructive hover:text-destructive" onClick={() => handleRemoveStop(stop.jobId)}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Reschedule Once Dialog */}
      <Dialog open={!!rescheduleJobId} onOpenChange={open => { if (!open) { setRescheduleJobId(null); setRescheduleDate(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule This Visit Only</DialogTitle>
            <DialogDescription>
              This moves just this one occurrence off its regular route to a new date. The tenant's route exception trip fee (or the route's override) will be added to this job's invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">New Date</label>
            <Input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setRescheduleJobId(null)}>Cancel</Button>
            <Button onClick={handleReschedule} disabled={!rescheduleDate || rescheduleOnce.isPending}>
              {rescheduleOnce.isPending ? 'Rescheduling...' : 'Reschedule & Apply Fee'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Stop Dialog */}
      <Dialog open={addStopOpen} onOpenChange={setAddStopOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Job to Route</DialogTitle>
            <DialogDescription>Assign an existing job scheduled on this date to this route.</DialogDescription>
          </DialogHeader>
          <Select value={addStopJobId} onValueChange={setAddStopJobId}>
            <SelectTrigger><SelectValue placeholder="Select a job..." /></SelectTrigger>
            <SelectContent>
              {unassignedJobsForDay.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground text-center">No other jobs scheduled this day</div>
              ) : unassignedJobsForDay.map(j => (
                <SelectItem key={j.id} value={String(j.id)}>{j.title}{j.customerName ? ` — ${j.customerName}` : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setAddStopOpen(false)}>Cancel</Button>
            <Button onClick={handleAddStop} disabled={!addStopJobId || updateJobRoute.isPending}>
              {updateJobRoute.isPending ? 'Adding...' : 'Add to Route'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
