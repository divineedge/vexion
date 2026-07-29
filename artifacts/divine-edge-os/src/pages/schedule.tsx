import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
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
  useListCrews, getListCrewsQueryKey,
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
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Clock, MapPin, User, Calendar,
  DollarSign, ClipboardList, Plus, Users, FlaskConical, Trash2, AlertTriangle,
  Bell, BellOff, Send, Package, Search, Images, RefreshCw, Pause, Play, X,
  SkipForward, ListEnd, Wrench, Square, Timer, Warehouse, Truck,
  Route as RouteIcon, ExternalLink, PhoneCall, CheckCircle, FileText, Phone, Mail, Copy,
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

function JobDescriptionEditor({ jobId, initialDescription, canEdit }: { jobId: number; initialDescription: string; canEdit: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(initialDescription);
  const updateJob = useUpdateJob();

  React.useEffect(() => { setValue(initialDescription); }, [initialDescription]);

  if (!canEdit) {
    return initialDescription ? (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Description</p>
        <p className="text-sm" title={initialDescription}>{initialDescription}</p>
      </div>
    ) : null;
  }

  if (!editing) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Description</p>
          <div className="flex items-center gap-2">
            {initialDescription && (
              <button
                title="Copy to clipboard"
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { navigator.clipboard.writeText(initialDescription); toast.success('Copied'); }}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
            <button title={initialDescription ? 'Edit job description' : 'Add a description to this job'} onClick={() => setEditing(true)} className="text-xs text-primary hover:underline">
              {initialDescription ? 'Edit' : '+ Add'}
            </button>
          </div>
        </div>
        {initialDescription && <p className="text-sm">{initialDescription}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Description</p>
      <Textarea
        title="Job description — visible to staff on this job"
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={3}
        placeholder="Add a description for this job…"
        className="text-sm"
        autoFocus
        maxLength={2000}
      />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] text-muted-foreground ${value.length > 1800 ? 'text-amber-500' : ''}`}>{value.length}/2000</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" title="Save the job description" className="h-7 text-xs gap-1" disabled={updateJob.isPending}
            onClick={() => {
              updateJob.mutate(
                { id: jobId, data: { description: value || undefined } as Parameters<typeof updateJob.mutate>[0]['data'] },
                {
                  onSuccess: () => { setEditing(false); toast.success('Description saved'); },
                  onError: () => toast.error('Failed to save description'),
                },
              );
            }}
          >
            {updateJob.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" title="Discard description changes" className="h-7 text-xs" onClick={() => { setValue(initialDescription); setEditing(false); }}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const { user, isTechnician, canManageJobs } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'week' | 'month' | 'series'>('week');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newJob, setNewJob] = useState<NewJobForm>(EMPTY_JOB);

  // Open create sheet when arriving via quick-add shortcut (?action=create) or prefill from property detail
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const addressParam = params.get('address');
    const jobIdParam = params.get('jobId');
    if (addressParam) {
      setPropertyFilter(decodeURIComponent(addressParam));
    }
    if (jobIdParam) {
      const parsed = parseInt(jobIdParam, 10);
      if (!isNaN(parsed)) setSelectedJobId(parsed);
    }
    const customerIdParam = params.get('customerId');
    const propertyIdParam = params.get('propertyId');
    if (params.get('action') === 'create') {
      setCreateOpen(true);
      if (customerIdParam) setNewJob(j => ({ ...j, customerId: customerIdParam }));
      if (propertyIdParam) setNewJob(j => ({ ...j, propertyId: propertyIdParam }));
    }
    if (addressParam || jobIdParam || params.get('action')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [alertForm, setAlertForm] = useState({ type: 'issue', priority: 'normal', message: '' });
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  // Reset inline title editor when the selected job changes
  React.useEffect(() => { setEditingTitle(false); }, [selectedJobId]);

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
    treatedArea: '', areaUnit: 'sqft',
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
  // Property address filter (client-side)
  const [propertyFilter, setPropertyFilter] = useState<string>('');
  const [jobSearch, setJobSearch] = useState('');
  // Priority filter (client-side)
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

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
    query: { enabled: createOpen || chemFormOpen, queryKey: getListUsersQueryKey() },
  });

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const durationUnit = settings?.durationUnit ?? 'minutes';

  const updateJob = useUpdateJob();
  const createJob = useCreateJob();

  const { data: chemApps, refetch: refetchChemApps } = useListJobChemicalApplications(selectedJobId!, {
    query: { enabled: selectedJobId != null, queryKey: getListJobChemicalApplicationsQueryKey(selectedJobId ?? 0) },
  });
  const { data: jobCallbacks } = useQuery<{ id: number; reason: string | null; status: string; assigneeName: string | null }[]>({
    queryKey: ['job-callbacks', selectedJobId],
    queryFn: () => customFetch(`/api/callbacks?jobId=${selectedJobId}`),
    enabled: selectedJobId != null,
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
  const [cancelSeriesDialogId, setCancelSeriesDialogId] = useState<number | null>(null);
  const [skipNextDialogId, setSkipNextDialogId] = useState<number | null>(null);
  const [deleteJobPending, setDeleteJobPending] = useState(false);
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
  const [holdFilter, setHoldFilter] = useState(false);
  const [overdueFilter, setOverdueFilter] = useState(false);
  const [myJobsFilter, setMyJobsFilter] = useState(false);
  const propertyFilterLower = propertyFilter.trim().toLowerCase();
  const [unassignedFilter, setUnassignedFilter] = useState(false);
  const [noRouteFilter, setNoRouteFilter] = useState(false);
  const [crewFilter, setCrewFilter] = useState<string>('all');
  const { data: crews = [] } = useListCrews({ query: { queryKey: getListCrewsQueryKey() } });
  const jobSearchLower = jobSearch.toLowerCase();
  const filteredJobs = (jobs ?? [])
    .filter(j => !propertyFilterLower || ((j as any).propertyAddress ?? '').toLowerCase().includes(propertyFilterLower))
    .filter(j => !jobSearch || j.title.toLowerCase().includes(jobSearchLower) || (j.customerName ?? '').toLowerCase().includes(jobSearchLower))
    .filter(j => !holdFilter || (j as any).holdFromBilling)
    .filter(j => !myJobsFilter || j.assigneeId === (user as any)?.id)
    .filter(j => !unassignedFilter || !j.assigneeId)
    .filter(j => crewFilter === 'all' || (j as any).crewName === crewFilter)
    .filter(j => priorityFilter === 'all' || (j as any).priority === priorityFilter)
    .filter(j => statusFilter === 'all' || j.status === statusFilter)
    .filter(j => !overdueFilter || (j.status !== 'completed' && j.status !== 'cancelled' && new Date(j.scheduledAt) < new Date()))
    .filter(j => !noRouteFilter || !(j as any).routeTemplateId);
  const getJobsForDay = (date: Date) => filteredJobs.filter(j => isSameDay(new Date(j.scheduledAt), date)).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const getEstimatesForDay = (date: Date) =>
    (estimates ?? []).filter(e => e.scheduledAt && isSameDay(new Date(e.scheduledAt), date));
  const getVisitsForDay = (date: Date) =>
    (visits ?? []).filter(v => v.scheduledAt && isSameDay(new Date(v.scheduledAt), date));

  const nextRange = () => setCurrentDate(p => view === 'week' ? addWeeks(p, 1) : addMonths(p, 1));
  const prevRange = () => setCurrentDate(p => view === 'week' ? subWeeks(p, 1) : subMonths(p, 1));

  const handleStatusChange = (status: string) => {
    if (!selectedJobId) return;
    if (status === 'completed' && !window.confirm('Mark this job as Completed?')) return;
    if (status === 'cancelled' && !window.confirm('Cancel this job? This cannot be undone.')) return;
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
          <p className="text-muted-foreground mt-1">
            {view === 'week'
              ? `Week of ${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'MMMM d, yyyy')}`
              : view === 'month'
              ? format(currentDate, 'MMMM yyyy')
              : 'Manage field assignments and dispatches.'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Job title / customer search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <Input
              value={jobSearch}
              onChange={e => setJobSearch(e.target.value)}
              placeholder="Search jobs…"
              title="Search by job title, customer, or property"
              className="h-8 text-xs pl-7 w-36"
            />
            {jobSearch && <button onClick={() => setJobSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
          </div>
          {/* Property address filter */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <Input
              value={propertyFilter}
              onChange={e => setPropertyFilter(e.target.value)}
              placeholder="Filter by property…"
              title="Filter jobs by property address"
              className="h-8 text-xs pl-7 w-44"
            />
            {propertyFilter && <button onClick={() => setPropertyFilter('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
          </div>
          {routeTemplates && routeTemplates.length > 0 && (
            <Select value={routeFilter} onValueChange={setRouteFilter}>
              <SelectTrigger className="h-8 text-xs w-44 gap-1" title="Filter by route template">
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
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-8 text-xs w-36 gap-1" title="Filter by job priority">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Priorities</SelectItem>
              <SelectItem value="urgent" className="text-xs">🔴 Urgent</SelectItem>
              <SelectItem value="high" className="text-xs">🟠 High</SelectItem>
              <SelectItem value="normal" className="text-xs">🟢 Normal</SelectItem>
              <SelectItem value="low" className="text-xs">⚪ Low</SelectItem>
            </SelectContent>
          </Select>
          {!isTechnician && (
            <Button
              variant={myJobsFilter ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs px-3 gap-1.5"
              onClick={() => setMyJobsFilter(v => !v)}
              title="Show only jobs assigned to me"
            >
              <User className="w-3 h-3" /> My Jobs
            </Button>
          )}
          <Button
            variant={holdFilter ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs px-3 gap-1.5"
            onClick={() => setHoldFilter(v => !v)}
            title="Show only jobs on billing hold"
          >
            <Pause className="w-3 h-3" /> Billing Hold
          </Button>
          <Button
            variant={unassignedFilter ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs px-3 gap-1.5"
            onClick={() => setUnassignedFilter(v => !v)}
            title="Show only unassigned jobs"
          >
            <User className="w-3 h-3" /> Unassigned
          </Button>
          <Button
            variant={overdueFilter ? 'destructive' : 'outline'}
            size="sm"
            className="h-8 text-xs px-3 gap-1.5"
            onClick={() => setOverdueFilter(v => !v)}
            title="Show only past-due incomplete jobs"
          >
            <AlertTriangle className="w-3 h-3" /> Overdue
            {(() => { const n = filteredJobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled' && new Date(j.scheduledAt) < new Date()).length; return n > 0 ? <span className="ml-1 bg-destructive text-destructive-foreground rounded-full text-[10px] w-4 h-4 flex items-center justify-center font-bold">{n > 99 ? '99+' : n}</span> : null; })()}
          </Button>
          <Button
            variant={noRouteFilter ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs px-3 gap-1.5"
            onClick={() => setNoRouteFilter(v => !v)}
            title="Show only jobs not assigned to any route"
          >
            <MapPin className="w-3 h-3" /> No Route
          </Button>
          {crews.length > 0 && (
            <Select value={crewFilter} onValueChange={setCrewFilter}>
              <SelectTrigger className="h-8 text-xs w-36 gap-1" title="Filter by crew">
                <Users className="w-3 h-3 shrink-0" />
                <SelectValue placeholder="All crews" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All crews</SelectItem>
                {crews.map((c: any) => (
                  <SelectItem key={c.id} value={c.name} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs w-36 gap-1" title="Filter by job status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
              <SelectItem value="pending" className="text-xs">Pending</SelectItem>
              <SelectItem value="in_progress" className="text-xs">In Progress</SelectItem>
              <SelectItem value="completed" className="text-xs">Completed</SelectItem>
              <SelectItem value="cancelled" className="text-xs">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          {(jobSearch || propertyFilter || routeFilter !== 'all' || priorityFilter !== 'all' || statusFilter !== 'all' || holdFilter || myJobsFilter || unassignedFilter || crewFilter !== 'all' || overdueFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs px-2 text-muted-foreground"
              title="Reset all filters"
              onClick={() => { setJobSearch(''); setPropertyFilter(''); setRouteFilter('all'); setPriorityFilter('all'); setStatusFilter('all'); setHoldFilter(false); setMyJobsFilter(false); setUnassignedFilter(false); setCrewFilter('all'); setOverdueFilter(false); setNoRouteFilter(false); }}
            >
              Clear filters
            </Button>
          )}
          <div className="flex items-center rounded-md border p-1 bg-muted/50">
            <Button variant={view === 'week' ? 'secondary' : 'ghost'} size="sm" title="Weekly calendar view" onClick={() => setView('week')} className="h-7 text-xs px-3">Week</Button>
            <Button variant={view === 'month' ? 'secondary' : 'ghost'} size="sm" title="Monthly calendar view" onClick={() => setView('month')} className="h-7 text-xs px-3">Month</Button>
            <Button variant={view === 'series' ? 'secondary' : 'ghost'} size="sm" title="Recurring visit series view" onClick={() => setView('series')} className="h-7 text-xs px-3 gap-1"><RefreshCw className="w-3 h-3" />Series</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs px-3" title="Jump to today" onClick={() => setCurrentDate(new Date())}>Today</Button>
            <Button variant="outline" size="icon" title={`Previous ${view === 'week' ? 'week' : 'month'}`} onClick={prevRange}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="min-w-[140px] text-center font-medium">
              {view === 'week' ? `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}` : format(currentDate, 'MMMM yyyy')}
            </div>
            <Button variant="outline" size="icon" title={`Next ${view === 'week' ? 'week' : 'month'}`} onClick={nextRange}><ChevronRight className="w-4 h-4" /></Button>
          </div>
          <ImportExportControls
            entity="jobs"
            entityLabel="Jobs"
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListJobsQueryKey() })}
          />
          {canManageJobs && (
            <Button className="gap-2" title="Create a new job" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> New Job
            </Button>
          )}
        </div>
      </div>

      {/* Job count summary (shown when any filter is active and not in series view) */}
      {view !== 'series' && (jobSearch || propertyFilter || routeFilter !== 'all' || priorityFilter !== 'all' || statusFilter !== 'all' || holdFilter || myJobsFilter || unassignedFilter || crewFilter !== 'all' || overdueFilter || noRouteFilter) && (
        <div className="px-1 py-1 text-xs text-muted-foreground" title={`${filteredJobs.length} of ${(jobs ?? []).length} jobs match the active filters`}>
          Showing {filteredJobs.length} of {(jobs ?? []).length} job{(jobs ?? []).length !== 1 ? 's' : ''} in view
        </div>
      )}

      {/* Series View */}
      {view === 'series' && (
        <Card className="flex-1 overflow-y-auto">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-primary" /> Recurring Series{recurringSeries && recurringSeries.length > 0 && <span className="text-xs font-normal bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{recurringSeries.length}</span>}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">One row per active recurring schedule. Manage pause, skip, and cancel from here.</p>
            </div>
          </div>
          {!recurringSeries || recurringSeries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
              <RefreshCw className="w-8 h-8 opacity-30" />
              <p className="text-sm">No recurring series yet.</p>
              <p className="text-xs">Create a job and toggle "Make Recurring" to start a series.</p>
              {canManageJobs && (
                <Button size="sm" variant="outline" title="Create a new recurring job series" className="gap-1.5 mt-1" onClick={() => setCreateOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> New Job
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {recurringSeries.map(s => {
                const sr = s as typeof s & { planId?: number | null; planName?: string | null };
                const isLinking = linkPlanSeriesId === s.id;
                return (
                <div key={s.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setLocation(`/schedule?search=${encodeURIComponent(s.title)}`)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate" title={s.title}>{s.title}</span>
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
                      {s.customerName && <span className="flex items-center gap-1" title={s.customerName}><User className="w-3 h-3" />{s.customerName}</span>}
                      {(s.crewName || s.assigneeName) && <span className="flex items-center gap-1" title={s.crewName ?? s.assigneeName ?? undefined}><Users className="w-3 h-3" />{s.crewName ?? s.assigneeName}</span>}
                      <span title={`${s.completedCount} job occurrences have been created for this series`}>{s.completedCount} occurrences generated</span>
                      {s.nextScheduledAt && <span className="flex items-center gap-1" title={format(new Date(s.nextScheduledAt), 'EEEE, MMMM d, yyyy')}><Calendar className="w-3 h-3" />Next: {format(new Date(s.nextScheduledAt), 'MMM d, yyyy')}</span>}
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
                      size="sm" variant="outline" title="Skip the next scheduled occurrence of this series" className="h-7 text-xs gap-1"
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
                      size="sm" variant="outline" title={s.isRecurrencePaused ? 'Resume this recurring series' : 'Pause this recurring series — no new jobs will be generated until resumed'} className={`h-7 text-xs gap-1 ${s.isRecurrencePaused ? 'text-emerald-600' : ''}`}
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
                      onClick={() => setCancelSeriesDialogId(s.id)}
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
        {view === 'week' && !isTechnician && (() => {
          const weekRevenue = days.reduce((sum, day) => sum + getJobsForDay(day).filter(j => j.status === 'completed').reduce((s, j) => s + ((j as any).totalAmount ?? 0), 0), 0);
          return weekRevenue > 0 ? (
            <div className="px-4 py-1.5 bg-emerald-50 dark:bg-emerald-950/20 border-b text-xs text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-2">
              <span>Week revenue (completed jobs):</span>
              <span className="font-bold">${weekRevenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}</span>
            </div>
          ) : null;
        })()}
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
                      <span
                        className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full cursor-pointer hover:bg-muted transition-colors ${isToday ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-muted-foreground'}`}
                        onClick={() => { setCurrentDate(day); if (view === 'month') setView('week'); }}
                        title={format(day, 'EEEE, MMM d')}
                      >
                        {format(day, 'd')}
                      </span>
                      {totalCount > 0 ? (
                        <div className="flex flex-col items-end">
                          <span className={`text-xs ${dayJobs.some(j => (j as any).holdFromBilling) ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`} title={`${totalCount} item${totalCount !== 1 ? 's' : ''}: ${dayJobs.length} job${dayJobs.length !== 1 ? 's' : ''}, ${dayEstimates.length} estimate${dayEstimates.length !== 1 ? 's' : ''}, ${dayVisits.length} visit${dayVisits.length !== 1 ? 's' : ''}`}>
                            {totalCount}{dayJobs.some(j => (j as any).holdFromBilling) ? ' ⚠' : ''}
                          </span>
                          {!isTechnician && dayJobs.filter(j => j.status === 'completed').length > 0 && (
                            <span
                              className="text-[10px] text-emerald-600 font-medium"
                              title={`${dayJobs.filter(j => j.status === 'completed').length} completed job${dayJobs.filter(j => j.status === 'completed').length !== 1 ? 's' : ''}`}
                            >
                              ${dayJobs.filter(j => j.status === 'completed').reduce((s, j) => s + ((j as any).totalAmount ?? 0), 0).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ) : !isOtherMonth && (
                        <button
                          className="text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                          title={`Create job for ${format(day, 'MMM d')}`}
                          onClick={() => {
                            setCurrentDate(day);
                            setView('week');
                            setNewJob({ ...EMPTY_JOB, scheduledAt: format(day, "yyyy-MM-dd'T'08:00") });
                            setCreateOpen(true);
                          }}
                        >
                          +
                        </button>
                      )}
                    </div>
                    <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
                      {/* Jobs */}
                      {dayJobs.map(job => (
                        <div
                          key={`job-${job.id}`}
                          onClick={() => setSelectedJobId(job.id)}
                          className={`p-2 rounded border text-xs cursor-pointer hover:shadow-md hover:brightness-95 transition-all ${STATUS_COLORS[job.status] ?? STATUS_COLORS.scheduled}`}
                        >
                          <div className="font-semibold truncate" title={job.title}>{job.title}</div>
                          {!isTechnician && (job.assigneeName || job.crewName) && (
                            <div className="mt-1 flex items-center gap-1 opacity-80" title={job.crewName ?? job.assigneeName ?? undefined}>
                              {job.crewName ? <Users className="w-3 h-3" /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                              <span className="truncate">{job.crewName ?? job.assigneeName}</span>
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-1 opacity-80">
                            <Clock className="w-3 h-3" />
                            <span title={format(new Date(job.scheduledAt), 'EEEE, MMMM d, yyyy h:mm a')}>{format(new Date(job.scheduledAt), 'h:mm a')}{(job as any).estimatedDuration ? ` – ${format(new Date(new Date(job.scheduledAt).getTime() + (job as any).estimatedDuration * 60000), 'h:mm a')}` : ''}</span>
                          </div>
                          {job.customerName && <div className="mt-0.5 truncate opacity-80" title={job.customerName}>{job.customerName}</div>}
                          {(job as any).propertyAddress && <div className="mt-0.5 truncate opacity-60 text-[10px]" title={(job as any).propertyAddress}>{(job as any).propertyAddress}</div>}
                          {(job.recurrenceRule || job.recurrenceParentId) && (
                            <div className="mt-0.5 flex items-center gap-1 opacity-70" title={(job as any).recurrenceDescription ?? 'Recurring job'}>
                              <RefreshCw className="w-2.5 h-2.5" />
                              <span className="truncate text-[10px]">{(job as any).recurrenceDescription ?? 'Recurring'}</span>
                            </div>
                          )}
                          {(job as any).routeName && (
                            <div className="mt-0.5 flex items-center gap-1" title={`Route: ${(job as any).routeName}`}>
                              <RouteIcon className="w-2.5 h-2.5 opacity-70 shrink-0" />
                              <span className="truncate text-[10px] font-medium opacity-80">{(job as any).routeName}</span>
                            </div>
                          )}
                          {(job as any).priority && (job as any).priority !== 'normal' && (
                            <div className={`mt-0.5 rounded px-1 py-0.5 w-fit text-[10px] font-medium ${PRIORITY_COLORS[(job as any).priority] ?? ''}`} title={`Priority: ${(job as any).priority}`}>
                              {(job as any).priority}
                            </div>
                          )}
                          {(job as any).holdFromBilling && (
                            <div className="mt-0.5 flex items-center gap-1 text-amber-700 bg-amber-50 rounded px-1 py-0.5 w-fit">
                              <Pause className="w-2.5 h-2.5 shrink-0" />
                              <span className="text-[10px] font-medium">Billing hold</span>
                            </div>
                          )}
                          {((job as any).customerNotes || (job as any).propertyNotes) && (
                            <div className="mt-0.5 flex items-center gap-1 text-blue-700 bg-blue-50 rounded px-1 py-0.5 w-fit" title={(job as any).customerNotes || (job as any).propertyNotes}>
                              <Bell className="w-2.5 h-2.5 shrink-0" />
                              <span className="text-[10px] font-medium">Notes</span>
                            </div>
                          )}
                          {(job as any).jobParts?.length > 0 && (
                            <div className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                              <span className="text-[10px]">Parts: ${((job as any).jobParts as { total: number }[]).reduce((s, p) => s + (p.total ?? 0), 0).toFixed(2)}</span>
                            </div>
                          )}
                          {job.status !== 'completed' && job.status !== 'cancelled' && new Date(job.scheduledAt) < new Date() && (
                            <div className="mt-0.5 flex items-center gap-1 text-red-700 bg-red-50 rounded px-1 py-0.5 w-fit">
                              <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                              <span className="text-[10px] font-medium">Overdue</span>
                            </div>
                          )}
                        </div>
                      ))}
                      {/* Estimates */}
                      {dayEstimates.map(est => (
                        <div
                          key={`est-${est.id}`}
                          className="p-2 rounded border text-xs cursor-pointer hover:shadow-md transition-all bg-violet-100 text-violet-800 border-violet-200"
                          onClick={() => setLocation(`/estimates?highlight=${est.id}`)}
                        >
                          <div className="font-semibold truncate flex items-center gap-1" title={est.customerName ?? `Estimate #${est.id}`}>
                            <span className="text-[9px] uppercase tracking-wide font-bold opacity-60">EST</span>
                            {est.customerName ?? `Estimate #${est.id}`}
                          </div>
                          {est.status && (
                            <div className="mt-0.5">
                              <span title={`Estimate status: ${est.status}`} className={`text-[9px] uppercase tracking-wide font-bold px-1 rounded ${est.status === 'approved' ? 'bg-emerald-200 text-emerald-800' : est.status === 'declined' ? 'bg-red-200 text-red-800' : est.status === 'sent' ? 'bg-amber-200 text-amber-800' : 'opacity-60'}`}>{est.status}</span>
                            </div>
                          )}
                          {est.scheduledAt && (
                            <div className="mt-1 flex items-center gap-1 opacity-80">
                              <Clock className="w-3 h-3" />
                              <span>{format(new Date(est.scheduledAt), 'h:mm a')}</span>
                            </div>
                          )}
                          {(est as any).total > 0 && <div className="mt-0.5 font-medium opacity-80">${(est as any).total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>}
                        </div>
                      ))}
                      {/* Visits */}
                      {dayVisits.map(visit => (
                        <div
                          key={`visit-${visit.id}`}
                          className="p-2 rounded border text-xs cursor-pointer hover:shadow-md transition-all bg-teal-100 text-teal-800 border-teal-200"
                          onClick={() => setLocation(`/visits?visitId=${visit.id}`)}
                        >
                          <div className="font-semibold truncate flex items-center gap-1" title={visit.purpose}>
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
        <SheetContent className="w-full sm:max-w-[75vw] overflow-y-auto">
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
              <Button title="Create this job and add it to the schedule" onClick={handleCreateJob} disabled={createJob.isPending}>
                {createJob.isPending ? 'Creating...' : 'Create Job'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Job Detail Sheet */}
      <Sheet open={selectedJobId != null} onOpenChange={open => { if (!open) setSelectedJobId(null); }}>
        <SheetContent className="w-full sm:max-w-[75vw] overflow-y-auto">
          {selectedJob ? (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {editingTitle ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          className="text-xl font-semibold leading-tight border-b border-primary bg-transparent outline-none w-full"
                          value={titleDraft}
                          disabled={updateJob.isPending}
                          onChange={e => setTitleDraft(e.target.value)}
                          onBlur={() => {
                            if (titleDraft.trim() && titleDraft.trim() !== selectedJob.title) {
                              updateJob.mutate({ id: selectedJob.id, data: { title: titleDraft.trim() } as any }, {
                                onSuccess: () => toast.success('Title updated'),
                                onError: () => toast.error('Failed to update title'),
                              });
                            }
                            setEditingTitle(false);
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setEditingTitle(false); } }}
                        />
                      </div>
                    ) : (
                      <SheetTitle className="text-xl leading-tight cursor-pointer hover:opacity-80" title="Click to edit title" onClick={() => { setTitleDraft(selectedJob.title); setEditingTitle(true); }}>{selectedJob.title}</SheetTitle>
                    )}
                    <SheetDescription className="mt-1 flex items-center gap-2 flex-wrap">
                      <span title={`Job #${selectedJob.id} · Created ${format(new Date(selectedJob.createdAt), 'EEEE, MMMM d, yyyy')}`}>Job #{selectedJob.id} · Created {format(new Date(selectedJob.createdAt), 'MMM d, yyyy')}</span>
                      {selectedJob.customerId && (
                        <Link href={`/customers/${selectedJob.customerId}`} className="text-primary hover:underline text-xs font-medium" title="View this customer's profile" onClick={() => setSelectedJobId(null)}>
                          View customer →
                        </Link>
                      )}
                      {(selectedJob as any).propertyId && (
                        <Link href={`/properties/${(selectedJob as any).propertyId}`} className="text-primary hover:underline text-xs font-medium" title="View this property's details" onClick={() => setSelectedJobId(null)}>
                          View property →
                        </Link>
                      )}
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
                    <Badge className={`capitalize ${STATUS_COLORS[selectedJob.status] ?? ''}`} variant="outline" title={`Job status: ${selectedJob.status.replace('_', ' ')}`}>
                      {selectedJob.status.replace('_', ' ')}
                    </Badge>
                    {(selectedJob as any).priority && (selectedJob as any).priority !== 'normal' && (
                      <Badge variant="outline" className={`capitalize text-xs ${(selectedJob as any).priority === 'urgent' ? 'bg-red-50 text-red-700 border-red-300' : (selectedJob as any).priority === 'high' ? 'bg-orange-50 text-orange-700 border-orange-300' : 'bg-muted text-muted-foreground'}`} title={`Priority: ${(selectedJob as any).priority}`}>
                        {(selectedJob as any).priority}
                      </Badge>
                    )}
                    {canManageJobs && (
                      <>
                        <button
                          title="Duplicate job"
                          className="text-muted-foreground/40 hover:text-primary transition-colors"
                          onClick={async () => {
                            const j = selectedJob as any;
                            try {
                              await createJob.mutateAsync({ data: { title: `${selectedJob.title} (copy)`, customerId: j.customerId, propertyId: j.propertyId, assigneeId: j.assigneeId, crewId: j.crewId, description: selectedJob.description ?? undefined, status: 'scheduled', scheduledAt: selectedJob.scheduledAt } });
                              toast.success('Job duplicated');
                              qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                            } catch { toast.error('Failed to duplicate job'); }
                          }}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          title="Delete job"
                          className="text-muted-foreground/40 hover:text-destructive transition-colors"
                          onClick={() => setDeleteJobPending(true)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
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
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" title="Skip the next occurrence of this recurring job" disabled={skipNextOccurrence.isPending}
                        onClick={() => { const rootId = (selectedJob as any).recurrenceParentId ?? selectedJob.id; setSkipNextDialogId(rootId); }}>
                        <SkipForward className="w-3 h-3" /> Skip Next
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" title={(selectedJob as any).isRecurrencePaused ? 'Resume this recurring series' : 'Pause this recurring series'} disabled={pauseSeries.isPending}
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
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" title="Cancel all future occurrences of this series" disabled={cancelSeries.isPending}
                        onClick={() => { const rootId = (selectedJob as any).recurrenceParentId ?? selectedJob.id; setCancelSeriesDialogId(rootId); }}>
                        <X className="w-3 h-3" /> Cancel Series
                      </Button>
                    </div>
                  </div>
                )}

                {/* Status change (non-tech) */}
                {canManageJobs && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Update Status</label>
                    <Select value={selectedJob.status} onValueChange={handleStatusChange} disabled={updateJob.isPending}>
                      <SelectTrigger title="Update the current job status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    {selectedJob.status !== 'completed' && selectedJob.status !== 'cancelled' && (
                      <Button size="sm" variant="outline" className="w-full gap-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50" title="Mark this job as completed" disabled={updateJob.isPending} onClick={() => handleStatusChange('completed')}>
                        <CheckCircle className="w-4 h-4" /> {updateJob.isPending ? 'Saving…' : 'Mark Complete'}
                      </Button>
                    )}
                  </div>
                )}

                {/* Hold from billing (non-tech) */}
                {canManageJobs && (
                  <div className="rounded-lg border">
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium">Hold from Billing</p>
                        <p className="text-xs text-muted-foreground">Exclude this job from the next billing run</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        title={(selectedJob as any).holdFromBilling ? 'Release this job for billing' : 'Exclude this job from the next billing run'}
                        aria-checked={(selectedJob as any).holdFromBilling ?? false}
                        disabled={updateJob.isPending}
                        onClick={() => updateJob.mutate(
                          { id: selectedJobId!, data: { holdFromBilling: !((selectedJob as any).holdFromBilling ?? false) } as Parameters<typeof updateJob.mutate>[0]['data'] },
                          { onSuccess: () => { toast.success((selectedJob as any).holdFromBilling ? 'Job released for billing' : 'Job held from billing'); } },
                        )}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none disabled:opacity-50 ${(selectedJob as any).holdFromBilling ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${(selectedJob as any).holdFromBilling ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    {(selectedJob as any).holdFromBilling && (
                      <div className="border-t px-3 py-2">
                        <input
                          type="text"
                          className="w-full text-xs bg-transparent border-none outline-none placeholder:text-muted-foreground/60 text-muted-foreground"
                          placeholder="Hold reason (optional)…"
                          defaultValue={(selectedJob as any).holdNote ?? ''}
                          onBlur={e => {
                            const v = e.target.value.trim();
                            if (v !== ((selectedJob as any).holdNote ?? '')) {
                              updateJob.mutate({ id: selectedJobId!, data: { holdNote: v || null } as any });
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                <Separator />

                {/* Details */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Scheduled</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span>{format(new Date(selectedJob.scheduledAt), 'MMM d, yyyy · h:mm a')}</span>
                      {canManageJobs && (
                        <>
                          <button
                            className="text-xs text-primary hover:underline disabled:opacity-50"
                            title="Move to next day"
                            disabled={updateJob.isPending}
                            onClick={() => {
                              const next = new Date(selectedJob.scheduledAt);
                              next.setDate(next.getDate() + 1);
                              updateJob.mutate({ id: selectedJob.id, data: { scheduledAt: next.toISOString() } as any }, {
                                onSuccess: () => { toast.success('Rescheduled +1 day'); qc.invalidateQueries(); },
                                onError: () => toast.error('Failed to reschedule'),
                              });
                            }}
                          >
                            +1 Day
                          </button>
                          <input
                            type="datetime-local"
                            className="text-xs border rounded px-1 py-0.5 bg-background text-foreground cursor-pointer"
                            defaultValue={new Date(selectedJob.scheduledAt).toISOString().slice(0, 16)}
                            title="Reschedule to specific date & time"
                            onChange={e => {
                              if (!e.target.value) return;
                              const iso = new Date(e.target.value).toISOString();
                              updateJob.mutate({ id: selectedJob.id, data: { scheduledAt: iso } as any }, {
                                onSuccess: () => { toast.success('Rescheduled'); qc.invalidateQueries(); },
                                onError: () => toast.error('Failed to reschedule'),
                              });
                            }}
                          />
                        </>
                      )}
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
                        {(selectedJob as any).customerId ? (
                          <Link href={`/customers/${(selectedJob as any).customerId}`} title={`View ${selectedJob.customerName}`} className="text-sm text-primary hover:underline">{selectedJob.customerName}</Link>
                        ) : <span>{selectedJob.customerName}</span>}
                        {(selectedJob as any).customerPhone && (
                          <a href={`tel:${(selectedJob as any).customerPhone}`} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5" title="Call customer">
                            <Phone className="w-3 h-3" />{(selectedJob as any).customerPhone}
                          </a>
                        )}
                        {(selectedJob as any).customerEmail && (
                          <a href={`mailto:${(selectedJob as any).customerEmail}`} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5" title="Email customer">
                            <Mail className="w-3 h-3" />{(selectedJob as any).customerEmail}
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedJob.assigneeName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Assigned To</p>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        {(selectedJob as any).assigneeId
                          ? <button title={selectedJob.assigneeName ?? undefined} className="hover:underline text-primary text-sm" onClick={() => window.location.href = `${import.meta.env.BASE_URL}settings?tab=users&userId=${(selectedJob as any).assigneeId}`}>{selectedJob.assigneeName}</button>
                          : <span title={selectedJob.assigneeName ?? undefined}>{selectedJob.assigneeName}</span>}
                      </div>
                    </div>
                  )}
                  {selectedJob.crewName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Crew</p>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        {(selectedJob as any).crewId
                          ? <button title={selectedJob.crewName ?? undefined} className="hover:underline text-primary text-sm" onClick={() => setLocation('/crews')}>{selectedJob.crewName}</button>
                          : <span title={selectedJob.crewName ?? undefined}>{selectedJob.crewName}</span>}
                      </div>
                    </div>
                  )}
                  {selectedJob.propertyAddress && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Property</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                        {(selectedJob as any).propertyId
                          ? <Link href={`/properties/${(selectedJob as any).propertyId}`} title="View property details" className="hover:underline text-primary">{selectedJob.propertyAddress}</Link>
                          : <span title={selectedJob.propertyAddress ?? undefined}>{selectedJob.propertyAddress}</span>}
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedJob.propertyAddress)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary hover:underline shrink-0"
                        >
                          ↗ Maps
                        </a>
                      </div>
                      {(selectedJob as any).propertyNotes && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1" title={(selectedJob as any).propertyNotes}>
                          📍 {(selectedJob as any).propertyNotes}
                        </p>
                      )}
                    </div>
                  )}
                  {(selectedJob as any).customerNotes && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customer Notes</p>
                      <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1" title={(selectedJob as any).customerNotes}>
                        {(selectedJob as any).customerNotes}
                      </p>
                    </div>
                  )}
                  {selectedJob.priority && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Priority</p>
                      <Badge className={`capitalize ${PRIORITY_COLORS[selectedJob.priority] ?? ''}`} variant="outline" title={`Job priority: ${selectedJob.priority}`}>
                        {selectedJob.priority}
                      </Badge>
                    </div>
                  )}
                  {selectedJob.customerId && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customer</p>
                      <div className="flex items-center gap-2 text-sm">
                        <User className="w-4 h-4 text-muted-foreground shrink-0" />
                        <Link href={`/customers/${selectedJob.customerId}`} className="hover:underline text-primary" title={`View ${selectedJob.customerName ?? `Customer #${selectedJob.customerId}`}`}>
                          {selectedJob.customerName ?? `Customer #${selectedJob.customerId}`}
                        </Link>
                      </div>
                    </div>
                  )}
                  {(selectedJob as any).planId && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Service Plan</p>
                      <div className="flex items-center gap-2 text-sm">
                        <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />
                        <a
                          href={`/plans/${(selectedJob as any).planId}`}
                          className="hover:underline text-primary"
                          title={`View ${(selectedJob as any).planName ?? `Plan #${(selectedJob as any).planId}`}`}
                          onClick={e => { e.preventDefault(); setLocation(`/plans/${(selectedJob as any).planId}`); }}
                        >
                          {(selectedJob as any).planName ?? `Plan #${(selectedJob as any).planId}`}
                        </a>
                      </div>
                    </div>
                  )}
                  {/* Route assignment */}
                  <div className="col-span-2 space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Route</p>
                    {assignedRoute ? (
                      <div className="flex items-center gap-2 text-sm">
                        <RouteIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium" title={assignedRoute.name}>{assignedRoute.name}</span>
                        {assignedRoute.divisionName && (
                          <span className="text-xs text-muted-foreground" title={`Division: ${assignedRoute.divisionName}`}>· {assignedRoute.divisionName}</span>
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
                          disabled={updateJobRoute.isPending}
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
                          <SelectTrigger className="h-8 text-xs" title="Assign this job to a route">
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
                  {(selectedJob as any).completedAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Completed</p>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                        <span>{new Date((selectedJob as any).completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  )}
                  {!(selectedJob as any).invoiceId && canManageJobs && selectedJob.status === 'completed' && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Invoice</p>
                      <button
                        title="Create a new invoice from this completed job"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                        onClick={() => setLocation(`/financials?action=create&jobId=${selectedJob.id}`)}
                      >
                        <FileText className="w-3 h-3" /> Create Invoice →
                      </button>
                    </div>
                  )}
                  {(selectedJob as any).invoiceId && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Invoice</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(selectedJob as any).invoiceStatus && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${(selectedJob as any).invoiceStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' : (selectedJob as any).invoiceStatus === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {(selectedJob as any).invoiceStatus}
                          </span>
                        )}
                        <button
                          title="Open this invoice in Financials"
                          className="text-sm text-primary hover:underline flex items-center gap-1"
                          onClick={() => setLocation(`/financials?invoiceId=${(selectedJob as any).invoiceId}`)}
                        >
                          <FileText className="w-3.5 h-3.5" /> View Invoice →
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {(selectedJob.description || canManageJobs) && (
                  <>
                    <Separator />
                    <JobDescriptionEditor
                      jobId={selectedJobId!}
                      initialDescription={selectedJob.description ?? ''}
                      canEdit={canManageJobs}
                    />
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
                        <p className="text-sm font-semibold text-amber-800 tabular-nums" title="Time elapsed since clock-in">
                          {Math.floor(liveJobSeconds / 3600)}h {String(Math.floor((liveJobSeconds % 3600) / 60)).padStart(2, '0')}m {String(liveJobSeconds % 60).padStart(2, '0')}s
                        </p>
                        <p className="text-xs text-amber-600" title="Currently clocked in to this job">Clocked in</p>
                      </div>
                      <Button
                        size="sm" variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-100 gap-1.5 h-8"
                        title="Clock out and stop the running timer for this job"
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
                      title="Start a timer to clock in to this job"
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

                {/* Total logged time summary */}
                {(() => {
                  const jobTimers = (subTimers ?? []).filter((t: any) => t.jobId === selectedJobId);
                  if (jobTimers.length === 0) return null;
                  const totalSec = jobTimers.reduce((s: number, t: any) => {
                    if (!t.startedAt) return s;
                    const end = t.stoppedAt ? new Date(t.stoppedAt).getTime() : Date.now();
                    return s + Math.floor((end - new Date(t.startedAt).getTime()) / 1000);
                  }, 0);
                  const hrs = Math.floor(totalSec / 3600);
                  const mins = Math.floor((totalSec % 3600) / 60);
                  return (
                    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Total logged</span>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums" title={`Total time logged: ${hrs}h ${String(mins).padStart(2, '0')}m`}>{hrs}h {String(mins).padStart(2, '0')}m</span>
                        {selectedJob.estimatedDuration && totalSec > selectedJob.estimatedDuration * 60 && (
                          <Badge className="h-4 px-1 text-[10px] bg-amber-500 text-white border-transparent" title={`${Math.floor((totalSec - selectedJob.estimatedDuration * 60) / 60)} minutes over the estimated duration`}>
                            +{Math.floor((totalSec - selectedJob.estimatedDuration * 60) / 60)}m over
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Parts used on job */}
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                      <ClipboardList className="w-3.5 h-3.5" /> Parts Used
                      {Array.isArray(selectedJob.jobParts) && selectedJob.jobParts.length > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]" title={`${selectedJob.jobParts.length} part${selectedJob.jobParts.length !== 1 ? 's' : ''} logged`}>{selectedJob.jobParts.length}</Badge>
                      )}
                      {Array.isArray(selectedJob.jobParts) && selectedJob.jobParts.length > 0 && (
                        <span className="text-xs text-muted-foreground font-normal ml-1" title={`Total parts cost: $${selectedJob.jobParts.reduce((s, p) => s + (p.total ?? 0), 0).toFixed(2)}`}>${selectedJob.jobParts.reduce((s, p) => s + (p.total ?? 0), 0).toFixed(2)}</span>
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      title="Search inventory and add a part to this job"
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
                          className="w-full pl-8 pr-8 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                          title="Search inventory by name or SKU"
                          placeholder="Search inventory..."
                          value={partsSearch}
                          onChange={e => setPartsSearch(e.target.value)}
                          autoFocus
                        />
                        {partsSearch && <button title="Clear parts search" onClick={() => setPartsSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
                      </div>
                      {inventoryItems && inventoryItems.length > 0 && (
                        <div className="rounded-md border divide-y text-sm max-h-48 overflow-y-auto">
                          {inventoryItems.slice(0, 8).map(item => (
                            <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate" title={item.name}>{item.name}</div>
                                <div className="text-xs text-muted-foreground" title={`$${item.unitPrice.toFixed(2)} per ${item.unit} · ${item.quantity} in stock`}>${item.unitPrice.toFixed(2)}/{item.unit} · {item.quantity} in stock</div>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  title="Quantity to add"
                                  className="w-14 text-xs border rounded px-1.5 py-1 text-right"
                                  value={partQty}
                                  onChange={e => setPartQty(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                />
                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  title={`Add ${item.name} to this job`}
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
                                >{addJobPart.isPending ? 'Adding…' : 'Add'}</Button>
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
                            <span className="font-medium truncate block" title={part.name}>{part.name}</span>
                            <span className="text-xs text-muted-foreground" title={`${part.quantity} × $${part.unitPrice.toFixed(2)} each`}>{part.quantity} × ${part.unitPrice.toFixed(2)}</span>
                            <PartLocationBadges inventoryItemId={part.inventoryItemId} />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold" title={`Part total: $${part.total.toFixed(2)}`}>${part.total.toFixed(2)}</span>
                            <button
                              className="text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-30"
                              title="Remove this part from the job"
                              disabled={removeJobPart.isPending}
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
                          {jobRepairLogs && jobRepairLogs.length > 0 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{jobRepairLogs.length}</Badge>
                          )}
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
                                  <Badge variant="outline" className="capitalize text-xs mr-2" title={`Component: ${r.componentType}`}>{r.componentType}</Badge>
                                  <span className="font-medium" title={r.replacedWithName ?? r.replacedWhat ?? undefined}>{r.replacedWithName ?? r.replacedWhat ?? 'Repair'}</span>
                                </div>
                                <span className="font-semibold text-xs" title={`Repair cost: $${r.totalCost.toFixed(2)}`}>${r.totalCost.toFixed(2)}</span>
                              </div>
                              {r.replacedWhat && <p className="text-xs text-muted-foreground mt-0.5" title={`Replaced: ${r.replacedWhat}`}>Replaced: {r.replacedWhat}</p>}
                              {r.notes && <p className="text-xs text-muted-foreground mt-0.5" title={r.notes}>{r.notes}</p>}
                              <p className="text-xs text-muted-foreground mt-1" title={new Date(r.performedAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>{new Date(r.performedAt).toLocaleDateString()}{r.performedByName ? ` · ${r.performedByName}` : ''}</p>
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
                      {chemApps && chemApps.length > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{chemApps.length}</Badge>
                      )}
                    </p>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => {
                      // Default appliedAt to current local datetime
                      const now = new Date();
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const localDT = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                      // Auto-fill applicator license from current user's profile
                      const currentUser = (users ?? []).find((u: any) => u.id === user?.id);
                      const license = (currentUser as any)?.applicatorLicense ?? '';
                      setChemForm(f => ({ ...f, appliedAt: localDT, applicatorLicenseNumber: license || f.applicatorLicenseNumber }));
                      setChemFormOpen(true);
                    }} title="Log a chemical application for this job">
                      <Plus className="w-3 h-3" /> Log Application
                    </Button>
                  </div>
                  {chemApps && chemApps.length > 0 ? (
                    <div className="rounded-lg border divide-y text-sm">
                      {chemApps.map(app => (
                        <div key={app.id} className="px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium" title={app.mixtureName ?? app.productName ?? undefined}>{app.mixtureName ?? app.productName ?? 'Unknown'}</span>
                              <span className="text-xs text-muted-foreground ml-2" title={`Volume applied: ${app.volumeApplied} ${app.volumeUnit}`}>{app.volumeApplied} {app.volumeUnit}</span>
                            </div>
                            {canManageJobs && (
                              <button onClick={() => {
                                deleteChemApp.mutate({ id: app.id }, {
                                  onSuccess: () => { refetchChemApps(); toast.success('Application removed'); },
                                });
                              }} disabled={deleteChemApp.isPending} className="text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-40">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {(app.breakdown as unknown[]).length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {(app.breakdown as Array<{ productName?: string | null; amountApplied: number; unit: string; activeIngredients?: string | null }>).map((b, i) => (
                                <p key={i} className="text-xs text-muted-foreground" title={`${b.productName}: ${b.amountApplied?.toFixed(2)} ${b.unit}${b.activeIngredients ? ` · ${b.activeIngredients}` : ''}`}>
                                  {b.productName}: {b.amountApplied?.toFixed(2)} {b.unit}
                                  {b.activeIngredients ? ` · ${b.activeIngredients}` : ''}
                                </p>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground mt-1" title={`Applied ${format(new Date(app.appliedAt), 'EEEE, MMMM d, yyyy h:mm a')}${app.applicatorName ? ` by ${app.applicatorName}` : ''}`}>
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

                {/* Log Callback shortcut + inline list */}
                {canManageJobs && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                          <PhoneCall className="w-3.5 h-3.5" /> Callbacks
                          {jobCallbacks && jobCallbacks.length > 0 && (
                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">{jobCallbacks.length}</Badge>
                          )}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => setLocation(`/callbacks?action=create&jobId=${selectedJobId}`)}
                        >
                          <Plus className="w-3 h-3" /> Log Callback
                        </Button>
                      </div>
                      {jobCallbacks && jobCallbacks.length > 0 && (
                        <div className="space-y-1">
                          {jobCallbacks.map(cb => (
                            <div key={cb.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs cursor-pointer hover:bg-muted/60" onClick={() => { setSelectedJobId(null); setLocation(`/callbacks?highlight=${cb.id}`); }}>
                              <span className={`mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full ${cb.status === 'open' ? 'bg-destructive' : 'bg-emerald-500'}`} />
                              <div className="flex-1 min-w-0">
                                <span className="text-muted-foreground truncate">{cb.reason ?? 'No reason'}</span>
                                {cb.assigneeName && <span className="text-muted-foreground/70 ml-1">· {cb.assigneeName}</span>}
                                {(cb as any).scheduledFixDate && <span className="text-muted-foreground/60 ml-1">· Fix by {new Date((cb as any).scheduledFixDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                              </div>
                              <span className="text-primary hover:underline text-[10px] shrink-0">View →</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

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
                              <Send className="w-3 h-3" /> {sendReminder.isPending ? 'Sending…' : 'Send Now'}
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
                      {jobAlerts && jobAlerts.length > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{jobAlerts.length}</Badge>
                      )}
                    </p>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAlertPanelOpen(v => !v)}>
                      <Plus className="w-3 h-3" /> Log Alert
                    </Button>
                  </div>
                  {alertPanelOpen && (
                    <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                      <Select value={alertForm.type} onValueChange={v => setAlertForm(f => ({ ...f, type: v }))}>
                        <SelectTrigger className="h-8 text-xs" title="Select alert type: issue found on site or recommended service"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="issue">Issue found on site</SelectItem>
                          <SelectItem value="upsell">Recommended service</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={alertForm.priority} onValueChange={v => setAlertForm(f => ({ ...f, priority: v }))}>
                        <SelectTrigger className="h-8 text-xs" title="Set the priority level for this alert"><SelectValue placeholder="Priority" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low priority</SelectItem>
                          <SelectItem value="normal">Normal priority</SelectItem>
                          <SelectItem value="high">High priority</SelectItem>
                        </SelectContent>
                      </Select>
                      <Textarea
                        rows={2}
                        className="text-sm resize-none"
                        title="Describe the issue or service recommendation for the customer"
                        placeholder="Describe the issue or recommendation..."
                        value={alertForm.message}
                        maxLength={500}
                        onChange={e => setAlertForm(f => ({ ...f, message: e.target.value }))}
                      />
                      <p className="text-[10px] text-muted-foreground text-right">{alertForm.message.length}/500</p>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAlertPanelOpen(false)}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs" disabled={!alertForm.message.trim() || createAlert.isPending} onClick={() => {
                          if (!selectedJobId || !alertForm.message.trim()) return;
                          createAlert.mutate(
                            { id: selectedJobId, data: { type: alertForm.type as 'issue' | 'upsell', message: alertForm.message, priority: alertForm.priority } as any },
                            {
                              onSuccess: () => {
                                toast.success('Alert logged');
                                refetchAlerts();
                                setAlertPanelOpen(false);
                                setAlertForm({ type: 'issue', priority: 'normal', message: '' });
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
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${alert.type === 'issue' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`} title={`Alert type: ${alert.type}`}>
                              {alert.type === 'issue' ? 'Issue' : 'Upsell'}
                            </span>
                            <span className={`text-xs ${alert.status === 'accepted' ? 'text-emerald-600' : alert.status === 'declined' ? 'text-red-500' : 'text-muted-foreground'}`} title={`Alert status: ${alert.status}`}>
                              {alert.status}
                            </span>
                          </div>
                          <p className="mt-1 text-sm" title={alert.message}>{alert.message}</p>
                          {alert.customerResponse && (
                            <p className="mt-0.5 text-xs text-muted-foreground italic" title={`Customer response: ${alert.customerResponse}`}>"{alert.customerResponse}"</p>
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
      <Sheet open={chemFormOpen} onOpenChange={open => { if (!open) { setChemFormOpen(false); setChemForm({ mixtureId: '', productId: '', volumeApplied: '', volumeUnit: 'gal', targetPest: '', applicationMethod: '', windSpeed: '', windDirection: '', temperature: '', applicatorLicenseNumber: '', notes: '', appliedAt: '', treatedArea: '', areaUnit: 'sqft' }); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Log Chemical Application</SheetTitle>
            <SheetDescription>Record a pesticide or fertilizer application for compliance.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            {/* Empty state when no products or mixtures configured */}
            {(chemMixtures?.length ?? 0) === 0 && (chemProducts?.length ?? 0) === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground text-center space-y-1">
                <p className="font-medium">No chemical products set up yet.</p>
                <p className="text-xs">Go to Settings → Chemicals to add products or tank mixes. You can still log by volume below.</p>
              </div>
            )}
            {/* Mixture or Product */}
            {(chemMixtures?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tank Mix (Mixture)</label>
                <Select value={chemForm.mixtureId} onValueChange={v => setChemForm(f => ({ ...f, mixtureId: v, productId: '' }))}>
                  <SelectTrigger title="Select a pre-mixed tank mixture"><SelectValue placeholder="Select mixture…" /></SelectTrigger>
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
                  <SelectTrigger title="Select a raw chemical product"><SelectValue placeholder="Select product…" /></SelectTrigger>
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
                <Input type="number" min={0} step={0.01} title="Total volume of product applied" placeholder="e.g. 2.5" value={chemForm.volumeApplied} onChange={e => setChemForm(f => ({ ...f, volumeApplied: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Unit</label>
                <Select value={chemForm.volumeUnit} onValueChange={v => setChemForm(f => ({ ...f, volumeUnit: v }))}>
                  <SelectTrigger title="Select volume unit"><SelectValue /></SelectTrigger>
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
              <Input type="datetime-local" title="Date and time the chemical was applied" value={chemForm.appliedAt} onChange={e => setChemForm(f => ({ ...f, appliedAt: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Treated Area</label>
                <Input type="number" min={0} step={1} title="Total area treated by this application" placeholder="e.g. 5000" value={chemForm.treatedArea} onChange={e => setChemForm(f => ({ ...f, treatedArea: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Area Unit</label>
                <Select value={chemForm.areaUnit} onValueChange={v => setChemForm(f => ({ ...f, areaUnit: v }))}>
                  <SelectTrigger title="Select area measurement unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sqft">Sq ft</SelectItem>
                    <SelectItem value="acres">Acres</SelectItem>
                    <SelectItem value="sqm">Sq m</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Target Pest</label>
                <Input title="Target pest or weed being treated" placeholder="e.g. Broadleaf weeds" value={chemForm.targetPest} onChange={e => setChemForm(f => ({ ...f, targetPest: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Method</label>
                <Select value={chemForm.applicationMethod} onValueChange={v => setChemForm(f => ({ ...f, applicationMethod: v }))}>
                  <SelectTrigger title="Select the application method"><SelectValue placeholder="Select…" /></SelectTrigger>
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
                <Input type="number" min={0} step={0.5} title="Wind speed at time of application (mph)" placeholder="5" value={chemForm.windSpeed} onChange={e => setChemForm(f => ({ ...f, windSpeed: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Direction</label>
                <Select value={chemForm.windDirection} onValueChange={v => setChemForm(f => ({ ...f, windDirection: v }))}>
                  <SelectTrigger title="Wind direction at time of application"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Temp (°F)</label>
                <Input type="number" title="Temperature at time of application (°F)" placeholder="72" value={chemForm.temperature} onChange={e => setChemForm(f => ({ ...f, temperature: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Applicator License #</label>
              <Input title="Applicator's pesticide license number" placeholder="License number" value={chemForm.applicatorLicenseNumber} onChange={e => setChemForm(f => ({ ...f, applicatorLicenseNumber: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea title="Additional notes about this application (weather, conditions, observations, etc.)" placeholder="Additional notes…" rows={2} value={chemForm.notes} onChange={e => setChemForm(f => ({ ...f, notes: e.target.value }))} />
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
                      treatedArea: chemForm.treatedArea ? parseFloat(chemForm.treatedArea) : undefined,
                      areaUnit: chemForm.areaUnit || undefined,
                    },
                  }, {
                    onSuccess: () => {
                      toast.success('Application logged');
                      setChemFormOpen(false);
                      setChemForm({ mixtureId: '', productId: '', volumeApplied: '', volumeUnit: 'gal', targetPest: '', applicationMethod: '', windSpeed: '', windDirection: '', temperature: '', applicatorLicenseNumber: '', notes: '', appliedAt: '', treatedArea: '', areaUnit: 'sqft' });
                      qc.invalidateQueries({ queryKey: getListJobChemicalApplicationsQueryKey(selectedJobId!) });
                    },
                    onError: () => toast.error('Failed to log application'),
                  });
                }}
                title="Save this chemical application log entry"
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
                <SelectTrigger className="h-9" title="Select the type of component that was repaired"><SelectValue /></SelectTrigger>
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
              <Input className="h-9" title="Describe what was repaired or replaced" placeholder="e.g. Broken rotor head, leaking valve" value={schedRepairForm.replacedWhat} onChange={e => setSchedRepairForm(f => ({ ...f, replacedWhat: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Replaced with (name / model)</label>
              <Input className="h-9" title="Name or model of the replacement part" placeholder="e.g. Hunter PGP Ultra" value={schedRepairForm.replacedWithName} onChange={e => setSchedRepairForm(f => ({ ...f, replacedWithName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Parts Cost ($)</label>
                <Input type="number" step="0.01" min="0" className="h-9" title="Cost of parts used in the repair" placeholder="0.00" value={schedRepairForm.partsCost} onChange={e => setSchedRepairForm(f => ({ ...f, partsCost: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Labor Cost ($)</label>
                <Input type="number" step="0.01" min="0" className="h-9" title="Labor cost for the repair" placeholder="0.00" value={schedRepairForm.laborCost} onChange={e => setSchedRepairForm(f => ({ ...f, laborCost: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Date Performed</label>
              <Input type="date" className="h-9" title="Date the repair was performed" value={(schedRepairForm as any).performedAt ?? new Date().toISOString().slice(0, 10)} onChange={e => setSchedRepairForm(f => ({ ...f, performedAt: e.target.value } as any))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={2} title="Additional notes about this irrigation repair" placeholder="Additional notes…" value={schedRepairForm.notes} onChange={e => setSchedRepairForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRepairFormOpen(false)}>Cancel</Button>
            <Button title="Save this irrigation repair log entry" disabled={createRepairLog.isPending} onClick={() => {
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
                  performedAt: (schedRepairForm as any).performedAt ? new Date((schedRepairForm as any).performedAt).toISOString() : new Date().toISOString(),
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
            <Button variant="outline" title="Clock out without marking the job complete" onClick={() => { toast.success('Clocked out'); setClockOutJobId(null); }}>Not yet</Button>
            <Button title="Clock out and mark this job as completed" onClick={() => {
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
            <Input type="date" title="Leave blank to pause indefinitely; set a date to auto-resume the series" value={pauseResumeAt} onChange={(e) => setPauseResumeAt(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" title="Cancel without pausing this series" onClick={() => { setPauseDialogRootId(null); setPauseResumeAt(''); }}>Cancel</Button>
            <Button title="Pause this recurring job series" onClick={() => confirmPause(pauseDialogRootId!)} disabled={pauseSeries.isPending}>
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

      {/* Delete Job Confirmation */}
      <Dialog open={deleteJobPending} onOpenChange={open => { if (!open) setDeleteJobPending(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Job</DialogTitle>
            <DialogDescription>Permanently delete this job? This cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" title="Cancel without deleting this job" onClick={() => setDeleteJobPending(false)}>Cancel</Button>
            <Button
              variant="destructive"
              title="Permanently delete this job — this cannot be undone"
              disabled={deleteJob.isPending}
              onClick={() => {
                if (!selectedJobId) return;
                deleteJob.mutate({ id: selectedJobId }, {
                  onSuccess: () => {
                    toast.success('Job deleted');
                    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                    setSelectedJobId(null);
                    setDeleteJobPending(false);
                  },
                  onError: (err: any) => {
                    const status = err?.response?.status;
                    const body = err?.response?.data;
                    if (status === 409 && body?.message) {
                      setDeleteBlockedMsg(body.message);
                    } else {
                      toast.error('Failed to delete job');
                    }
                    setDeleteJobPending(false);
                  },
                });
              }}
            >
              {deleteJob.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Series Confirmation */}
      <Dialog open={cancelSeriesDialogId !== null} onOpenChange={open => { if (!open) setCancelSeriesDialogId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Series</DialogTitle>
            <DialogDescription>Cancel all future occurrences of this recurring series?</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" title="Keep this recurring series active" onClick={() => setCancelSeriesDialogId(null)}>Keep Series</Button>
            <Button
              variant="destructive"
              title="Cancel all future occurrences of this recurring job series"
              disabled={cancelSeries.isPending}
              onClick={() => {
                if (!cancelSeriesDialogId) return;
                cancelSeries.mutate({ id: cancelSeriesDialogId, params: { scope: 'forward' } }, {
                  onSuccess: () => {
                    toast.success('Series cancelled');
                    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                    qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() });
                    setCancelSeriesDialogId(null);
                    if (selectedJobId) setSelectedJobId(null);
                  },
                  onError: () => toast.error('Failed to cancel series'),
                });
              }}
            >
              {cancelSeries.isPending ? 'Cancelling…' : 'Cancel Series'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Skip Next Occurrence Confirmation */}
      <Dialog open={skipNextDialogId !== null} onOpenChange={open => { if (!open) setSkipNextDialogId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Skip Next Occurrence</DialogTitle>
            <DialogDescription>Skip the next scheduled occurrence of this series? The series will continue from the occurrence after it.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" title="Keep the next occurrence as scheduled" onClick={() => setSkipNextDialogId(null)}>Cancel</Button>
            <Button
              title="Skip the next scheduled occurrence — the series continues from the one after it"
              disabled={skipNextOccurrence.isPending}
              onClick={() => {
                if (!skipNextDialogId) return;
                skipNextOccurrence.mutate({ id: skipNextDialogId }, {
                  onSuccess: () => { toast.success('Next occurrence skipped'); qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() }); setSkipNextDialogId(null); },
                  onError: () => toast.error('Failed to skip'),
                });
              }}
            >
              {skipNextOccurrence.isPending ? 'Skipping…' : 'Skip Occurrence'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
