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
  useStartSubTimer, useStopSubTimer, getGetMasterClockQueryKey,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, MapPinned, Route as RouteIcon, ArrowUp, ArrowDown,
  Wand2, Clock, User, Building, CalendarClock, Plus, Play, Square, Timer,
  Printer, CheckCircle, Eye, MessageSquare, Users, Check, ChevronsUpDown,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import RoutingSettings from '@/components/settings/RoutingSettings';
import { useListCrews, getListCrewsQueryKey } from '@workspace/api-client-react';
import { startOfWeek, addWeeks, subWeeks, format, addDays } from 'date-fns';
import { JobFormFields, EMPTY_JOB, buildRecurrenceRule, type NewJobForm } from '@/components/jobs/JobFormFields';
import { BulkJobScheduler } from '@/components/jobs/BulkJobScheduler';

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
  const [addStopJobPickerOpen, setAddStopJobPickerOpen] = useState(false);
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
  const [bulkJobOpen, setBulkJobOpen] = useState(false);
  const [newJob, setNewJob] = useState<NewJobForm>(EMPTY_JOB);
  const [capacityWarning, setCapacityWarning] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [routeTab, setRouteTab] = useState('dashboard');

  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd');

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

  // By Crew tab: all jobs for the selected week, grouped by crew
  const { data: weekJobs } = useListJobs(
    { startDate: weekStartStr, endDate: weekEndStr },
    { query: { enabled: routeTab === 'by-crew', queryKey: getListJobsQueryKey({ startDate: weekStartStr, endDate: weekEndStr }) } },
  );
  const { data: crews } = useListCrews({ query: { enabled: routeTab === 'by-crew' || newJobOpen, queryKey: getListCrewsQueryKey() } });

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

  const [newJobCustomerSearch, setNewJobCustomerSearch] = useState('');
  const debouncedNewJobCustomerSearch = useDebounce(newJobCustomerSearch, 250);
  const customerQueryParams = { q: debouncedNewJobCustomerSearch || undefined, limit: 50 };
  const { data: customers, isFetching: customerSearchPending } = useListCustomers(customerQueryParams, {
    query: { enabled: newJobOpen, queryKey: getListCustomersQueryKey(customerQueryParams) },
  });

  const selectedCustomerIdNum = newJob.customerId ? parseInt(newJob.customerId, 10) : undefined;
  const { data: customerProperties } = useListProperties(
    { customerId: selectedCustomerIdNum },
    { query: { enabled: newJobOpen && !!selectedCustomerIdNum, queryKey: getListPropertiesQueryKey({ customerId: selectedCustomerIdNum }) } },
  );

  // Auto-select when the customer has exactly one property
  useEffect(() => {
    if (!customerProperties) return;
    setNewJob(f => f.propertyId || customerProperties.length === 0
      ? f
      : ({ ...f, propertyId: String(customerProperties[0].id) }));
  }, [customerProperties]);

  const { data: users } = useListUsers({
    query: { enabled: newJobOpen, queryKey: getListUsersQueryKey() },
  });
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const durationUnit = settings?.durationUnit ?? 'minutes';

  // Sync the create-job form's duration unit to the tenant default.
  // Use a ref so we only auto-apply the setting once per open session and never
  // overwrite a deliberate unit selection the user has already made.
  const syncedJobFormDurationUnit = React.useRef(false);
  useEffect(() => {
    if (newJobOpen) {
      syncedJobFormDurationUnit.current = false; // arm for this session
      if (settings?.durationUnit) {
        setNewJob(j => ({ ...j, estimatedDurationUnit: settings.durationUnit as 'minutes' | 'hours' }));
        syncedJobFormDurationUnit.current = true;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newJobOpen]);
  // Handle settings loading after the form is already open.
  useEffect(() => {
    if (newJobOpen && settings?.durationUnit && !syncedJobFormDurationUnit.current) {
      setNewJob(j => ({ ...j, estimatedDurationUnit: settings.durationUnit as 'minutes' | 'hours' }));
      syncedJobFormDurationUnit.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.durationUnit]);

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

  const [removeStopJobId, setRemoveStopJobId] = useState<number | null>(null);

  const handleRemoveStop = (jobId: number) => {
    setRemoveStopJobId(jobId);
  };

  const confirmRemoveStop = () => {
    if (!removeStopJobId) return;
    updateJobRoute.mutate({ id: removeStopJobId, data: { routeTemplateId: null } }, {
      onSuccess: () => { toast.success('Removed from route'); invalidateDetail(); setRemoveStopJobId(null); },
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
        serviceId: newJob.serviceId ? parseInt(newJob.serviceId, 10) : undefined,
        priority: newJob.priority as 'low' | 'normal' | 'high' | 'urgent',
        customerId: newJob.customerId ? parseInt(newJob.customerId, 10) : undefined,
        propertyId: newJob.propertyId ? parseInt(newJob.propertyId, 10) : undefined,
        assigneeId: newJob.assigneeId ? parseInt(newJob.assigneeId, 10) : undefined,
        crewId: newJob.crewId ? parseInt(newJob.crewId, 10) : undefined,
        recurrenceRule,
        smsReminderEnabled: newJob.smsReminderEnabled,
        ...(newJob.offSeasonEnabled ? { offSeasonStart: newJob.offSeasonStart, offSeasonEnd: newJob.offSeasonEnd } : {}),
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
      ? newJob.estimatedDurationUnit === 'hours'
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Routes</h1>
        <p className="text-muted-foreground mt-1">Plan, sequence, and manage your field routes.</p>
      </div>

      <Tabs value={routeTab} onValueChange={setRouteTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="by-crew">By Crew</TabsTrigger>
          <TabsTrigger value="manage">Manage</TabsTrigger>
        </TabsList>

        {/* ── Dashboard tab ── */}
        <TabsContent value="dashboard" className="space-y-4 mt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={divisionFilter} onValueChange={setDivisionFilter}>
              <SelectTrigger className="w-44" title="Filter routes by division"><SelectValue placeholder="All Divisions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Divisions</SelectItem>
                {(divisions ?? []).map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 border rounded-lg px-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Go to previous week" onClick={() => setWeekStart(w => subWeeks(w, 1))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium px-2 whitespace-nowrap flex items-center gap-2">
                {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
                {format(weekStart, 'yyyy-MM-dd') === format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd') && (
                  <span className="text-xs font-normal text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">This week</span>
                )}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Go to next week" onClick={() => setWeekStart(w => addWeeks(w, 1))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" title="Jump to the current week" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }))}>This Week</Button>
          </div>

      {!isLoading && (dashboard ?? []).length > 0 && (() => {
        const allEntries = (dashboard ?? []);
        const totalStops = allEntries.reduce((s, e) => s + (e.stopCount ?? 0), 0);
        const completedStops = allEntries.reduce((s, e) => s + ((e as any).completedStops ?? 0), 0);
        const totalHours = allEntries.reduce((s, e) => s + (e.capacity?.usedHours ?? 0), 0);
        const shiftHours = allEntries.reduce((s, e) => s + (e.capacity?.shiftHours ?? 0), 0);
        return (
          <div className="flex items-center gap-6 text-sm text-muted-foreground border rounded-lg px-4 py-2.5 bg-muted/20">
            <span title={`${allEntries.length} route${allEntries.length !== 1 ? 's' : ''} scheduled`}><span className="font-medium text-foreground">{allEntries.length}</span> route{allEntries.length !== 1 ? 's' : ''}</span>
            <span title={`${completedStops} of ${totalStops} stops completed`}><span className="font-medium text-foreground">{completedStops}/{totalStops}</span> stops done</span>
            <span title={`${totalHours.toFixed(1)} hours worked out of ${shiftHours.toFixed(1)} scheduled`}><span className="font-medium text-foreground">{totalHours.toFixed(1)}h</span> / {shiftHours.toFixed(1)}h scheduled</span>
          </div>
        );
      })()}
      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading routes...</div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MapPinned className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="font-semibold text-lg mb-2">No routes this week</p>
            <p className="text-muted-foreground text-sm">Set up divisions and route templates in the Manage tab.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(g => (
            <div key={g.divisionName} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide" title={g.divisionName}>{g.divisionName}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {g.entries.map(entry => {
                  const pctUsed = entry.capacity.shiftHours > 0 ? Math.min(100, (entry.capacity.usedHours / entry.capacity.shiftHours) * 100) : 0;
                  return (
                    <Card
                      key={entry.routeTemplateId}
                      className={`cursor-pointer hover:shadow-md transition-shadow ${entry.runDate === format(new Date(), 'yyyy-MM-dd') ? 'border-primary ring-1 ring-primary/30' : ''}`}
                      onClick={() => setDayDetail({ routeTemplateId: entry.routeTemplateId, date: entry.runDate })}
                    >
                      <CardContent className="pt-5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold" title={entry.routeTemplateName}>{entry.routeTemplateName}</p>
                            <p className="text-xs text-muted-foreground mt-0.5" title={`${format(new Date(`${entry.runDate}T00:00:00`), 'EEEE, MMMM d, yyyy')} · ${FREQUENCY_LABEL[entry.frequency] ?? entry.frequency}`}>{format(new Date(`${entry.runDate}T00:00:00`), 'EEE, MMM d')} · {FREQUENCY_LABEL[entry.frequency] ?? entry.frequency}</p>
                          </div>
                          <Badge variant="secondary" title={(entry as any).completedStops != null ? `${(entry as any).completedStops} of ${entry.stopCount} stops completed` : `${entry.stopCount} stop${entry.stopCount !== 1 ? 's' : ''} on this route`}>
                            {(entry as any).completedStops != null
                              ? `${(entry as any).completedStops}/${entry.stopCount} done`
                              : `${entry.stopCount} stop${entry.stopCount !== 1 ? 's' : ''}`}
                          </Badge>
                        </div>
                        <Progress value={pctUsed} className={entry.capacity.openSpaceHours < 0 ? '[&>div]:bg-red-500' : undefined} />
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span title={`${entry.capacity.usedHours.toFixed(1)} hours used of ${entry.capacity.shiftHours.toFixed(1)} shift hours${(entry.capacity as any).driveHours != null ? ` · ${(entry.capacity as any).driveHours.toFixed(1)}h driving` : ''}`}>{entry.capacity.usedHours.toFixed(1)}h / {entry.capacity.shiftHours.toFixed(1)}h shift{(entry.capacity as any).driveHours != null ? ` · ${(entry.capacity as any).driveHours.toFixed(1)}h drive` : ''}</span>
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

        </TabsContent>

        {/* ── By Crew tab ── */}
        <TabsContent value="by-crew" className="space-y-4 mt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 border rounded-lg px-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Previous week" onClick={() => setWeekStart(w => subWeeks(w, 1))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium px-2 whitespace-nowrap flex items-center gap-2">
                {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
                {format(weekStart, 'yyyy-MM-dd') === format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd') && (
                  <span className="text-xs font-normal text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">This week</span>
                )}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Next week" onClick={() => setWeekStart(w => addWeeks(w, 1))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }))}>This Week</Button>
          </div>
          {(() => {
            const jobs = weekJobs ?? [];
            if (jobs.length === 0) {
              return (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Users className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                    <p className="font-medium mb-1">No jobs this week</p>
                    <p className="text-sm text-muted-foreground">Jobs assigned to crews will appear here grouped by crew.</p>
                  </CardContent>
                </Card>
              );
            }
            // Group jobs by crewId
            const byCrewMap = new Map<string, { crewId: number | null; crewName: string | null; jobs: typeof jobs }>();
            for (const j of jobs) {
              const key = (j as any).crewId ? String((j as any).crewId) : 'unassigned';
              if (!byCrewMap.has(key)) {
                byCrewMap.set(key, { crewId: (j as any).crewId ?? null, crewName: (j as any).crewName ?? null, jobs: [] });
              }
              byCrewMap.get(key)!.jobs.push(j);
            }
            const groups = [...byCrewMap.values()].sort((a, b) => {
              if (!a.crewId) return 1; // unassigned last
              if (!b.crewId) return -1;
              return (a.crewName ?? '').localeCompare(b.crewName ?? '');
            });
            return (
              <div className="space-y-4">
                {groups.map(g => (
                  <div key={g.crewId ?? 'unassigned'}>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold">{g.crewName ?? 'Unassigned'}</h2>
                      <Badge variant="secondary" title={`${g.jobs.length} job${g.jobs.length !== 1 ? 's' : ''} for this crew`}>{g.jobs.length} job{g.jobs.length !== 1 ? 's' : ''}</Badge>
                    </div>
                    <div className="rounded-lg border divide-y overflow-hidden">
                      {[...g.jobs].sort((a, b) => new Date(a.scheduledAt ?? '').getTime() - new Date(b.scheduledAt ?? '').getTime()).map(j => (
                        <div key={j.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{j.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {j.scheduledAt ? format(new Date(j.scheduledAt), 'EEE MMM d · h:mm a') : '—'}
                              {j.customerName ? ` · ${j.customerName}` : ''}
                              {(j as any).assigneeName ? ` · ${(j as any).assigneeName}` : ''}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={j.status === 'completed' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : j.status === 'in_progress' ? 'border-blue-300 text-blue-700 bg-blue-50' : ''}
                          >
                            {j.status.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </TabsContent>

        {/* ── Manage tab — Divisions, Route Templates, exception fee ── */}
        <TabsContent value="manage" className="mt-2">
          <RoutingSettings />
        </TabsContent>
      </Tabs>

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
                  <div className="flex-1">
                    <SheetTitle className="text-xl">{detail.routeTemplateName}</SheetTitle>
                    <SheetDescription className="mt-0.5">
                      {format(new Date(`${detail.date}T00:00:00`), 'EEEE, MMM d, yyyy')} · {detail.divisionName}
                      {detail.depotLabel && ` · Depot: ${detail.depotLabel}`}
                    </SheetDescription>
                    {detail.stops.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {detail.stops.length} stop{detail.stops.length !== 1 ? 's' : ''}
                        {detail.capacity.usedHours > 0 && ` · ${detail.capacity.usedHours.toFixed(1)}h`}
                        {(() => { const done = detail.stops.filter((s: any) => s.status === 'completed').length; return done > 0 ? ` · ${done}/${detail.stops.length} done` : null; })()}
                      </p>
                    )}
                    {detail.stops.filter((s: any) => s.propertyAddress).length > 0 && (
                      <a
                        href={`https://www.google.com/maps/dir/${detail.stops.filter((s: any) => s.propertyAddress).map((s: any) => encodeURIComponent(s.propertyAddress)).join('/')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open turn-by-turn directions for all stops"
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-1.5"
                      >
                        <MapPinned className="w-3.5 h-3.5" /> Open full route in Google Maps
                      </a>
                    )}
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
                    <span title={`Budgeted job hours: ${detail.capacity.budgetedJobHours.toFixed(1)}h`}>Jobs: {detail.capacity.budgetedJobHours.toFixed(1)}h</span>
                    <span title={`Estimated drive time: ${detail.capacity.driveHours.toFixed(1)}h`}>Drive: {detail.capacity.driveHours.toFixed(1)}h</span>
                    <span title={`Total shift length: ${detail.capacity.shiftHours.toFixed(1)}h`}>Shift: {detail.capacity.shiftHours.toFixed(1)}h</span>
                  </div>
                   <p className="text-[10px] text-muted-foreground pt-1">
                     Drive times: {detail.timingSource === 'google' ? 'Google Routes' : detail.timingSource === 'mixed' ? 'Google Routes + estimate' : '28 mph estimate'}
                   </p>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Stops ({detail.stops.filter((s: any) => s.status === 'completed').length}/{detail.stops.length} complete)
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" title="Create a new job and add it to this route" onClick={openNewJob}>
                      <Plus className="w-3.5 h-3.5" /> New Job
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" title="Create several jobs with shared service details" onClick={() => setBulkJobOpen(true)} data-testid="button-bulk-schedule-jobs">
                      <Users className="w-3.5 h-3.5" /> Schedule Multiple
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" title="Add an existing job as a stop on this route" onClick={() => setAddStopOpen(true)}>
                      <Plus className="w-3.5 h-3.5" /> Add Stop
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" title="Re-sequence stops by nearest-neighbor distance" onClick={handleAutoOptimize} disabled={resequence.isPending}>
                      <Wand2 className="w-3.5 h-3.5" /> {resequence.isPending ? 'Optimizing…' : 'Auto-Optimize'}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" title="Print this route sheet" onClick={() => window.print()}>
                      <Printer className="w-3.5 h-3.5" /> Print
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
                            {stop.status === 'completed'
                              ? <div className="shrink-0 h-6 w-6 flex items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle className="w-4 h-4" /></div>
                              : <Badge variant="outline" className="shrink-0 h-6 w-6 flex items-center justify-center p-0 rounded-full">{idx + 1}</Badge>
                            }
                            <div>
                              {stop.jobId ? (
                                <button title={stop.title} className={`text-sm font-medium text-left hover:underline text-primary ${stop.status === 'completed' ? 'line-through text-muted-foreground' : ''}`} onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}schedule?jobId=${stop.jobId}`; }}>{stop.title}</button>
                              ) : (
                                <p title={stop.title} className={`text-sm font-medium ${stop.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>{stop.title}</p>
                              )}
                              {stop.customerName && (
                                (stop as any).customerId
                                  ? <button title={`View ${stop.customerName}`} className="text-xs text-primary hover:underline" onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}customers/${(stop as any).customerId}`; }}>{stop.customerName}</button>
                                  : <p title={stop.customerName} className="text-xs text-muted-foreground">{stop.customerName}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant={stop.status === 'completed' ? 'outline' : 'secondary'} className={`text-xs ${stop.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}`} title={`Stop status: ${stop.status.replace(/_/g, ' ')}`}>{stop.status.replace(/_/g, ' ')}</Badge>
                            <span title={`${stop.driveMinutesFromPrev} minute drive from ${idx === 0 ? 'depot' : 'previous stop'} (${stop.driveTimeSource === 'google' ? 'Google Routes' : 'estimated'})`} className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />+{stop.driveMinutesFromPrev}m drive · {stop.driveTimeSource === 'google' ? 'Google' : 'Est.'}</span>
                            <span className="text-[10px] text-muted-foreground" title={`Estimated route start: ${new Date(stop.estimatedStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}>Route start {new Date(stop.estimatedStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {(stop as any).estimatedArrival && <span className="text-[10px] text-muted-foreground" title={`Estimated arrival: ${new Date((stop as any).estimatedArrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}>ETA {new Date((stop as any).estimatedArrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground pl-8">
                          {stop.propertyAddress && (
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.propertyAddress)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Get directions in Google Maps"
                              className="flex items-center gap-1 hover:text-primary hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              <Building className="w-3 h-3" />{stop.propertyAddress}
                            </a>
                          )}
                          {(stop.assigneeName || stop.crewName) && <span title={stop.assigneeName ?? stop.crewName ?? undefined} className="flex items-center gap-1"><User className="w-3 h-3" />{stop.assigneeName ?? stop.crewName}</span>}
                          {stop.estimatedDuration != null && <span title={`Estimated job duration: ${stop.estimatedDuration} minutes`}>{stop.estimatedDuration}min job</span>}
                          {(stop as any).hasNotes && <span className="flex items-center gap-0.5 text-blue-500" title="Job has notes"><MessageSquare className="w-3 h-3" /> Notes</span>}
                        </div>
                        <div className="flex items-center gap-1 pl-8 pt-1">
                          <Button variant="ghost" size="icon" title="Move this stop earlier in the route" className="h-6 w-6" onClick={() => moveStop(idx, idx - 1)} disabled={idx === 0 || resequence.isPending}>
                            <ArrowUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Move this stop later in the route" className="h-6 w-6" onClick={() => moveStop(idx, idx + 1)} disabled={idx === detail.stops.length - 1 || resequence.isPending}>
                            <ArrowDown className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Reschedule this job to a different date" className="h-6 text-xs gap-1 text-muted-foreground" onClick={() => { setRescheduleJobId(stop.jobId); setRescheduleDate(detail.date); }}>
                            <CalendarClock className="w-3.5 h-3.5" /> Reschedule
                          </Button>
                          {(() => {
                            const activeTimer = subTimers?.find(t => t.isActive && t.jobId === stop.jobId);
                            return activeTimer ? (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 text-xs gap-1 text-amber-600 hover:text-amber-700"
                                title="Clock out of this job and stop the running timer"
                                disabled={stopSubTimer.isPending}
                                onClick={() => stopSubTimer.mutate({ id: activeTimer.id }, {
                                  onSuccess: () => { qc.invalidateQueries({ queryKey: getListSubTimersQueryKey() }); setClockOutJobId(stop.jobId); },
                                  onError: () => toast.error('Failed to clock out'),
                                })}
                              >
                                <Square className="w-3 h-3 fill-amber-600" /> {stopSubTimer.isPending ? 'Clocking Out…' : 'Clock Out'}
                              </Button>
                            ) : (
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 text-xs gap-1 text-muted-foreground"
                                title="Clock in to this job and start a timer"
                                disabled={startSubTimer.isPending}
                                onClick={() => startSubTimer.mutate({ data: { label: stop.title, type: 'job', jobId: stop.jobId } }, {
                                  onSuccess: () => { toast.success('Clocked in'); qc.invalidateQueries({ queryKey: getListSubTimersQueryKey() }); qc.invalidateQueries({ queryKey: getGetMasterClockQueryKey() }); },
                                  onError: () => toast.error('Failed to clock in'),
                                })}
                              >
                                <Play className="w-3.5 h-3.5" /> {startSubTimer.isPending ? 'Clocking…' : 'Clock In'}
                              </Button>
                            );
                          })()}
                          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-primary" title="Open this job in the schedule view" onClick={e => { e.stopPropagation(); window.location.href = `${import.meta.env.BASE_URL}schedule?jobId=${stop.jobId}`; }}>
                            <Eye className="w-3.5 h-3.5" /> View
                          </Button>
                          <Button variant="ghost" size="sm" title="Remove this job from the route" className="h-6 text-xs ml-auto text-destructive hover:text-destructive" onClick={() => handleRemoveStop(stop.jobId)}>
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
            <Button variant="outline" title="Cancel rescheduling this stop" onClick={() => setRescheduleJobId(null)}>Cancel</Button>
            <Button title="Reschedule this stop and apply the route exception fee" onClick={handleReschedule} disabled={!rescheduleDate || rescheduleOnce.isPending}>
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
            <Button variant="outline" title="Clock out without marking the job complete" onClick={() => { toast.success('Clocked out'); setClockOutJobId(null); }}>Not yet</Button>
            <Button title="Clock out and mark this job as completed" onClick={() => {
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
            <Button variant="outline" title="Cancel and keep the route as-is" onClick={() => setCapacityWarning(null)}>Cancel</Button>
            <Button variant="destructive" title="Proceed and add the stop despite the capacity warning" onClick={() => { capacityWarning?.onConfirm(); setCapacityWarning(null); }}>
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
          <Popover open={addStopJobPickerOpen} onOpenChange={setAddStopJobPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={addStopJobPickerOpen}
                className="w-full justify-between font-normal"
                title="Search by customer name or job title"
                data-testid="button-route-job-picker"
              >
                <span className={cn('truncate', !addStopJobId && 'text-muted-foreground')}>
                  {addStopJobId
                    ? (() => {
                        const selected = unassignedJobsForDay.find(job => String(job.id) === addStopJobId);
                        return selected ? `${selected.title}${selected.customerName ? ` — ${selected.customerName}` : ''}` : `Job #${addStopJobId}`;
                      })()
                    : 'Search customer or job...'}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 z-[1300]" align="start">
              <Command>
                <CommandInput placeholder="Search customer or job..." data-testid="input-route-job-search" />
                <CommandList>
                  <CommandEmpty>No matching jobs scheduled this day.</CommandEmpty>
                  <CommandGroup>
                    {unassignedJobsForDay.map(job => (
                      <CommandItem
                        key={job.id}
                        value={`${job.title} ${job.customerName ?? ''} ${job.id}`}
                        onSelect={() => {
                          setAddStopJobId(String(job.id));
                          setAddStopJobPickerOpen(false);
                        }}
                        data-testid={`option-route-job-${job.id}`}
                      >
                        <Check className={cn('mr-2 h-4 w-4', addStopJobId === String(job.id) ? 'opacity-100' : 'opacity-0')} />
                        <span className="truncate">{job.title}{job.customerName ? ` — ${job.customerName}` : ''}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" title="Cancel adding a stop to this route" onClick={() => setAddStopOpen(false)}>Cancel</Button>
            <Button title="Add the selected job as a stop on this route" onClick={handleAddStop} disabled={!addStopJobId || updateJobRoute.isPending}>
              {updateJobRoute.isPending ? 'Adding...' : 'Add to Route'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Job Sheet — creates a brand-new job and assigns it straight to this route/day */}
      <BulkJobScheduler
        open={bulkJobOpen}
        onOpenChange={setBulkJobOpen}
        routeTemplateId={detail?.routeTemplateId}
        routeName={detail?.routeTemplateName}
        routeDate={detail?.date}
        durationUnit={durationUnit as 'minutes' | 'hours'}
        users={users ?? []}
        crews={crews ?? []}
        ownersSchedulable={(settings as any)?.ownersSchedulable ?? false}
        onComplete={() => {
          invalidateDetail();
          if (dayDetail) qc.invalidateQueries({ queryKey: getListJobsQueryKey({ startDate: dayDetail.date, endDate: dayDetailEndDate }) });
          qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
        }}
      />

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
              onCustomerSearch={setNewJobCustomerSearch}
              customerSearchPending={customerSearchPending}
              properties={customerProperties ?? []}
              users={users ?? []}
              crews={crews ?? []}
              ownersSchedulable={(settings as any)?.ownersSchedulable ?? false}
              durationUnit={durationUnit}
              defaultOffSeasonStart={settings?.defaultOffSeasonStart}
              defaultOffSeasonEnd={settings?.defaultOffSeasonEnd}
            />

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" title="Discard this new job" onClick={() => { setNewJobOpen(false); setNewJob(EMPTY_JOB); }}>Cancel</Button>
              <Button title="Create this job and add it as a stop on the current route" onClick={handleCreateJobFromRoute} disabled={createJob.isPending || updateJobRoute.isPending}>
                {createJob.isPending || updateJobRoute.isPending ? 'Creating...' : 'Create & Add to Route'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Remove Stop Confirmation */}
      <Dialog open={removeStopJobId !== null} onOpenChange={open => { if (!open) setRemoveStopJobId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove from Route</DialogTitle>
            <DialogDescription>Remove this job from the route? The job will still exist and can be re-added later.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" title="Keep this job on the route" onClick={() => setRemoveStopJobId(null)}>Cancel</Button>
            <Button variant="destructive" title="Remove this stop from the route — the job is not deleted" disabled={updateJobRoute.isPending} onClick={confirmRemoveStop}>
              {updateJobRoute.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
