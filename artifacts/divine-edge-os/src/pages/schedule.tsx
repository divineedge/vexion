import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  useListJobs, getListJobsQueryKey,
  useGetJob, getGetJobQueryKey,
  useUpdateJob, useCreateJob,
  useListCustomers, getListCustomersQueryKey,
  useListUsers, getListUsersQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useListJobChemicalApplications, getListJobChemicalApplicationsQueryKey,
  useCreateJobChemicalApplication,
  useListChemicalProducts, getListChemicalProductsQueryKey,
  useListChemicalMixtures, getListChemicalMixturesQueryKey,
  useDeleteChemicalApplication,
  useListJobAlerts, getListJobAlertsQueryKey,
  useCreateJobAlert,
  useSendJobReminder,
  useAddJobPart, useRemoveJobPart,
  useListInventoryItems, getListInventoryItemsQueryKey,
  useGetInventoryItemByLocation, getGetInventoryItemByLocationQueryKey,
  useListJobMedia, getListJobMediaQueryKey,
  useListEstimates, getListEstimatesQueryKey,
  useListVisits, getListVisitsQueryKey,
  useListRecurringSeries, getListRecurringSeriesQueryKey,
  useSkipNextOccurrence,
  usePauseRecurringSeries,
  useCancelRecurringSeries,
  useCreateRepairLog,
  useListRepairLogs, getListRepairLogsQueryKey,
  useListSubTimers, getListSubTimersQueryKey,
  useStartSubTimer, useStopSubTimer,
  useDeleteJob,
  useListRouteTemplates, getListRouteTemplatesQueryKey,
  useUpdateJobRoute,
  useListProperties, getListPropertiesQueryKey,
  useListCustomerPlans, getListCustomerPlansQueryKey,
} from '@workspace/api-client-react';
import MediaGallery from '@/components/media/MediaGallery';
import { JobFormFields, EMPTY_JOB, buildRecurrenceRule, type NewJobForm } from '@/components/jobs/JobFormFields';
import { useAuth } from '@/contexts/AuthContext';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Clock, MapPin, User, Calendar,
  DollarSign, ClipboardList, Plus, Users, FlaskConical, Trash2, AlertTriangle,
  Bell, BellOff, Send, Package, Search, Images, RefreshCw, Pause, Play, X,
  SkipForward, ListEnd, Wrench, Square, Timer, Warehouse, Truck,
  Route as RouteIcon, ExternalLink,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useDebounce } from '@/hooks/use-debounce';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  eachDayOfInterval, format, isSameDay, addWeeks, subWeeks, addMonths, subMonths,
} from 'date-fns';

function PartLocationBadges({ inventoryItemId }: { inventoryItemId: number }) {
  const [, navTo] = useLocation();
  const { data: locationStock } = useGetInventoryItemByLocation(inventoryItemId, {
    query: { queryKey: getGetInventoryItemByLocationQueryKey(inventoryItemId) },
  });
  if (!locationStock || locationStock.length === 0) return null;

  const totalStock = locationStock.reduce((sum, loc) => sum + loc.quantity, 0);
  const isOutOfStock = totalStock === 0;
  const isLowStock = !isOutOfStock && locationStock.some(loc => loc.isLowStock);

  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {isOutOfStock && (
        <button
          onClick={e => { e.stopPropagation(); navTo('/inventory'); }}
          title="Go to inventory to restock"
          className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-red-100 text-red-700 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-200 transition-colors cursor-pointer"
        >
          <AlertTriangle className="w-2.5 h-2.5" /> Out of Stock
        </button>
      )}
      {isLowStock && (
        <button
          onClick={e => { e.stopPropagation(); navTo('/inventory'); }}
          title="Go to inventory to restock"
          className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 hover:bg-amber-200 transition-colors cursor-pointer"
        >
          <AlertTriangle className="w-2.5 h-2.5" /> Low Stock
        </button>
      )}
      {locationStock.map(loc => (
        <span
          key={loc.id}
          className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted/70 rounded px-1.5 py-0.5"
        >
          {loc.locationName?.toLowerCase().includes('trailer')
            ? <Truck className="w-2.5 h-2.5" />
            : <Warehouse className="w-2.5 h-2.5" />}
          {loc.quantity} {loc.locationName}
        </span>
      ))}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  scheduled:   'bg-blue-100 text-blue-800 border-blue-200',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
  completed:   'bg-emerald-100 text-emerald-800 border-emerald-200',
  cancelled:   'bg-red-100 text-red-800 border-red-200',
  on_hold:     'bg-gray-100 text-gray-800 border-gray-200',
};

const PRIORITY_COLORS: Record<string, string> = {
  low:    'bg-slate-100 text-slate-600 border-transparent',
  normal: 'bg-blue-50 text-blue-700 border-transparent',
  high:   'bg-orange-100 text-orange-700 border-transparent',
  urgent: 'bg-red-100 text-red-700 border-transparent',
};

