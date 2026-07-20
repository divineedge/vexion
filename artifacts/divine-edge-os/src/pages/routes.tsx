import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  useListDivisions, getListDivisionsQueryKey,
  useGetRoutesDashboard, getGetRoutesDashboardQueryKey,
  useGetRouteDayDetail, getGetRouteDayDetailQueryKey,
  useResequenceRoute,
  useUpdateJobRoute,
  useRescheduleJobOnce,
  useListJobs, getListJobsQueryKey,
  useCreateJob,
  useListCustomers, getListCustomersQueryKey,
  useListUsers, getListUsersQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useListSubTimers, getListSubTimersQueryKey,
  useStartSubTimer, useStopSubTimer,
  useUpdateJob, getListJobsQueryKey as getJobsQueryKey,
  useListProperties, getListPropertiesQueryKey,
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
  Wand2, Clock, User, Building, CalendarClock, Plus, Play, Square, Timer,
} from 'lucide-react';
import { startOfWeek, addWeeks, subWeeks, format, addDays } from 'date-fns';
import { JobFormFields, EMPTY_JOB, buildRecurrenceRule, type NewJobForm } from '@/components/jobs/JobFormFields';

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
  const [location] = useLocation();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [divisionFilter, setDivisionFilter] = useState<string>('all');
  const [dayDetail, setDayDetail] = useState<{ routeTemplateId: number; date: string } | null>(() => {
    // Support deep-link from Schedule page: /routes?routeTemplateId=N&date=YYYY-MM-DD
    const params = new URLSearchParams(window.location.search);
    const rtId = params.get('routeTemplateId');
    const date = params.get('date');
    if (rtId && date) return { routeTemplateId: Number(rtId), date };
    return null;
  });

  // Sync weekStart to the deep-linked date so the dashboard shows the right week
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get('date');
    if (date) {
      setWeekStart(startOfWeek(new Date(`${date}T00:00:00`), { weekStartsOn: 0 }));
    }
  }, [location]);
  const [rescheduleJobId, setRescheduleJobId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [addStopOpen, setAddStopOpen] = useState(false);
  const [addStopJobId, setAddStopJobId] = useState<string>('');
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [newJob, setNewJob] = useState<NewJobForm>(EMPTY_JOB);
  const [capacityWarning, setCapacityWarning] = useState<{ message: string; onConfirm: () => void } | null>(null);

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

  // Sub-timer (clock in/out per stop)
  const { data: subTimers } = useListSubTimers({ query: { queryKey: getListSubTimersQueryKey() } });
  const startSubTimer = useStartSubTimer();
  const stopSubTimer = useStopSubTimer();
  const updateJob = useUpdateJob();
  const [clockOutJobId, setClockOutJobId] = useState<number | null>(null);

  const resequence = useResequenceRoute();
  const updateJobRoute = useUpdateJobRoute();
  const rescheduleOnce = useRescheduleJobOnce();
  const createJob = useCreateJob();

  const { data: customers } = useListCustomers({}, {
    query: { enabled: newJobOpen, queryKey: getListCustomersQueryKey({}) },
  });

  const selectedCustomerIdNum = newJob.customerId ? parseInt(newJob.customerId, 10) : undefined;
  const { data: customerProperties } = useListProperties(
    { customerId: selectedCustomerIdNum },
    { query: { enabled: newJobOpen && !!selectedCustomerIdNum, queryKey: getListPropertiesQueryKey({ customerId: selectedCustomerIdNum }) } },
  );

  // Auto-select when the customer has exactly one property
  useEffect(() => {
    if (!customerProperties) return;
    if (customerProperties.length === 1) {
      setNewJob(f => ({ ...f, propertyId: String(customerProperties[0].id) }));
    } else {
      setNewJob(f => ({ ...f, propertyId: '' }));
    }
  }, [customerProperties]);

  const { data: users } = useListUsers({
    query: { enabled: newJobOpen, queryKey: getListUsersQueryKey() },
  });
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const durationUnit = settings?.durationUnit ?? 'minutes';

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

  const doAddStop = () => {
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

  const handleAddStop = () => {
    if (!addStopJobId || !dayDetail || !detail) return;
    const selectedJob = unassignedJobsForDay.find(j => j.id === Number(addStopJobId));
    const jobMins = selectedJob?.estimatedDuration ?? 0;
    const jobHours = jobMins / 60;
    const overBy = jobHours - detail.capacity.openSpaceHours;
    if (overBy > 0) {
      setCapacityWarning({
        message: `Adding this job (${jobHours.toFixed(1)}h estimated) will put the route ${overBy.toFixed(1)}h over capacity.`,
        onConfirm: doAddStop,
      });
      return;
    }
    doAddStop();
  };

  const handleRemoveStop = (jobId: number) => {
    if (!window.confirm('Remove this job from the route?')) return;
    updateJobRoute.mutate({ id: jobId, data: { routeTemplateId: null } }, {
      onSuccess: () => { toast.success('Removed from route'); invalidateDetail(); },
      onError: () => toast.error('Failed to remove job from route'),
    });
  };

  const openNewJob = () => {
    if (!dayDetail) return;
    setNewJob({ ...EMPTY_JOB, scheduledAt: `${dayDetail.date}T09:00` });
    setNewJobOpen(true);
  };

  const doCreateJobFromRoute = (durationMins: number | undefined, recurrenceRule: ReturnType<typeof buildRecurrenceRule>, routeTemplateId: number, scheduledAtIso: string) => {
    createJob.mutate({
      data: {
        title: newJob.title,
        description: newJob.description || undefined,
        scheduledAt: scheduledAtIso,
        estimatedDuration: durationMins,
        priority: newJob.priority as 'low' | 'normal' | 'high' | 'urgent',
        customerId: newJob.customerId ? parseInt(newJob.customerId, 10) : undefined,
        propertyId: newJob.propertyId ? parseInt(newJob.propertyId, 10) : undefined,
        assigneeId: newJob.assigneeId ? parseInt(newJob.assigneeId, 10) : undefined,
        recurrenceRule,
        smsReminderEnabled: newJob.smsReminderEnabled,
      },
    }, {
      onSuccess: (job) => {
        // Assign the newly created job to this route/day in the same step so it shows up
        // as a stop immediately, without a separate "Add Stop" action.
        updateJobRoute.mutate({ id: job.id, data: { routeTemplateId, scheduledAt: scheduledAtIso } }, {
          onSuccess: () => {
            toast.success(recurrenceRule ? 'Recurring job series created and added to route' : 'Job created and added to route');
            setNewJobOpen(false);
            setNewJob(EMPTY_JOB);
            invalidateDetail();
            qc.invalidateQueries({ queryKey: getListJobsQueryKey({ startDate: dayDetail!.date, endDate: dayDetailEndDate }) });
            qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
          },
          onError: () => toast.error('Job was created but could not be assigned to the route'),
        });
      },
      onError: () => toast.error('Failed to create job'),
    });
  };

  const handleCreateJobFromRoute = () => {
    if (!dayDetail || !detail) return;
    if (!newJob.title || !newJob.scheduledAt) {
      toast.error('Title and scheduled date are required');
      return;
    }
    const durationMins = newJob.estimatedDuration
      ? durationUnit === 'hours'
        ? Math.round(parseFloat(newJob.estimatedDuration) * 60)
        : parseInt(newJob.estimatedDuration, 10)
      : undefined;

    const recurrenceRule = buildRecurrenceRule(newJob);
    const routeTemplateId = dayDetail.routeTemplateId;
    const scheduledAtIso = new Date(newJob.scheduledAt).toISOString();

    const jobHours = durationMins ? durationMins / 60 : 0;
    const overBy = jobHours - detail.capacity.openSpaceHours;
    if (jobHours > 0 && overBy > 0) {
      setCapacityWarning({
        message: `This job's estimated duration (${jobHours.toFixed(1)}h) will put the route ${overBy.toFixed(1)}h over capacity.`,
        onConfirm: () => doCreateJobFromRoute(durationMins, recurrenceRule, routeTemplateId, scheduledAtIso),
      });
      return;
    }
    doCreateJobFromRoute(durationMins, recurrenceRule, routeTemplateId, scheduledAtIso);
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
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={openNewJob}>
                      <Plus className="w-3.5 h-3.5" /> New Job
                    </Button>
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
                    {[...detail.stops]
                      .sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0))
                      .map((stop, idx) => (
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
                          {(() => {
                            const activeTimer = subTimers?.find(t => t.isActive && t.jobId === stop.jobId);
                            return activeTimer ? (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 text-xs gap-1 text-amber-600 hover:text-amber-700"
                                disabled={stopSubTimer.isPending}
                                onClick={() => stopSubTimer.mutate({ id: activeTimer.id }, {
                                  onSuccess: () => { qc.invalidateQueries({ queryKey: getListSubTimersQueryKey() }); setClockOutJobId(stop.jobId); },
                                  onError: () => toast.error('Failed to clock out'),
                                })}
                              >
                                <Square className="w-3 h-3 fill-amber-600" /> Clock Out
                              </Button>
                            ) : (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 text-xs gap-1 text-muted-foreground"
                                disabled={startSubTimer.isPending}
                                onClick={() => startSubTimer.mutate({ data: { label: stop.title, type: 'job', jobId: stop.jobId } }, {
                                  onSuccess: () => { toast.success('Clocked in'); qc.invalidateQueries({ queryKey: getListSubTimersQueryKey() }); },
                                  onError: () => toast.error('Failed to clock in'),
                                })}
                              >
                                <Play className="w-3.5 h-3.5" /> Clock In
                              </Button>
                            );
                          })()}
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

      {/* Mark complete after clock-out */}
      <Dialog open={clockOutJobId !== null} onOpenChange={open => { if (!open) setClockOutJobId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark Job Complete?</DialogTitle>
            <DialogDescription>You've clocked out. Do you want to mark this job as completed?</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { toast.success('Clocked out'); setClockOutJobId(null); }}>Not yet</Button>
            <Button onClick={() => {
              if (!clockOutJobId) return;
              updateJob.mutate({ id: clockOutJobId, data: { status: 'completed' } }, {
                onSuccess: () => {
                  toast.success('Job marked complete');
                  qc.invalidateQueries({ queryKey: getGetRouteDayDetailQueryKey(dayDetail?.routeTemplateId ?? 0, { date: dayDetail?.date ?? '' }) });
                  qc.invalidateQueries({ queryKey: getJobsQueryKey() });
                  setClockOutJobId(null);
                },
                onError: () => toast.error('Failed to update job'),
              });
            }} disabled={updateJob.isPending}>
              {updateJob.isPending ? 'Saving…' : 'Mark Complete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Capacity Over-booking Warning Dialog */}
      <Dialog open={!!capacityWarning} onOpenChange={open => { if (!open) setCapacityWarning(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Route Over Capacity</DialogTitle>
            <DialogDescription>{capacityWarning?.message} Do you want to proceed anyway?</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCapacityWarning(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { capacityWarning?.onConfirm(); setCapacityWarning(null); }}>
              Proceed Anyway
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

      {/* New Job Sheet — creates a brand-new job and assigns it straight to this route/day */}
      <Sheet open={newJobOpen} onOpenChange={open => { if (!open) { setNewJobOpen(false); setNewJob(EMPTY_JOB); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>New Job</SheetTitle>
            <SheetDescription>
              {detail ? `Creates a job scheduled for ${format(new Date(`${detail.date}T00:00:00`), 'EEEE, MMM d')} and adds it to ${detail.routeTemplateName} automatically.` : 'Creates a job and adds it to this route automatically.'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <JobFormFields
              form={newJob}
              setForm={setNewJob}
              customers={customers?.items ?? []}
              properties={customerProperties ?? []}
              users={users ?? []}
              durationUnit={durationUnit}
            />

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => { setNewJobOpen(false); setNewJob(EMPTY_JOB); }}>Cancel</Button>
              <Button onClick={handleCreateJobFromRoute} disabled={createJob.isPending || updateJobRoute.isPending}>
                {createJob.isPending || updateJobRoute.isPending ? 'Creating...' : 'Create & Add to Route'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
