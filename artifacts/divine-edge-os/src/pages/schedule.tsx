import React, { useState } from 'react';
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
  useListJobMedia, getListJobMediaQueryKey,
  useListEstimates, getListEstimatesQueryKey,
  useListVisits, getListVisitsQueryKey,
  useListRecurringSeries, getListRecurringSeriesQueryKey,
  useSkipNextOccurrence,
  usePauseRecurringSeries,
  useCancelRecurringSeries,
} from '@workspace/api-client-react';
import type { RecurrenceRule } from '@workspace/api-client-react';
import MediaGallery from '@/components/media/MediaGallery';
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
  SkipForward, ListEnd,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useDebounce } from '@/hooks/use-debounce';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  eachDayOfInterval, format, isSameDay, addWeeks, subWeeks, addMonths, subMonths,
} from 'date-fns';

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

type NewJobForm = {
  title: string;
  description: string;
  scheduledAt: string;
  estimatedDuration: string;
  priority: string;
  customerId: string;
  assigneeId: string;
  recurring: boolean;
  recurrencePattern: string;
  recurrenceInterval: string;
  recurrenceDaysOfWeek: number[];
  recurrenceDayOfMonth: string;
  recurrenceWeekOfMonth: string;
  recurrenceDayOfWeek: string;
  recurrenceEndCondition: string;
  recurrenceEndAfter: string;
  recurrenceEndDate: string;
};