export default function SchedulePage() {
  const { user, isTechnician, canManageJobs } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'week' | 'month' | 'series'>('week');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newJob, setNewJob] = useState<NewJobForm>(EMPTY_JOB);
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [alertForm, setAlertForm] = useState({ type: 'issue', message: '' });

  // Edit scope dialog for recurring jobs
  const [editScopeOpen, setEditScopeOpen] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{ field: string; value: unknown } | null>(null);

  // Parts panel state
  const [partsSearch, setPartsSearch] = useState('');
  const debouncedPartsSearch = useDebounce(partsSearch, 300);
  const [addingPart, setAddingPart] = useState(false);
  const [partQty, setPartQty] = useState('1');
  const [chemFormOpen, setChemFormOpen] = useState(false);
  const [chemForm, setChemForm] = useState({
    mixtureId: '', productId: '', volumeApplied: '', volumeUnit: 'gal',
    targetPest: '', applicationMethod: '', windSpeed: '', windDirection: '',
    temperature: '', applicatorLicenseNumber: '', notes: '', appliedAt: '',
  });

  // Repair log state
  const [repairFormOpen, setRepairFormOpen] = useState(false);
  const EMPTY_SCHED_REPAIR = {
    componentType: 'sprinkler', replacedWhat: '', replacedWithName: '',
    partsCost: '', laborCost: '', notes: '', performedAt: '',
  };
  const [schedRepairForm, setSchedRepairForm] = useState(EMPTY_SCHED_REPAIR);
  const createRepairLog = useCreateRepairLog();
  const { data: jobRepairLogs } = useListRepairLogs(
    { jobId: selectedJobId! } as Parameters<typeof useListRepairLogs>[0],
    { query: { enabled: selectedJobId != null, queryKey: getListRepairLogsQueryKey({ jobId: selectedJobId! } as Parameters<typeof useListRepairLogs>[0]) } },
  );

  // Sub-timer (clock in/out on job)
  const { data: subTimers } = useListSubTimers({ query: { queryKey: getListSubTimersQueryKey() } });
  const startSubTimer = useStartSubTimer();
  const stopSubTimer = useStopSubTimer();
  const activeJobTimer = React.useMemo(
    () => subTimers?.find(t => t.isActive && t.jobId === selectedJobId) ?? null,
    [subTimers, selectedJobId],
  );
  const [liveJobSeconds, setLiveJobSeconds] = useState(0);
  useEffect(() => {
    if (!activeJobTimer) { setLiveJobSeconds(0); return; }
    const update = () => setLiveJobSeconds(Math.floor((Date.now() - new Date(activeJobTimer.startedAt).getTime()) / 1000));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [activeJobTimer?.id]);
  const [clockOutJobId, setClockOutJobId] = useState<number | null>(null);

  // Route filter state (declared here so it's available before useListJobs)
  const [routeFilter, setRouteFilter] = useState<string>('all');

  const assigneeId = isTechnician && user ? user.id : undefined;

  const start = view === 'week' ? startOfWeek(currentDate) : startOfMonth(currentDate);
  const end   = view === 'week' ? endOfWeek(currentDate)   : endOfMonth(currentDate);

  const routeTemplateIdParam = routeFilter !== 'all' ? parseInt(routeFilter, 10) : undefined;

  const { data: jobs, isLoading } = useListJobs(
    { startDate: start.toISOString(), endDate: end.toISOString(), assigneeId, routeTemplateId: routeTemplateIdParam },
    { query: { queryKey: getListJobsQueryKey({ startDate: start.toISOString(), endDate: end.toISOString(), assigneeId, routeTemplateId: routeTemplateIdParam }) } },
  );

  const { data: selectedJob } = useGetJob(selectedJobId!, {
    query: { enabled: selectedJobId != null, queryKey: getGetJobQueryKey(selectedJobId!) },
  });

  const { data: customers } = useListCustomers({}, {
    query: { enabled: createOpen, queryKey: getListCustomersQueryKey({}) },
  });

  const selectedCustomerIdNum = newJob.customerId ? parseInt(newJob.customerId, 10) : undefined;
  const { data: customerProperties } = useListProperties(
    { customerId: selectedCustomerIdNum },
    { query: { enabled: createOpen && !!selectedCustomerIdNum, queryKey: getListPropertiesQueryKey({ customerId: selectedCustomerIdNum }) } },
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
    query: { enabled: createOpen, queryKey: getListUsersQueryKey() },
  });

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const durationUnit = settings?.durationUnit ?? 'minutes';

  const updateJob = useUpdateJob();
  const createJob = useCreateJob();

  const { data: chemApps, refetch: refetchChemApps } = useListJobChemicalApplications(selectedJobId!, {
    query: { enabled: selectedJobId != null, queryKey: getListJobChemicalApplicationsQueryKey(selectedJobId ?? 0) },
  });

  const { data: jobAlerts, refetch: refetchAlerts } = useListJobAlerts(selectedJobId!, {
    query: { enabled: selectedJobId != null, queryKey: getListJobAlertsQueryKey(selectedJobId ?? 0) },
  });
  const { data: jobMedia, refetch: refetchJobMedia } = useListJobMedia(selectedJobId!, {
    query: { enabled: selectedJobId != null, queryKey: getListJobMediaQueryKey(selectedJobId ?? 0) },
  });
  const createAlert = useCreateJobAlert();
  const sendReminder = useSendJobReminder();
  const { data: chemProducts } = useListChemicalProducts({ query: { queryKey: getListChemicalProductsQueryKey() } });
  const { data: chemMixtures } = useListChemicalMixtures({ query: { queryKey: getListChemicalMixturesQueryKey() } });
  const createChemApp = useCreateJobChemicalApplication();
  const deleteChemApp = useDeleteChemicalApplication();
  const deleteJob = useDeleteJob();
  const [deleteBlockedMsg, setDeleteBlockedMsg] = useState<string | null>(null);
  const updateJobRoute = useUpdateJobRoute();

  // Route templates (for route filter dropdown + job detail route assignment)
  const { data: routeTemplates } = useListRouteTemplates(undefined, {
    query: { queryKey: getListRouteTemplatesQueryKey() },
  });
  const assignedRoute = routeTemplates?.find(rt => rt.id === (selectedJob as any)?.routeTemplateId);

  // Recurring series hooks
  const { data: recurringSeries } = useListRecurringSeries({
    query: { enabled: view === 'series', queryKey: getListRecurringSeriesQueryKey() },
  });
  const skipNextOccurrence = useSkipNextOccurrence();
  const pauseSeries = usePauseRecurringSeries();
  const [pauseDialogRootId, setPauseDialogRootId] = useState<number | null>(null);
  const [pauseResumeAt, setPauseResumeAt] = useState('');

  // Plan-link state
  const [linkPlanSeriesId, setLinkPlanSeriesId] = useState<number | null>(null);
  const [linkPlanValue, setLinkPlanValue] = useState<string>('');
  const { data: allCustomerPlans } = useListCustomerPlans(
    { status: 'active' },
    { query: { enabled: view === 'series', queryKey: getListCustomerPlansQueryKey({ status: 'active' }) } },
  );

  function confirmPause(rootId: number) {
    pauseSeries.mutate({ id: rootId, data: { paused: true, resumeAt: pauseResumeAt ? new Date(pauseResumeAt).toISOString() : null } }, {
      onSuccess: () => {
        toast.success(pauseResumeAt ? `Series paused, will resume ${format(new Date(pauseResumeAt), 'MMM d, yyyy')}` : 'Series paused');
        qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() });
        qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
        setPauseDialogRootId(null);
        setPauseResumeAt('');
      },
      onError: () => toast.error('Failed to pause series'),
    });
  }
  const cancelSeries = useCancelRecurringSeries();

  // Job parts hooks
  const addJobPart = useAddJobPart();
  const removeJobPart = useRemoveJobPart();
  const { data: inventoryItems } = useListInventoryItems(
    { q: debouncedPartsSearch || undefined },
    { query: { enabled: addingPart, queryKey: getListInventoryItemsQueryKey({ q: debouncedPartsSearch || undefined }) } }
  );

  // Estimates and visits for schedule calendar
  const { data: estimates } = useListEstimates(
    { startDate: start.toISOString(), endDate: end.toISOString() },
    { query: { queryKey: getListEstimatesQueryKey({ startDate: start.toISOString(), endDate: end.toISOString() }) } },
  );
  const { data: visits } = useListVisits(
    {},
    { query: { queryKey: getListVisitsQueryKey({}) } },
  );

  const days = eachDayOfInterval({ start, end });
  const getJobsForDay = (date: Date) => jobs?.filter(j => isSameDay(new Date(j.scheduledAt), date)) ?? [];
  const getEstimatesForDay = (date: Date) =>
    (estimates ?? []).filter(e => e.scheduledAt && isSameDay(new Date(e.scheduledAt), date));
  const getVisitsForDay = (date: Date) =>
    (visits ?? []).filter(v => v.scheduledAt && isSameDay(new Date(v.scheduledAt), date));

  const nextRange = () => setCurrentDate(p => view === 'week' ? addWeeks(p, 1) : addMonths(p, 1));
  const prevRange = () => setCurrentDate(p => view === 'week' ? subWeeks(p, 1) : subMonths(p, 1));

  const handleStatusChange = (status: string) => {
    if (!selectedJobId) return;
    updateJob.mutate(
      { id: selectedJobId, data: { status: status as Parameters<typeof updateJob.mutate>[0]['data']['status'] } },
      {
        onSuccess: () => {
          toast.success('Status updated');
          qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
        },
        onError: () => toast.error('Failed to update status'),
      },
    );
  };

  const handleCreateJob = () => {
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

    createJob.mutate({
      data: {
        title: newJob.title,
        description: newJob.description || undefined,
        scheduledAt: new Date(newJob.scheduledAt).toISOString(),
        estimatedDuration: durationMins,
        priority: newJob.priority as 'low' | 'normal' | 'high' | 'urgent',
        customerId: newJob.customerId ? parseInt(newJob.customerId, 10) : undefined,
        propertyId: newJob.propertyId ? parseInt(newJob.propertyId, 10) : undefined,
        assigneeId: newJob.assigneeId ? parseInt(newJob.assigneeId, 10) : undefined,
        recurrenceRule,
        smsReminderEnabled: newJob.smsReminderEnabled,
      },
    }, {
      onSuccess: () => {
        toast.success(recurrenceRule ? 'Recurring job series created' : 'Job created');
        qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
        qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() });
        setCreateOpen(false);
        setNewJob(EMPTY_JOB);
      },
      onError: () => toast.error('Failed to create job'),
    });
  };

  const formatDuration = (mins: number | null | undefined) => {
    if (!mins) return null;
    if (durationUnit === 'hours') return `${(mins / 60).toFixed(1)} hr`;
    return `${mins} min`;
  };

  return (
    <div className="space-y-6 h-full flex flex-col animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
          <p className="text-muted-foreground mt-1">Manage field assignments and dispatches.</p>
        </div>
        <div className="flex items-center gap-4">
          {routeTemplates && routeTemplates.length > 0 && (
            <Select value={routeFilter} onValueChange={setRouteFilter}>
              <SelectTrigger className="h-8 text-xs w-44 gap-1">
                <RouteIcon className="w-3 h-3 shrink-0" />
                <SelectValue placeholder="All routes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All routes</SelectItem>
                {routeTemplates.map(rt => (
                  <SelectItem key={rt.id} value={String(rt.id)} className="text-xs">{rt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center rounded-md border p-1 bg-muted/50">
            <Button variant={view === 'week' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('week')} className="h-7 text-xs px-3">Week</Button>
            <Button variant={view === 'month' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('month')} className="h-7 text-xs px-3">Month</Button>
            <Button variant={view === 'series' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('series')} className="h-7 text-xs px-3 gap-1"><RefreshCw className="w-3 h-3" />Series</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevRange}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="min-w-[140px] text-center font-medium">
              {view === 'week' ? `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}` : format(currentDate, 'MMMM yyyy')}
            </div>
            <Button variant="outline" size="icon" onClick={nextRange}><ChevronRight className="w-4 h-4" /></Button>
          </div>
          <ImportExportControls
            entity="jobs"
            entityLabel="Jobs"
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListJobsQueryKey() })}
          />
          {canManageJobs && (
            <Button className="gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> New Job
            </Button>
          )}
        </div>
      </div>

      {/* Series View */}
      {view === 'series' && (
        <Card className="flex-1 overflow-y-auto">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-primary" /> Recurring Series</h2>
              <p className="text-xs text-muted-foreground mt-0.5">One row per active recurring schedule. Manage pause, skip, and cancel from here.</p>
            </div>
          </div>
          {!recurringSeries || recurringSeries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
              <RefreshCw className="w-8 h-8 opacity-30" />
              <p className="text-sm">No recurring series yet.</p>
              <p className="text-xs">Create a job and toggle "Make Recurring" to start a series.</p>
            </div>
          ) : (
            <div className="divide-y">
              {recurringSeries.map(s => {
                const sr = s as typeof s & { planId?: number | null; planName?: string | null };
                const isLinking = linkPlanSeriesId === s.id;
                return (
                <div key={s.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{s.title}</span>
                      {s.isRecurrencePaused && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">Paused</Badge>}
                      <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30 bg-primary/5">
                        <RefreshCw className="w-2.5 h-2.5" />{s.recurrenceDescription}
                      </Badge>
                      {s.planName && (
                        <Badge variant="outline" className="text-xs gap-1 text-violet-700 border-violet-300 bg-violet-50">
                          <ListEnd className="w-2.5 h-2.5" />{s.planName}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                      {s.customerName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{s.customerName}</span>}
                      {(s.crewName || s.assigneeName) && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s.crewName ?? s.assigneeName}</span>}
                      <span>{s.completedCount} occurrences generated</span>
                      {s.nextScheduledAt && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Next: {format(new Date(s.nextScheduledAt), 'MMM d, yyyy')}</span>}
                    </div>
                    {/* Plan-link picker (inline) */}
                    {isLinking && (
                      <div className="flex items-center gap-2 mt-2">
                        <Select
                          value={linkPlanValue}
                          onValueChange={setLinkPlanValue}
                        >
                          <SelectTrigger className="h-7 text-xs w-64">
                            <SelectValue placeholder="Select a service plan…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none" className="text-xs text-muted-foreground">— No plan (unlink) —</SelectItem>
                            {(allCustomerPlans ?? []).map(p => (
                              <SelectItem key={p.id} value={String(p.id)} className="text-xs">
                                {p.templateName}{p.customerName ? ` · ${p.customerName}` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm" variant="default" className="h-7 text-xs"
                          disabled={updateJob.isPending}
                          onClick={() => {
                            const newPlanId = linkPlanValue === 'none' || !linkPlanValue ? null : parseInt(linkPlanValue, 10);
                            updateJob.mutate(
                              { id: s.id, data: { planId: newPlanId } as Parameters<typeof updateJob.mutate>[0]['data'] },
                              {
                                onSuccess: () => {
                                  toast.success(newPlanId ? 'Plan linked to series' : 'Plan unlinked from series');
                                  qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() });
                                  setLinkPlanSeriesId(null);
                                  setLinkPlanValue('');
                                },
                                onError: () => toast.error('Failed to update plan link'),
                              }
                            );
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => { setLinkPlanSeriesId(null); setLinkPlanValue(''); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs gap-1"
                      title={sr.planName ? `Linked to: ${sr.planName}` : 'Link to a service plan'}
                      onClick={() => {
                        setLinkPlanSeriesId(isLinking ? null : s.id);
                        setLinkPlanValue(sr.planId ? String(sr.planId) : '');
                      }}
                    >
                      <ClipboardList className="w-3 h-3" />
                      {sr.planName ? 'Plan' : 'Link Plan'}
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={skipNextOccurrence.isPending}
                      onClick={() => {
                        skipNextOccurrence.mutate({ id: s.id }, {
                          onSuccess: () => { toast.success('Next occurrence skipped'); qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() }); },
                          onError: () => toast.error('Failed to skip'),
                        });
                      }}
                    >
                      <SkipForward className="w-3 h-3" /> Skip
                    </Button>
                    <Button
                      size="sm" variant="outline" className={`h-7 text-xs gap-1 ${s.isRecurrencePaused ? 'text-emerald-600' : ''}`}
                      disabled={pauseSeries.isPending}
                      onClick={() => {
                        if (s.isRecurrencePaused) {
                          pauseSeries.mutate({ id: s.id, data: { paused: false } }, {
                            onSuccess: () => { toast.success('Series resumed'); qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() }); },
                            onError: () => toast.error('Failed to update'),
                          });
                        } else {
                          setPauseDialogRootId(s.id);
                        }
                      }}
                    >
                      {s.isRecurrencePaused ? <><Play className="w-3 h-3" /> Resume</> : <><Pause className="w-3 h-3" /> Pause</>}
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (!window.confirm('Cancel all future occurrences of this series?')) return;
                        cancelSeries.mutate({ id: s.id, params: { scope: 'forward' } }, {
                          onSuccess: () => { toast.success('Series cancelled'); qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() }); },
                          onError: () => toast.error('Failed to cancel'),
                        });
                      }}
                    >
                      <X className="w-3 h-3" /> Cancel
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Calendar */}
      {view !== 'series' && (
      <Card className="flex-1 flex flex-col min-h-[600px] overflow-hidden">
        <div className="grid grid-cols-7 border-b shrink-0 bg-muted/30">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="py-3 text-center text-sm font-semibold text-muted-foreground border-r last:border-r-0">{d}</div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">Loading schedule...</div>
          ) : (
            <div className={`grid grid-cols-7 h-full ${view === 'month' ? 'auto-rows-[minmax(120px,1fr)]' : 'auto-rows-[minmax(300px,1fr)]'}`}>
              {days.map(day => {
                const dayJobs = getJobsForDay(day);
                const dayEstimates = getEstimatesForDay(day);
                const dayVisits = getVisitsForDay(day);
                const isToday = isSameDay(day, new Date());
                const isOtherMonth = view === 'month' && day.getMonth() !== currentDate.getMonth();
                const totalCount = dayJobs.length + dayEstimates.length + dayVisits.length;
                return (
                  <div key={day.toISOString()} className={`border-r border-b p-2 flex flex-col ${isOtherMonth ? 'bg-muted/10' : ''}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                        {format(day, 'd')}
                      </span>
                      {totalCount > 0 && <span className="text-xs text-muted-foreground">{totalCount}</span>}
                    </div>
                    <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
                      {/* Jobs */}
                      {dayJobs.map(job => (
                        <div
                          key={`job-${job.id}`}
                          onClick={() => setSelectedJobId(job.id)}
                          className={`p-2 rounded border text-xs cursor-pointer hover:shadow-md hover:brightness-95 transition-all ${STATUS_COLORS[job.status] ?? STATUS_COLORS.scheduled}`}
                        >
                          <div className="font-semibold truncate">{job.title}</div>
                          {!isTechnician && (job.assigneeName || job.crewName) && (
                            <div className="mt-1 flex items-center gap-1 opacity-80">
                              {job.crewName ? <Users className="w-3 h-3" /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                              <span className="truncate">{job.crewName ?? job.assigneeName}</span>
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-1 opacity-80">
                            <Clock className="w-3 h-3" />
                            <span>{format(new Date(job.scheduledAt), 'h:mm a')}</span>
                          </div>
                          {job.customerName && <div className="mt-0.5 truncate opacity-80">{job.customerName}</div>}
                          {(job.recurrenceRule || job.recurrenceParentId) && (
                            <div className="mt-0.5 flex items-center gap-1 opacity-70">
                              <RefreshCw className="w-2.5 h-2.5" />
                              <span className="truncate text-[10px]">{(job as any).recurrenceDescription ?? 'Recurring'}</span>
                            </div>
                          )}
                          {(job as any).routeName && (
                            <div className="mt-0.5 flex items-center gap-1">
                              <RouteIcon className="w-2.5 h-2.5 opacity-70 shrink-0" />
                              <span className="truncate text-[10px] font-medium opacity-80">{(job as any).routeName}</span>
                            </div>
                          )}
                        </div>
                      ))}
                      {/* Estimates */}
                      {dayEstimates.map(est => (
                        <div
                          key={`est-${est.id}`}
                          className="p-2 rounded border text-xs cursor-pointer hover:shadow-md transition-all bg-violet-100 text-violet-800 border-violet-200"
                          onClick={() => setLocation('/estimates')}
                        >
                          <div className="font-semibold truncate flex items-center gap-1">
                            <span className="text-[9px] uppercase tracking-wide font-bold opacity-60">EST</span>
                            {est.customerName ?? `Estimate #${est.id}`}
                          </div>
                          {est.scheduledAt && (
                            <div className="mt-1 flex items-center gap-1 opacity-80">
                              <Clock className="w-3 h-3" />
                              <span>{format(new Date(est.scheduledAt), 'h:mm a')}</span>
                            </div>
                          )}
                        </div>
                      ))}
                      {/* Visits */}
                      {dayVisits.map(visit => (
                        <div
                          key={`visit-${visit.id}`}
                          className="p-2 rounded border text-xs cursor-pointer hover:shadow-md transition-all bg-teal-100 text-teal-800 border-teal-200"
                          onClick={() => setLocation('/visits')}
                        >
                          <div className="font-semibold truncate flex items-center gap-1">
                            <span className="text-[9px] uppercase tracking-wide font-bold opacity-60">VISIT</span>
                            {visit.purpose}
                          </div>
                          {visit.scheduledAt && (
                            <div className="mt-1 flex items-center gap-1 opacity-80">
                              <Clock className="w-3 h-3" />
                              <span>{format(new Date(visit.scheduledAt), 'h:mm a')}</span>
                            </div>
                          )}
                          {visit.customerName && <div className="mt-0.5 truncate opacity-80">{visit.customerName}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
      )}

      {/* Create Job Sheet */}
      <Sheet open={createOpen} onOpenChange={open => { if (!open) { setCreateOpen(false); setNewJob(EMPTY_JOB); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>New Job</SheetTitle>
            <SheetDescription>Schedule a new job or work order.</SheetDescription>
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
              <Button variant="outline" onClick={() => { setCreateOpen(false); setNewJob(EMPTY_JOB); }}>Cancel</Button>
              <Button onClick={handleCreateJob} disabled={createJob.isPending}>
                {createJob.isPending ? 'Creating...' : 'Create Job'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Job Detail Sheet */}
      <Sheet open={selectedJobId != null} onOpenChange={open => { if (!open) setSelectedJobId(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedJob ? (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <SheetTitle className="text-xl leading-tight">{selectedJob.title}</SheetTitle>
                    <SheetDescription className="mt-1">
                      Job #{selectedJob.id} · Created {format(new Date(selectedJob.createdAt), 'MMM d, yyyy')}
                    </SheetDescription>
                    {((selectedJob as any).recurrenceDescription || (selectedJob as any).recurrenceParentId) && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-primary">
                        <RefreshCw className="w-3 h-3" />
                        <span>{(selectedJob as any).recurrenceDescription ?? 'Recurring'}</span>
                        {(selectedJob as any).recurrenceIndex != null && (
                          <span className="text-muted-foreground">· Occurrence #{((selectedJob as any).recurrenceIndex ?? 0) + 1}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`capitalize ${STATUS_COLORS[selectedJob.status] ?? ''}`} variant="outline">
                      {selectedJob.status.replace('_', ' ')}
                    </Badge>
                    {canManageJobs && (
                      <button
                        title="Delete job"
                        className="text-muted-foreground/40 hover:text-destructive transition-colors"
                        onClick={() => {
                          if (!window.confirm('Permanently delete this job? This cannot be undone.')) return;
                          deleteJob.mutate({ id: selectedJob.id }, {
                            onSuccess: () => {
                              toast.success('Job deleted');
                              qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                              setSelectedJobId(null);
                            },
                            onError: (err: any) => {
                              const status = err?.response?.status;
                              const body = err?.response?.data;
                              if (status === 409 && body?.message) {
                                setDeleteBlockedMsg(body.message);
                              } else {
                                toast.error('Failed to delete job');
                              }
                            },
                          });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-5">
                {/* Recurrence actions */}
                {canManageJobs && ((selectedJob as any).recurrenceRule || (selectedJob as any).recurrenceParentId) && (
                  <div className="rounded-lg border p-3 bg-primary/5 border-primary/20 space-y-2">
                    <p className="text-xs font-medium text-primary flex items-center gap-1.5">
                      <RefreshCw className="w-3 h-3" /> Recurring Series
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={skipNextOccurrence.isPending}
                        onClick={() => {
                          const rootId = (selectedJob as any).recurrenceParentId ?? selectedJob.id;
                          skipNextOccurrence.mutate({ id: rootId }, {
                            onSuccess: () => { toast.success('Next occurrence skipped'); qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() }); },
                            onError: () => toast.error('Failed to skip'),
                          });
                        }}>
                        <SkipForward className="w-3 h-3" /> Skip Next
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={pauseSeries.isPending}
                        onClick={() => {
                          const rootId = (selectedJob as any).recurrenceParentId ?? selectedJob.id;
                          const isPaused = (selectedJob as any).isRecurrencePaused;
                          if (isPaused) {
                            pauseSeries.mutate({ id: rootId, data: { paused: false } }, {
                              onSuccess: () => {
                                toast.success('Series resumed');
                                qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId!) });
                                qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() });
                              },
                              onError: () => toast.error('Failed to update'),
                            });
                          } else {
                            setPauseDialogRootId(rootId);
                          }
                        }}>
                        {(selectedJob as any).isRecurrencePaused ? <><Play className="w-3 h-3" /> Resume Series</> : <><Pause className="w-3 h-3" /> Pause Series</>}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" disabled={cancelSeries.isPending}
                        onClick={() => {
                          if (!window.confirm('Cancel all future occurrences of this series?')) return;
                          const rootId = (selectedJob as any).recurrenceParentId ?? selectedJob.id;
                          cancelSeries.mutate({ id: rootId, params: { scope: 'forward' } }, {
                            onSuccess: () => {
                              toast.success('Series cancelled');
                              qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                              qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() });
                              setSelectedJobId(null);
                            },
                            onError: () => toast.error('Failed to cancel'),
                          });
                        }}>
                        <X className="w-3 h-3" /> Cancel Series
                      </Button>
                    </div>
                  </div>
                )}

                {/* Status change (non-tech) */}
                {canManageJobs && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Update Status</label>
                    <Select value={selectedJob.status} onValueChange={handleStatusChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Separator />

                {/* Details */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Scheduled</p>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span>{format(new Date(selectedJob.scheduledAt), 'MMM d, yyyy · h:mm a')}</span>
                    </div>
                  </div>
                  {selectedJob.estimatedDuration && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Duration</p>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span>{formatDuration(selectedJob.estimatedDuration)}</span>
                      </div>
                    </div>
                  )}
                  {selectedJob.customerName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customer</p>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedJob.customerName}</span>
                      </div>
                    </div>
                  )}
                  {selectedJob.assigneeName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Assigned To</p>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedJob.assigneeName}</span>
                      </div>
                    </div>
                  )}
                  {selectedJob.crewName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Crew</p>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedJob.crewName}</span>
                      </div>
                    </div>
                  )}
                  {selectedJob.propertyAddress && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Property</p>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span>{selectedJob.propertyAddress}</span>
                      </div>
                    </div>
                  )}
                  {selectedJob.priority && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Priority</p>
                      <Badge className={`capitalize ${PRIORITY_COLORS[selectedJob.priority] ?? ''}`} variant="outline">
                        {selectedJob.priority}
                      </Badge>
                    </div>
                  )}
                  {(selectedJob as any).planId && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Service Plan</p>
                      <div className="flex items-center gap-2 text-sm">
                        <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span>{(selectedJob as any).planName ?? `Plan #${(selectedJob as any).planId}`}</span>
                      </div>
                    </div>
                  )}
                  {/* Route assignment */}
                  <div className="col-span-2 space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Route</p>
                    {assignedRoute ? (
                      <div className="flex items-center gap-2 text-sm">
                        <RouteIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium">{assignedRoute.name}</span>
                        {assignedRoute.divisionName && (
                          <span className="text-xs text-muted-foreground">· {assignedRoute.divisionName}</span>
                        )}
                        <button
                          title="Open route day detail"
                          className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={() => {
                            const dateStr = selectedJob.scheduledAt.slice(0, 10);
                            setLocation(`/routes?routeTemplateId=${assignedRoute.id}&date=${dateStr}`);
                            setSelectedJobId(null);
                          }}
                        >
                          <ExternalLink className="w-3 h-3" /> View in Routes
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RouteIcon className="w-4 h-4 shrink-0" />
                        <span>Not assigned to a route</span>
                      </div>
                    )}
                    {canManageJobs && routeTemplates && routeTemplates.length > 0 && (
                      <div className="pt-1">
                        <Select
                          value={String((selectedJob as any).routeTemplateId ?? '')}
                          onValueChange={val => {
                            if (!selectedJobId) return;
                            const newRouteId = val === 'none' ? null : Number(val);
                            updateJobRoute.mutate(
                              { id: selectedJobId, data: { routeTemplateId: newRouteId, scheduledAt: selectedJob.scheduledAt } },
                              {
                                onSuccess: () => {
                                  toast.success(newRouteId ? 'Route assigned' : 'Removed from route');
                                  qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                                  qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                                },
                                onError: () => toast.error('Failed to update route'),
                              }
                            );
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Assign to route…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— No route —</SelectItem>
                            {routeTemplates.map(rt => (
                              <SelectItem key={rt.id} value={String(rt.id)}>
                                {rt.name}{rt.divisionName ? ` (${rt.divisionName})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  {selectedJob.totalAmount != null && selectedJob.totalAmount > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total</p>
                      <div className="flex items-center gap-2 font-semibold">
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                        <span>${selectedJob.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )}
                </div>

                {selectedJob.description && (
                  <>
                    <Separator />
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Description</p>
                      <p className="text-sm">{selectedJob.description}</p>
                    </div>
                  </>
                )}

                {/* Clock in / out */}
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5" /> Time on Job
                  </p>
                  {activeJobTimer ? (
                    <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-amber-800 tabular-nums">
                          {Math.floor(liveJobSeconds / 3600)}h {String(Math.floor((liveJobSeconds % 3600) / 60)).padStart(2, '0')}m {String(liveJobSeconds % 60).padStart(2, '0')}s
                        </p>
                        <p className="text-xs text-amber-600">Clocked in</p>
                      </div>
                      <Button
                        size="sm" variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-100 gap-1.5 h-8"
                        disabled={stopSubTimer.isPending}
                        onClick={() => stopSubTimer.mutate({ id: activeJobTimer.id }, {
                          onSuccess: () => { qc.invalidateQueries({ queryKey: getListSubTimersQueryKey() }); setClockOutJobId(selectedJobId); },
                          onError: () => toast.error('Failed to clock out'),
                        })}
                      >
                        <Square className="w-3 h-3 fill-amber-700" /> Clock Out
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm" variant="outline" className="gap-1.5"
                      disabled={startSubTimer.isPending}
                      onClick={() => startSubTimer.mutate({ data: { label: (selectedJob as any)?.title ?? `Job #${selectedJobId}`, type: 'job', jobId: selectedJobId! } }, {
                        onSuccess: () => { toast.success('Clocked in'); qc.invalidateQueries({ queryKey: getListSubTimersQueryKey() }); },
                        onError: () => toast.error('Failed to clock in'),
                      })}
                    >
                      <Play className="w-3.5 h-3.5" /> Clock In to Job
                    </Button>
                  )}
                </div>

                {/* Parts used on job */}
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                      <ClipboardList className="w-3.5 h-3.5" /> Parts Used
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => { setAddingPart(true); setPartsSearch(''); setPartQty('1'); }}
                    >
                      <Plus className="w-3 h-3" /> Add Part
                    </Button>
                  </div>

                  {/* Add part form */}
                  {addingPart && (
                    <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                          className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                          placeholder="Search inventory..."
                          value={partsSearch}
                          onChange={e => setPartsSearch(e.target.value)}
                          autoFocus
                        />
                      </div>
                      {inventoryItems && inventoryItems.length > 0 && (
                        <div className="rounded-md border divide-y text-sm max-h-48 overflow-y-auto">
                          {inventoryItems.slice(0, 8).map(item => (
                            <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{item.name}</div>
                                <div className="text-xs text-muted-foreground">${item.unitPrice.toFixed(2)}/{item.unit} · {item.quantity} in stock</div>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  className="w-14 text-xs border rounded px-1.5 py-1 text-right"
                                  value={partQty}
                                  onChange={e => setPartQty(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                />
                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  disabled={addJobPart.isPending}
                                  onClick={() => {
                                    if (!selectedJobId) return;
                                    const qty = parseInt(partQty, 10);
                                    if (isNaN(qty) || qty <= 0) { toast.error('Enter a valid quantity'); return; }
                                    addJobPart.mutate(
                                      { id: selectedJobId, data: { inventoryItemId: item.id, quantity: qty } },
                                      {
                                        onSuccess: () => {
                                          toast.success(`${item.name} added`);
                                          qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                                          setAddingPart(false);
                                          setPartsSearch('');
                                        },
                                        onError: () => toast.error('Failed to add part'),
                                      }
                                    );
                                  }}
                                >Add</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {partsSearch && inventoryItems?.length === 0 && (
                        <p className="text-xs text-muted-foreground px-1">No items found for "{partsSearch}"</p>
                      )}
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAddingPart(false)}>Cancel</Button>
                    </div>
                  )}

                  {/* Parts list */}
                  {Array.isArray(selectedJob.jobParts) && selectedJob.jobParts.length > 0 ? (
                    <div className="rounded-lg border divide-y text-sm">
                      {(selectedJob.jobParts as { inventoryItemId: number; name: string; quantity: number; unitPrice: number; total: number }[]).map((part, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block">{part.name}</span>
                            <span className="text-xs text-muted-foreground">{part.quantity} × ${part.unitPrice.toFixed(2)}</span>
                            <PartLocationBadges inventoryItemId={part.inventoryItemId} />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">${part.total.toFixed(2)}</span>
                            <button
                              className="text-muted-foreground/40 hover:text-destructive transition-colors"
                              onClick={() => {
                                if (!selectedJobId) return;
                                removeJobPart.mutate(
                                  { id: selectedJobId, inventoryItemId: part.inventoryItemId },
                                  {
                                    onSuccess: () => {
                                      toast.success('Part removed');
                                      qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                                    },
                                    onError: () => toast.error('Failed to remove part'),
                                  }
                                );
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between px-3 py-2 bg-muted/30 text-sm font-semibold">
                        <span>Parts Total</span>
                        <span>${(selectedJob.jobParts as { total: number }[]).reduce((s, p) => s + p.total, 0).toFixed(2)}</span>
                      </div>
                    </div>
                  ) : !addingPart && (
                    <p className="text-sm text-muted-foreground py-1">No parts logged yet.</p>
                  )}
                </div>

                {/* Irrigation Repairs */}
                {(selectedJob as any).propertyId && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                          <Wrench className="w-3.5 h-3.5" /> Irrigation Repairs
                        </p>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setSchedRepairForm(EMPTY_SCHED_REPAIR); setRepairFormOpen(true); }}>
                          <Plus className="w-3 h-3" /> Log Repair
                        </Button>
                      </div>
                      {jobRepairLogs && jobRepairLogs.length > 0 ? (
                        <div className="rounded-lg border divide-y text-sm">
                          {jobRepairLogs.map(r => (
                            <div key={r.id} className="px-3 py-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <Badge variant="outline" className="capitalize text-xs mr-2">{r.componentType}</Badge>
                                  <span className="font-medium">{r.replacedWithName ?? r.replacedWhat ?? 'Repair'}</span>
                                </div>
                                <span className="font-semibold text-xs">${r.totalCost.toFixed(2)}</span>
                              </div>
                              {r.replacedWhat && <p className="text-xs text-muted-foreground mt-0.5">Replaced: {r.replacedWhat}</p>}
                              {r.notes && <p className="text-xs text-muted-foreground mt-0.5">{r.notes}</p>}
                              <p className="text-xs text-muted-foreground mt-1">{new Date(r.performedAt).toLocaleDateString()}{r.performedByName ? ` · ${r.performedByName}` : ''}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground py-1">No repairs logged on this job.</p>
                      )}
                    </div>
                  </>
                )}

                {/* Chemical Applications */}
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                      <FlaskConical className="w-3.5 h-3.5" /> Chemical Applications
                    </p>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setChemFormOpen(true)}>
                      <Plus className="w-3 h-3" /> Log Application
                    </Button>
                  </div>
                  {chemApps && chemApps.length > 0 ? (
                    <div className="rounded-lg border divide-y text-sm">
                      {chemApps.map(app => (
                        <div key={app.id} className="px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium">{app.mixtureName ?? app.productName ?? 'Unknown'}</span>
                              <span className="text-xs text-muted-foreground ml-2">{app.volumeApplied} {app.volumeUnit}</span>
                            </div>
                            {canManageJobs && (
                              <button onClick={() => {
                                deleteChemApp.mutate({ id: app.id }, {
                                  onSuccess: () => { refetchChemApps(); toast.success('Application removed'); },
                                });
                              }} className="text-muted-foreground/40 hover:text-destructive transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {(app.breakdown as unknown[]).length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {(app.breakdown as Array<{ productName?: string | null; amountApplied: number; unit: string; activeIngredients?: string | null }>).map((b, i) => (
                                <p key={i} className="text-xs text-muted-foreground">
                                  {b.productName}: {b.amountApplied?.toFixed(2)} {b.unit}
                                  {b.activeIngredients ? ` · ${b.activeIngredients}` : ''}
                                </p>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(app.appliedAt), 'MMM d · h:mm a')}
                            {app.applicatorName ? ` · ${app.applicatorName}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-2">No applications logged yet.</p>
                  )}
                </div>

                {/* Reminders */}
                {(() => {
                  const rem = (selectedJob as any).remindersSent as { sent7d?: boolean; sent24h?: boolean; sentAt7d?: string | null; sentAt24h?: string | null } | null;
                  return (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                            <Bell className="w-3.5 h-3.5" /> Reminders
                          </p>
                          {canManageJobs && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              disabled={sendReminder.isPending}
                              onClick={() => {
                                if (!selectedJobId) return;
                                sendReminder.mutate(
                                  { id: selectedJobId, data: { channel: 'both' } },
                                  {
                                    onSuccess: () => {
                                      toast.success('Reminder sent');
                                      qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                                    },
                                    onError: () => toast.error('Failed to send reminder'),
                                  }
                                );
                              }}
                            >
                              <Send className="w-3 h-3" /> Send Now
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className={`rounded-lg border p-2.5 flex items-center gap-2 text-xs ${rem?.sent7d ? 'border-emerald-200 bg-emerald-50' : 'bg-muted/30'}`}>
                            {rem?.sent7d ? (
                              <Bell className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <BellOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            )}
                            <div>
                              <p className={`font-medium ${rem?.sent7d ? 'text-emerald-700' : 'text-muted-foreground'}`}>7-day reminder</p>
                              <p className="text-muted-foreground">
                                {rem?.sent7d ? `Sent ${rem.sentAt7d ? new Date(rem.sentAt7d).toLocaleDateString() : ''}` : '⏳ Queued'}
                              </p>
                            </div>
                          </div>
                          <div className={`rounded-lg border p-2.5 flex items-center gap-2 text-xs ${rem?.sent24h ? 'border-emerald-200 bg-emerald-50' : 'bg-muted/30'}`}>
                            {rem?.sent24h ? (
                              <Bell className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <BellOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            )}
                            <div>
                              <p className={`font-medium ${rem?.sent24h ? 'text-emerald-700' : 'text-muted-foreground'}`}>24-hr reminder</p>
                              <p className="text-muted-foreground">
                                {rem?.sent24h ? `Sent ${rem.sentAt24h ? new Date(rem.sentAt24h).toLocaleDateString() : ''}` : '⏳ Queued'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Customer Alerts */}
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Customer Alerts
                    </p>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAlertPanelOpen(v => !v)}>
                      <Plus className="w-3 h-3" /> Log Alert
                    </Button>
                  </div>
                  {alertPanelOpen && (
                    <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                      <Select value={alertForm.type} onValueChange={v => setAlertForm(f => ({ ...f, type: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="issue">Issue found on site</SelectItem>
                          <SelectItem value="upsell">Recommended service</SelectItem>
                        </SelectContent>
                      </Select>
                      <Textarea
                        rows={2}
                        className="text-sm resize-none"
                        placeholder="Describe the issue or recommendation..."
                        value={alertForm.message}
                        onChange={e => setAlertForm(f => ({ ...f, message: e.target.value }))}
                      />
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAlertPanelOpen(false)}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs" disabled={!alertForm.message.trim() || createAlert.isPending} onClick={() => {
                          if (!selectedJobId || !alertForm.message.trim()) return;
                          createAlert.mutate(
                            { id: selectedJobId, data: { type: alertForm.type as 'issue' | 'upsell', message: alertForm.message } },
                            {
                              onSuccess: () => {
                                toast.success('Alert logged');
                                refetchAlerts();
                                setAlertPanelOpen(false);
                                setAlertForm({ type: 'issue', message: '' });
                              },
                              onError: () => toast.error('Failed to log alert'),
                            },
                          );
                        }}>Log Alert</Button>
                      </div>
                    </div>
                  )}
                  {jobAlerts && jobAlerts.length > 0 ? (
                    <div className="rounded-lg border divide-y text-sm">
                      {jobAlerts.map(alert => (
                        <div key={alert.id} className="px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${alert.type === 'issue' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                              {alert.type === 'issue' ? 'Issue' : 'Upsell'}
                            </span>
                            <span className={`text-xs ${alert.status === 'accepted' ? 'text-emerald-600' : alert.status === 'declined' ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {alert.status}
                            </span>
                          </div>
                          <p className="mt-1 text-sm">{alert.message}</p>
                          {alert.customerResponse && (
                            <p className="mt-0.5 text-xs text-muted-foreground italic">"{alert.customerResponse}"</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-1">No alerts logged yet.</p>
                  )}
                </div>

                {/* Line Items */}
                {selectedJob.lineItems && selectedJob.lineItems.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                        <ClipboardList className="w-3.5 h-3.5" /> Line Items
                      </p>
                      <div className="rounded-lg border divide-y text-sm">
                        {selectedJob.lineItems.map(li => (
                          <div key={li.id} className="flex items-center justify-between px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium truncate block">{li.name}</span>
                              <span className="text-xs text-muted-foreground">{li.quantity} × ${li.unitPrice.toFixed(2)}</span>
                            </div>
                            <span className="font-semibold ml-4">${li.total.toFixed(2)}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between px-3 py-2 font-semibold bg-muted/30">
                          <span>Total</span>
                          <span>${selectedJob.totalAmount?.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {/* Job Media */}
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                    <Images className="w-3.5 h-3.5" /> Photos & Videos
                  </p>
                  <MediaGallery
                    entityType="job"
                    entityId={selectedJobId!}
                    media={jobMedia ?? []}
                    onMediaAdded={() => refetchJobMedia()}
                    onMediaDeleted={() => refetchJobMedia()}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading...</div>
          )}
        </SheetContent>
      </Sheet>

      {/* Chemical Application Log Sheet */}
      <Sheet open={chemFormOpen} onOpenChange={open => { if (!open) { setChemFormOpen(false); setChemForm({ mixtureId: '', productId: '', volumeApplied: '', volumeUnit: 'gal', targetPest: '', applicationMethod: '', windSpeed: '', windDirection: '', temperature: '', applicatorLicenseNumber: '', notes: '', appliedAt: '' }); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Log Chemical Application</SheetTitle>
            <SheetDescription>Record a pesticide or fertilizer application for compliance.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            {/* Mixture or Product */}
            {(chemMixtures?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tank Mix (Mixture)</label>
                <Select value={chemForm.mixtureId} onValueChange={v => setChemForm(f => ({ ...f, mixtureId: v, productId: '' }))}>
                  <SelectTrigger><SelectValue placeholder="Select mixture…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {(chemMixtures ?? []).filter(m => m.isActive).map(m => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!chemForm.mixtureId || chemForm.mixtureId === 'none' ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Raw Product</label>
                <Select value={chemForm.productId} onValueChange={v => setChemForm(f => ({ ...f, productId: v, mixtureId: '' }))}>
                  <SelectTrigger><SelectValue placeholder="Select product…" /></SelectTrigger>
                  <SelectContent>
                    {(chemProducts ?? []).filter(p => p.isActive).map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Volume Applied <span className="text-destructive">*</span></label>
                <Input type="number" min={0} step={0.01} placeholder="e.g. 2.5" value={chemForm.volumeApplied} onChange={e => setChemForm(f => ({ ...f, volumeApplied: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Unit</label>
                <Select value={chemForm.volumeUnit} onValueChange={v => setChemForm(f => ({ ...f, volumeUnit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gal">Gallons</SelectItem>
                    <SelectItem value="oz">Oz</SelectItem>
                    <SelectItem value="fl oz">Fl Oz</SelectItem>
                    <SelectItem value="lb">Lbs</SelectItem>
                    <SelectItem value="l">Liters</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Applied At</label>
              <Input type="datetime-local" value={chemForm.appliedAt} onChange={e => setChemForm(f => ({ ...f, appliedAt: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Target Pest</label>
                <Input placeholder="e.g. Broadleaf weeds" value={chemForm.targetPest} onChange={e => setChemForm(f => ({ ...f, targetPest: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Method</label>
                <Select value={chemForm.applicationMethod} onValueChange={v => setChemForm(f => ({ ...f, applicationMethod: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spray">Spray</SelectItem>
                    <SelectItem value="granular">Granular</SelectItem>
                    <SelectItem value="drench">Drench</SelectItem>
                    <SelectItem value="inject">Inject</SelectItem>
                    <SelectItem value="bait">Bait</SelectItem>
                    <SelectItem value="fumigation">Fumigation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Wind (mph)</label>
                <Input type="number" min={0} step={0.5} placeholder="5" value={chemForm.windSpeed} onChange={e => setChemForm(f => ({ ...f, windSpeed: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Direction</label>
                <Select value={chemForm.windDirection} onValueChange={v => setChemForm(f => ({ ...f, windDirection: v }))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Temp (°F)</label>
                <Input type="number" placeholder="72" value={chemForm.temperature} onChange={e => setChemForm(f => ({ ...f, temperature: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Applicator License #</label>
              <Input placeholder="License number" value={chemForm.applicatorLicenseNumber} onChange={e => setChemForm(f => ({ ...f, applicatorLicenseNumber: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea placeholder="Additional notes…" rows={2} value={chemForm.notes} onChange={e => setChemForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setChemFormOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!chemForm.volumeApplied || (!chemForm.mixtureId && !chemForm.productId) || chemForm.mixtureId === 'none' && !chemForm.productId) {
                    toast.error('Volume and a mixture or product are required');
                    return;
                  }
                  createChemApp.mutate({
                    id: selectedJobId!,
                    data: {
                      mixtureId: chemForm.mixtureId && chemForm.mixtureId !== 'none' ? parseInt(chemForm.mixtureId, 10) : undefined,
                      productId: chemForm.productId ? parseInt(chemForm.productId, 10) : undefined,
                      volumeApplied: parseFloat(chemForm.volumeApplied),
                      volumeUnit: chemForm.volumeUnit,
                      targetPest: chemForm.targetPest || undefined,
                      applicationMethod: chemForm.applicationMethod || undefined,
                      windSpeed: chemForm.windSpeed ? parseFloat(chemForm.windSpeed) : undefined,
                      windDirection: chemForm.windDirection || undefined,
                      temperature: chemForm.temperature ? parseFloat(chemForm.temperature) : undefined,
                      appliedAt: chemForm.appliedAt ? new Date(chemForm.appliedAt).toISOString() : undefined,
                      applicatorLicenseNumber: chemForm.applicatorLicenseNumber || undefined,
                      notes: chemForm.notes || undefined,
                    },
                  }, {
                    onSuccess: () => {
                      toast.success('Application logged');
                      setChemFormOpen(false);
                      setChemForm({ mixtureId: '', productId: '', volumeApplied: '', volumeUnit: 'gal', targetPest: '', applicationMethod: '', windSpeed: '', windDirection: '', temperature: '', applicatorLicenseNumber: '', notes: '', appliedAt: '' });
                      qc.invalidateQueries({ queryKey: getListJobChemicalApplicationsQueryKey(selectedJobId!) });
                    },
                    onError: () => toast.error('Failed to log application'),
                  });
                }}
                disabled={createChemApp.isPending}
              >
                {createChemApp.isPending ? 'Saving…' : 'Log Application'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Log Repair Dialog (from job sheet) ── */}
      <Dialog open={repairFormOpen} onOpenChange={setRepairFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wrench className="w-4 h-4" /> Log Irrigation Repair</DialogTitle>
            <DialogDescription>Record a repair made on this job's property.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Component Type</label>
              <Select value={schedRepairForm.componentType} onValueChange={v => setSchedRepairForm(f => ({ ...f, componentType: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sprinkler">Sprinkler Head</SelectItem>
                  <SelectItem value="valve">Valve / Valve Box</SelectItem>
                  <SelectItem value="controller">Controller</SelectItem>
                  <SelectItem value="pipe">Pipe / Lateral Line</SelectItem>
                  <SelectItem value="fitting">Fitting / Coupler</SelectItem>
                  <SelectItem value="backflow">Backflow Preventer</SelectItem>
                  <SelectItem value="wiring">Wiring</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">What was repaired / replaced?</label>
              <Input className="h-9" placeholder="e.g. Broken rotor head, leaking valve" value={schedRepairForm.replacedWhat} onChange={e => setSchedRepairForm(f => ({ ...f, replacedWhat: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Replaced with (name / model)</label>
              <Input className="h-9" placeholder="e.g. Hunter PGP Ultra" value={schedRepairForm.replacedWithName} onChange={e => setSchedRepairForm(f => ({ ...f, replacedWithName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Parts Cost ($)</label>
                <Input type="number" step="0.01" min="0" className="h-9" placeholder="0.00" value={schedRepairForm.partsCost} onChange={e => setSchedRepairForm(f => ({ ...f, partsCost: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Labor Cost ($)</label>
                <Input type="number" step="0.01" min="0" className="h-9" placeholder="0.00" value={schedRepairForm.laborCost} onChange={e => setSchedRepairForm(f => ({ ...f, laborCost: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={2} placeholder="Additional notes…" value={schedRepairForm.notes} onChange={e => setSchedRepairForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRepairFormOpen(false)}>Cancel</Button>
            <Button disabled={createRepairLog.isPending} onClick={() => {
              if (!selectedJobId || !(selectedJob as any).propertyId) return;
              createRepairLog.mutate({
                data: {
                  propertyId: (selectedJob as any).propertyId as number,
                  jobId: selectedJobId,
                  componentType: schedRepairForm.componentType,
                  replacedWhat: schedRepairForm.replacedWhat || undefined,
                  replacedWithName: schedRepairForm.replacedWithName || undefined,
                  partsCost: Number(schedRepairForm.partsCost) || 0,
                  laborCost: Number(schedRepairForm.laborCost) || 0,
                  notes: schedRepairForm.notes || undefined,
                  performedAt: new Date().toISOString(),
                },
              }, {
                onSuccess: () => {
                  toast.success('Repair logged');
                  setRepairFormOpen(false);
                  setSchedRepairForm(EMPTY_SCHED_REPAIR);
                  qc.invalidateQueries({ queryKey: getListRepairLogsQueryKey({ jobId: selectedJobId! } as Parameters<typeof useListRepairLogs>[0]) });
                },
                onError: () => toast.error('Failed to log repair'),
              });
            }}>
              {createRepairLog.isPending ? 'Saving…' : 'Log Repair'}
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
                  qc.invalidateQueries({ queryKey: getGetJobQueryKey(clockOutJobId) });
                  qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
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

      <Dialog open={pauseDialogRootId !== null} onOpenChange={(open) => { if (!open) { setPauseDialogRootId(null); setPauseResumeAt(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause Recurring Series</DialogTitle>
            <DialogDescription>Optionally set a date to auto-resume, e.g. for an off-season pause. Leave blank to pause indefinitely until resumed manually.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Auto-resume date (optional)</label>
            <Input type="date" value={pauseResumeAt} onChange={(e) => setPauseResumeAt(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setPauseDialogRootId(null); setPauseResumeAt(''); }}>Cancel</Button>
            <Button onClick={() => confirmPause(pauseDialogRootId!)} disabled={pauseSeries.isPending}>
              {pauseSeries.isPending ? 'Pausing…' : 'Pause Series'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Chemical application compliance block */}
      <Dialog open={deleteBlockedMsg !== null} onOpenChange={(open) => { if (!open) setDeleteBlockedMsg(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Cannot Delete Job
            </DialogTitle>
            <DialogDescription>{deleteBlockedMsg}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end pt-2">
            <Button onClick={() => setDeleteBlockedMsg(null)}>OK</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