const EMPTY_JOB: NewJobForm = {
  title: '',
  description: '',
  scheduledAt: '',
  estimatedDuration: '',
  priority: 'normal',
  customerId: '',
  assigneeId: '',
  recurring: false,
  recurrencePattern: 'weekly',
  recurrenceInterval: '1',
  recurrenceDaysOfWeek: [],
  recurrenceDayOfMonth: '1',
  recurrenceWeekOfMonth: '1',
  recurrenceDayOfWeek: '1',
  recurrenceEndCondition: 'never',
  recurrenceEndAfter: '12',
  recurrenceEndDate: '',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildRecurrenceRule(form: NewJobForm): RecurrenceRule | undefined {
  if (!form.recurring) return undefined;
  const rule: RecurrenceRule = {
    pattern: form.recurrencePattern as RecurrenceRule['pattern'],
    endCondition: form.recurrenceEndCondition as RecurrenceRule['endCondition'],
  };
  if (['weekly', 'biweekly'].includes(form.recurrencePattern)) {
    rule.daysOfWeek = form.recurrenceDaysOfWeek;
  }
  if (form.recurrencePattern === 'biweekly') {
    rule.interval = parseInt(form.recurrenceInterval, 10) || 2;
  }
  if (form.recurrencePattern === 'custom') {
    rule.interval = parseInt(form.recurrenceInterval, 10) || 1;
  }
  if (form.recurrencePattern === 'monthly_date') {
    rule.dayOfMonth = parseInt(form.recurrenceDayOfMonth, 10) || 1;
  }
  if (form.recurrencePattern === 'monthly_weekday') {
    rule.weekOfMonth = parseInt(form.recurrenceWeekOfMonth, 10) || 1;
    rule.dayOfWeek = parseInt(form.recurrenceDayOfWeek, 10);
  }
  if (form.recurrenceEndCondition === 'after') {
    rule.endAfter = parseInt(form.recurrenceEndAfter, 10) || 12;
  }
  if (form.recurrenceEndCondition === 'on_date') {
    rule.endDate = form.recurrenceEndDate;
  }
  return rule;
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

  const assigneeId = isTechnician && user ? user.id : undefined;

  const start = view === 'week' ? startOfWeek(currentDate) : startOfMonth(currentDate);
  const end   = view === 'week' ? endOfWeek(currentDate)   : endOfMonth(currentDate);

  const { data: jobs, isLoading } = useListJobs(
    { startDate: start.toISOString(), endDate: end.toISOString(), assigneeId },
    { query: { queryKey: getListJobsQueryKey({ startDate: start.toISOString(), endDate: end.toISOString(), assigneeId }) } },
  );

  const { data: selectedJob } = useGetJob(selectedJobId!, {
    query: { enabled: selectedJobId != null, queryKey: getGetJobQueryKey(selectedJobId!) },
  });

  const { data: customers } = useListCustomers({}, {
    query: { enabled: createOpen, queryKey: getListCustomersQueryKey({}) },
  });

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

  // Recurring series hooks
  const { data: recurringSeries } = useListRecurringSeries({
    query: { enabled: view === 'series', queryKey: getListRecurringSeriesQueryKey() },
  });
  const skipNextOccurrence = useSkipNextOccurrence();
  const pauseSeries = usePauseRecurringSeries();
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
        assigneeId: newJob.assigneeId ? parseInt(newJob.assigneeId, 10) : undefined,
        recurrenceRule,
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
              {recurringSeries.map(s => (
                <div key={s.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{s.title}</span>
                      {s.isRecurrencePaused && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">Paused</Badge>}
                      <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30 bg-primary/5">
                        <RefreshCw className="w-2.5 h-2.5" />{s.recurrenceDescription}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                      {s.customerName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{s.customerName}</span>}
                      {(s.crewName || s.assigneeName) && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s.crewName ?? s.assigneeName}</span>}
                      <span>{s.completedCount} occurrences generated</span>
                      {s.nextScheduledAt && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Next: {format(new Date(s.nextScheduledAt), 'MMM d, yyyy')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
                        pauseSeries.mutate({ id: s.id, data: { paused: !s.isRecurrencePaused } }, {
                          onSuccess: () => { toast.success(s.isRecurrencePaused ? 'Series resumed' : 'Series paused'); qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() }); },
                          onError: () => toast.error('Failed to update'),
                        });
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
              ))}
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
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Title <span className="text-destructive">*</span></label>
              <Input placeholder="e.g. Irrigation system repair" value={newJob.title} onChange={e => setNewJob(f => ({ ...f, title: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Scheduled Date & Time <span className="text-destructive">*</span></label>
              <Input type="datetime-local" value={newJob.scheduledAt} onChange={e => setNewJob(f => ({ ...f, scheduledAt: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Duration ({durationUnit})</label>
                <Input
                  type="number"
                  min={0}
                  step={durationUnit === 'hours' ? 0.5 : 15}
                  placeholder={durationUnit === 'hours' ? '1.5' : '90'}
                  value={newJob.estimatedDuration}
                  onChange={e => setNewJob(f => ({ ...f, estimatedDuration: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Priority</label>
                <Select value={newJob.priority} onValueChange={v => setNewJob(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Customer</label>
              <Select value={newJob.customerId} onValueChange={v => setNewJob(f => ({ ...f, customerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
                <SelectContent>
                  {(customers?.items ?? []).map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Assign To</label>
              <Select value={newJob.assigneeId} onValueChange={v => setNewJob(f => ({ ...f, assigneeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select technician..." /></SelectTrigger>
                <SelectContent>
                  {(users ?? [])
                    .filter(u => u.role === 'technician' || u.role === 'crew_manager')
                    .map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.role.replace(/_/g, ' ')})</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="Job details, special instructions..."
                rows={3}
                value={newJob.description}
                onChange={e => setNewJob(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* Recurrence */}
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 text-primary" /> Make Recurring</label>
                  <p className="text-xs text-muted-foreground">Auto-generate future job instances on a schedule.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewJob(f => ({ ...f, recurring: !f.recurring }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${newJob.recurring ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${newJob.recurring ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {newJob.recurring && (
                <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                  {/* Pattern */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pattern</label>
                    <Select value={newJob.recurrencePattern} onValueChange={v => setNewJob(f => ({ ...f, recurrencePattern: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly (pick days)</SelectItem>
                        <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                        <SelectItem value="monthly_date">Monthly by date</SelectItem>
                        <SelectItem value="monthly_weekday">Monthly by weekday</SelectItem>
                        <SelectItem value="custom">Custom interval (every N days)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Days of week (weekly / biweekly) */}
                  {['weekly', 'biweekly'].includes(newJob.recurrencePattern) && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Days of Week</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {DAY_LABELS.map((d, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setNewJob(f => {
                              const cur = f.recurrenceDaysOfWeek;
                              return { ...f, recurrenceDaysOfWeek: cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i] };
                            })}
                            className={`w-9 h-9 rounded-md text-xs font-medium border transition-colors ${newJob.recurrenceDaysOfWeek.includes(i) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted border-border'}`}
                          >{d}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Monthly by date */}
                  {newJob.recurrencePattern === 'monthly_date' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Day of Month</label>
                      <Input type="number" min={1} max={31} className="h-8 text-sm" value={newJob.recurrenceDayOfMonth} onChange={e => setNewJob(f => ({ ...f, recurrenceDayOfMonth: e.target.value }))} />
                    </div>
                  )}

                  {/* Monthly by weekday */}
                  {newJob.recurrencePattern === 'monthly_weekday' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Week</label>
                        <Select value={newJob.recurrenceWeekOfMonth} onValueChange={v => setNewJob(f => ({ ...f, recurrenceWeekOfMonth: v }))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">First</SelectItem>
                            <SelectItem value="2">Second</SelectItem>
                            <SelectItem value="3">Third</SelectItem>
                            <SelectItem value="4">Fourth</SelectItem>
                            <SelectItem value="5">Last</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Day</label>
                        <Select value={newJob.recurrenceDayOfWeek} onValueChange={v => setNewJob(f => ({ ...f, recurrenceDayOfWeek: v }))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DAY_LABELS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {/* Custom interval */}
                  {newJob.recurrencePattern === 'custom' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Every N Days</label>
                      <Input type="number" min={1} className="h-8 text-sm" value={newJob.recurrenceInterval} onChange={e => setNewJob(f => ({ ...f, recurrenceInterval: e.target.value }))} />
                    </div>
                  )}

                  {/* End condition */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ends</label>
                    <Select value={newJob.recurrenceEndCondition} onValueChange={v => setNewJob(f => ({ ...f, recurrenceEndCondition: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">Never</SelectItem>
                        <SelectItem value="after">After N occurrences</SelectItem>
                        <SelectItem value="on_date">On a date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newJob.recurrenceEndCondition === 'after' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Number of Occurrences</label>
                      <Input type="number" min={1} className="h-8 text-sm" value={newJob.recurrenceEndAfter} onChange={e => setNewJob(f => ({ ...f, recurrenceEndAfter: e.target.value }))} />
                    </div>
                  )}
                  {newJob.recurrenceEndCondition === 'on_date' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">End Date</label>
                      <Input type="date" className="h-8 text-sm" value={newJob.recurrenceEndDate} onChange={e => setNewJob(f => ({ ...f, recurrenceEndDate: e.target.value }))} />
                    </div>
                  )}
                </div>
              )}
            </div>

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
                  <Badge className={`shrink-0 capitalize ${STATUS_COLORS[selectedJob.status] ?? ''}`} variant="outline">
                    {selectedJob.status.replace('_', ' ')}
                  </Badge>
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
                          pauseSeries.mutate({ id: rootId, data: { paused: !isPaused } }, {
                            onSuccess: () => {
                              toast.success(isPaused ? 'Series resumed' : 'Series paused');
                              qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId!) });
                              qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() });
                            },
                            onError: () => toast.error('Failed to update'),
                          });
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
    </div>
  );
}
