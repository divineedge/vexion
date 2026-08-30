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
  useListSubTimers, getListSubTimersQueryKey,
  useStartSubTimer, useStopSubTimer,
  useDeleteJob,
  useListRouteTemplates, getListRouteTemplatesQueryKey,
  useUpdateJobRoute,
  useListProperties, getListPropertiesQueryKey,
  useListCustomerPlans, getListCustomerPlansQueryKey,
  useListCrews, getListCrewsQueryKey,
  useListTags, getListTagsQueryKey,
  useListSkipReasons, getListSkipReasonsQueryKey,
  useCompleteAndInvoiceJob, useUpdateInvoice,
  useListJobMessages, getListJobMessagesQueryKey,
  listJobMessages,
  useCreateJobMessage,
  useGetJobMessagesUnreadSummary, getGetJobMessagesUnreadSummaryQueryKey,
  useListJobEquipmentUses, getListJobEquipmentUsesQueryKey,
  useCreateJobEquipmentUse, useDeleteJobEquipmentUse,
  useListEquipment, getListEquipmentQueryKey,
  useListJobRequests, getListJobRequestsQueryKey,
  useApproveJobRequest, useRejectJobRequest, useRequestJobRequestClarification,
  useListStaffMessageThreads, getListStaffMessageThreadsQueryKey,
  useListStaffMessages, getListStaffMessagesQueryKey,
  listStaffMessages,
  useCreateStaffMessage,
  type JobMessage,
  type StaffMessage,
} from '@workspace/api-client-react';
import { useMutation } from '@tanstack/react-query';
import MediaGallery from '@/components/media/MediaGallery';
import { StaffNotesPanel } from '@/components/StaffNotesPanel';
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
  SkipForward, ListEnd, Square, Timer, Warehouse, Truck, Wrench,
  Route as RouteIcon, ExternalLink, PhoneCall, CheckCircle, FileText, Phone, Mail, Copy,
  Ban, CreditCard, CalendarSearch, MessageSquare,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useDebounce } from '@/hooks/use-debounce';
import { hasEarlierMessagePage, mergeMessagePages, messageBeforeId } from '@/lib/messagePagination';
import { normalizeChemicalRecordRequirements, type ChemicalRequirementKey } from '@/lib/chemicalRequirements';
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

const EMPTY_CHEMICAL_FORM = {
  mixtureId: '',
  productId: '',
  volumeApplied: '',
  volumeUnit: 'gal',
  treatedArea: '',
  areaUnit: 'sqft',
  treatedZoneName: '',
  targetPest: '',
  applicationMethod: '',
  windSpeed: '',
  windDirection: '',
  temperature: '',
  appliedAt: '',
  applicatorName: '',
  applicatorLicenseNumber: '',
  notes: '',
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
  const { user, isTechnician, canManageJobs, canManageOffice } = useAuth();
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
  const [partQtys, setPartQtys] = useState<Record<number, string>>({});

  const [suppliesSearch, setSuppliesSearch] = useState('');
  const debouncedSuppliesSearch = useDebounce(suppliesSearch, 300);
  const [addingSupply, setAddingSupply] = useState(false);
  const [supplyQtys, setSupplyQtys] = useState<Record<number, string>>({});
  const [chemFormOpen, setChemFormOpen] = useState(false);
  const [chemForm, setChemForm] = useState({ ...EMPTY_CHEMICAL_FORM });
  const [chemFormErrors, setChemFormErrors] = useState<Record<string, string>>({});


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

  const start = view === 'week' ? startOfWeek(currentDate, { weekStartsOn: 1 }) : startOfMonth(currentDate);
  const end   = view === 'week' ? endOfWeek(currentDate, { weekStartsOn: 1 })   : endOfMonth(currentDate);

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
  const chemicalRequirements = normalizeChemicalRecordRequirements(settings?.chemicalRecordRequirements);
  const chemicalFieldIsRequired = (key: ChemicalRequirementKey) => chemicalRequirements[key];

  const validateChemicalForm = (): boolean => {
    const errors: Record<string, string> = {};
    const selectedMixture = chemForm.mixtureId && chemForm.mixtureId !== 'none';
    if ((!selectedMixture && !chemForm.productId) || (selectedMixture && chemForm.productId)) {
      errors.productOrMixture = 'Select one product or tank mixture';
    }
    const volume = Number(chemForm.volumeApplied);
    if (!Number.isFinite(volume) || volume <= 0) errors.volumeApplied = 'Enter a positive amount';
    if (!chemForm.volumeUnit.trim()) errors.volumeUnit = 'Select an amount unit';
    if (!chemForm.appliedAt || Number.isNaN(new Date(chemForm.appliedAt).getTime())) errors.appliedAt = 'Enter a valid application date and time';

    if (chemForm.treatedArea && (!Number.isFinite(Number(chemForm.treatedArea)) || Number(chemForm.treatedArea) <= 0)) {
      errors.treatedArea = 'Treated area must be a positive number';
    } else if (chemicalRequirements.treatedArea && !chemForm.treatedArea) {
      errors.treatedArea = 'Treated area is required';
    }
    if (chemicalRequirements.treatedZoneName && !chemForm.treatedZoneName.trim()) errors.treatedZoneName = 'Treated zone or location is required';
    if (chemicalRequirements.targetPest && !chemForm.targetPest.trim()) errors.targetPest = 'Target pest or weed is required';
    if (chemicalRequirements.applicationMethod && !chemForm.applicationMethod) errors.applicationMethod = 'Application method is required';
    if (chemForm.windSpeed && (!Number.isFinite(Number(chemForm.windSpeed)) || Number(chemForm.windSpeed) < 0)) {
      errors.windSpeed = 'Wind speed must be zero or greater';
    } else if (chemicalRequirements.windSpeed && !chemForm.windSpeed) {
      errors.windSpeed = 'Wind speed is required';
    }
    if (chemicalRequirements.windDirection && !chemForm.windDirection) errors.windDirection = 'Wind direction is required';
    if (chemForm.temperature && !Number.isFinite(Number(chemForm.temperature))) {
      errors.temperature = 'Enter a valid temperature';
    } else if (chemicalRequirements.temperature && !chemForm.temperature) {
      errors.temperature = 'Temperature is required';
    }
    if (chemicalRequirements.applicatorName && !chemForm.applicatorName.trim()) errors.applicatorName = 'Applicator name is required';
    if (chemicalRequirements.applicatorLicenseNumber && !chemForm.applicatorLicenseNumber.trim()) errors.applicatorLicenseNumber = 'Applicator license number is required';
    if (chemicalRequirements.notes && !chemForm.notes.trim()) errors.notes = 'Notes are required';

    setChemFormErrors(errors);
    if (Object.keys(errors).length > 0) toast.error('Complete all required chemical information');
    return Object.keys(errors).length === 0;
  };

  // Sync the create-job form's duration unit to the tenant default.
  // Use a ref so we only auto-apply the setting once per open session and never
  // overwrite a deliberate unit selection the user has already made.
  const syncedCreateDurationUnit = React.useRef(false);
  useEffect(() => {
    if (createOpen) {
      syncedCreateDurationUnit.current = false; // arm for this session
      if (settings?.durationUnit) {
        setNewJob(j => ({ ...j, estimatedDurationUnit: settings.durationUnit as 'minutes' | 'hours' }));
        syncedCreateDurationUnit.current = true;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen]);
  // Handle settings loading after the form is already open.
  useEffect(() => {
    if (createOpen && settings?.durationUnit && !syncedCreateDurationUnit.current) {
      setNewJob(j => ({ ...j, estimatedDurationUnit: settings.durationUnit as 'minutes' | 'hours' }));
      syncedCreateDurationUnit.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.durationUnit]);

  const updateJob = useUpdateJob();
  const createJob = useCreateJob();
  const canReviewJobRequests = canManageJobs || canManageOffice;
  const { data: jobRequests = [] } = useListJobRequests({
    query: { enabled: canReviewJobRequests, queryKey: getListJobRequestsQueryKey() },
  });
  const approveJobRequest = useApproveJobRequest();
  const rejectJobRequest = useRejectJobRequest();
  const requestJobRequestClarification = useRequestJobRequestClarification();
  const refreshJobRequests = () => {
    qc.invalidateQueries({ queryKey: getListJobRequestsQueryKey() });
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
  };
  const respondToJobRequest = (id: number, action: 'reject' | 'clarify') => {
    const adminResponse = window.prompt(action === 'reject' ? 'Reason for declining this request:' : 'What information is needed?')?.trim();
    if (!adminResponse) return;
    const mutation = action === 'reject' ? rejectJobRequest : requestJobRequestClarification;
    mutation.mutate({ id, data: { adminResponse, idempotencyKey: `${action}-${id}-${Date.now()}` } }, {
      onSuccess: () => { refreshJobRequests(); toast.success(action === 'reject' ? 'Job request declined' : 'Clarification requested'); },
      onError: () => toast.error('Could not update job request'),
    });
  };

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
  const approveJobCancellation = useMutation({
    mutationFn: ({ id, reply }: { id: number; reply?: string }) =>
      customFetch<void>(`/api/jobs/${id}/approve-cancellation`, { method: 'POST', body: JSON.stringify({ reply }) }),
  });
  const denyJobCancellation = useMutation({
    mutationFn: ({ id, reply }: { id: number; reply?: string }) =>
      customFetch<void>(`/api/jobs/${id}/deny-cancellation`, { method: 'POST', body: JSON.stringify({ reply }) }),
  });
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [denyReply, setDenyReply] = useState('');
  const [cancelApproveOpen, setCancelApproveOpen] = useState(false);
  // Inline duration editing on job detail sheet
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationEditVal, setDurationEditVal] = useState('');
  const [durationEditUnit, setDurationEditUnit] = useState<'minutes' | 'hours'>('minutes');
  // Reset the editor whenever a different job is selected or the sheet closes,
  // so a draft from job A can never be saved onto job B.
  useEffect(() => {
    setEditingDuration(false);
    setDurationEditVal('');
    setDurationEditUnit('minutes');
  }, [selectedJobId]);
  const [cancelApproveReply, setCancelApproveReply] = useState('');
  const approveReschedule = useMutation({
    mutationFn: ({ id, approvedDate, reply }: { id: number; approvedDate?: string; reply?: string }) =>
      customFetch<void>(`/api/jobs/${id}/approve-reschedule`, { method: 'POST', body: JSON.stringify({ approvedDate, reply }) }),
  });
  const [rescheduleApproveOpen, setRescheduleApproveOpen] = useState(false);
  const [rescheduleApproveDate, setRescheduleApproveDate] = useState('');
  const [rescheduleApproveReply, setRescheduleApproveReply] = useState('');
  const [rescheduleDeclineOpen, setRescheduleDeclineOpen] = useState(false);
  const [rescheduleDeclineReply, setRescheduleDeclineReply] = useState('');
  const dismissRescheduleRequest = useMutation({
    mutationFn: ({ id, reply }: { id: number; reply?: string }) =>
      customFetch<void>(`/api/jobs/${id}/dismiss-reschedule-request`, { method: 'POST', body: JSON.stringify({ reply }) }),
  });
  const completeAndInvoiceJob = useCompleteAndInvoiceJob();
  const updateInvoice = useUpdateInvoice();

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
  const [skipReasonId, setSkipReasonId] = useState<number | null>(null);
  const [skipNote, setSkipNote] = useState('');
  const [deleteJobPending, setDeleteJobPending] = useState(false);

  // ── Job equipment hours ───────────────────────────────────────────────────
  const [addingEquipHours, setAddingEquipHours] = useState(false);
  const [equipHoursForm, setEquipHoursForm] = useState({ equipmentName: '', equipmentId: '' as string | number, hoursUsed: '', notes: '' });

  // ── Skip fee ──────────────────────────────────────────────────────────────
  const [skipFee, setSkipFee] = useState('');
  const [skipFeeType, setSkipFeeType] = useState<'flat' | 'percent' | 'both'>('flat');
  const [skipFeePercent, setSkipFeePercent] = useState('');

  // ── Waitlist ──────────────────────────────────────────────────────────────
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [completeInvoiceOpen, setCompleteInvoiceOpen] = useState(false);
  const [completeInvoiceStep, setCompleteInvoiceStep] = useState<'review' | 'pay'>('review');
  const [onSitePaymentMethod, setOnSitePaymentMethod] = useState('cash');
  const [createdInvoiceId, setCreatedInvoiceId] = useState<number | null>(null);
  const [createdInvoiceTotal, setCreatedInvoiceTotal] = useState(0);
  const [pauseResumeAt, setPauseResumeAt] = useState('');

  // ── Job messages ─────────────────────────────────────────────────────────
  const [msgInput, setMsgInput] = useState('');
  const msgEndRef = React.useRef<HTMLDivElement>(null);
  const [staffInboxOpen, setStaffInboxOpen] = useState(false);
  const [staffThreadId, setStaffThreadId] = useState<number | null>(null);
  const [staffMsgInput, setStaffMsgInput] = useState('');
  const [staffOlderPages, setStaffOlderPages] = useState<StaffMessage[][]>([]);
  const [staffNewestHistory, setStaffNewestHistory] = useState<StaffMessage[]>([]);
  const [staffEarlierLoading, setStaffEarlierLoading] = useState(false);
  const [staffEarlierError, setStaffEarlierError] = useState('');
  const { data: staffThreads = [], isLoading: staffThreadsLoading } = useListStaffMessageThreads({
    query: { enabled: canManageOffice && staffInboxOpen, queryKey: getListStaffMessageThreadsQueryKey(), refetchInterval: canManageOffice && staffInboxOpen ? 30000 : false },
  });
  const { data: staffThreadMessages = [], refetch: refetchStaffThread } = useListStaffMessages(staffThreadId ?? 0, {
    limit: 100,
  }, {
    query: { enabled: canManageOffice && staffInboxOpen && staffThreadId != null, queryKey: getListStaffMessagesQueryKey(staffThreadId ?? 0, { limit: 100 }), refetchInterval: canManageOffice && staffInboxOpen && staffThreadId != null ? 30000 : false },
  });
  const createStaffMessage = useCreateStaffMessage();
  const allStaffThreadMessages = React.useMemo(
    () => mergeMessagePages(staffThreadMessages, [...staffOlderPages, staffNewestHistory]),
    [staffThreadMessages, staffOlderPages, staffNewestHistory],
  );
  const canLoadEarlierStaff = hasEarlierMessagePage(staffThreadMessages, staffOlderPages);

  // Unread summary for job card badges — fetch once when schedule loads
  const { data: unreadSummaryRaw, refetch: refetchUnreadSummary } = useGetJobMessagesUnreadSummary({
    query: { queryKey: getGetJobMessagesUnreadSummaryQueryKey(), refetchInterval: 30000 },
  });
  const unreadByJob = React.useMemo<Map<number, number>>(() => {
    const m = new Map<number, number>();
    (unreadSummaryRaw ?? []).forEach(item => m.set(item.jobId, item.count));
    return m;
  }, [unreadSummaryRaw]);

  // Messages for the currently-open job drawer — poll every 15 s while open
  const { data: jobMessages = [], refetch: refetchMessages } = useListJobMessages(
    selectedJobId!,
    { limit: 100 },
    { query: { enabled: selectedJobId != null, queryKey: getListJobMessagesQueryKey(selectedJobId ?? 0, { limit: 100 }), refetchInterval: selectedJobId != null ? 30000 : false } },
  );
  const createJobMessage = useCreateJobMessage();
  const [jobOlderPages, setJobOlderPages] = useState<JobMessage[][]>([]);
  const [jobNewestHistory, setJobNewestHistory] = useState<JobMessage[]>([]);
  const [jobEarlierLoading, setJobEarlierLoading] = useState(false);
  const [jobEarlierError, setJobEarlierError] = useState('');
  const allJobMessages = React.useMemo(
    () => mergeMessagePages(jobMessages, [...jobOlderPages, jobNewestHistory]),
    [jobMessages, jobOlderPages, jobNewestHistory],
  );
  const canLoadEarlierJob = hasEarlierMessagePage(jobMessages, jobOlderPages);

  useEffect(() => {
    setJobOlderPages([]);
    setJobNewestHistory([]);
    setJobEarlierError('');
    setJobEarlierLoading(false);
  }, [selectedJobId, user?.id, user?.tenantId]);
  useEffect(() => {
    setStaffOlderPages([]);
    setStaffNewestHistory([]);
    setStaffEarlierError('');
    setStaffEarlierLoading(false);
  }, [staffThreadId, staffInboxOpen, user?.id, user?.tenantId]);
  useEffect(() => {
    if (jobMessages.length) setJobNewestHistory(current => mergeMessagePages(jobMessages, [current]));
  }, [jobMessages]);
  useEffect(() => {
    if (staffThreadMessages.length) setStaffNewestHistory(current => mergeMessagePages(staffThreadMessages, [current]));
  }, [staffThreadMessages]);

  async function loadEarlierJobMessages() {
    const beforeId = messageBeforeId(allJobMessages);
    if (!selectedJobId || !beforeId || jobEarlierLoading) return;
    setJobEarlierLoading(true);
    setJobEarlierError('');
    try {
      const page = await listJobMessages(selectedJobId, { limit: 100, beforeId });
      setJobOlderPages(current => [...current, page]);
      await qc.invalidateQueries({ queryKey: getGetJobMessagesUnreadSummaryQueryKey() });
    } catch {
      setJobEarlierError('Could not load earlier messages.');
    } finally {
      setJobEarlierLoading(false);
    }
  }

  async function loadEarlierStaffMessages() {
    const beforeId = messageBeforeId(allStaffThreadMessages);
    if (staffThreadId == null || !beforeId || staffEarlierLoading) return;
    setStaffEarlierLoading(true);
    setStaffEarlierError('');
    try {
      const page = await listStaffMessages(staffThreadId, { limit: 100, beforeId });
      setStaffOlderPages(current => [...current, page]);
      await qc.invalidateQueries({ queryKey: getListStaffMessageThreadsQueryKey() });
    } catch {
      setStaffEarlierError('Could not load earlier messages.');
    } finally {
      setStaffEarlierLoading(false);
    }
  }

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [jobMessages.length]);

  // Clear input when switching jobs
  React.useEffect(() => { setMsgInput(''); }, [selectedJobId]);

  // ── Job equipment hours ───────────────────────────────────────────────────
  const { data: jobEquipUses = [], refetch: refetchEquipUses } = useListJobEquipmentUses(
    selectedJobId!,
    { query: { enabled: selectedJobId != null, queryKey: getListJobEquipmentUsesQueryKey(selectedJobId ?? 0) } },
  );
  const createEquipUse = useCreateJobEquipmentUse();
  const deleteEquipUse = useDeleteJobEquipmentUse();

  // Equipment list for the picker in the equipment-hours form
  const { data: allEquipment = [] } = useListEquipment(
    {},
    { query: { queryKey: getListEquipmentQueryKey(), staleTime: 120000 } },
  );

  function handleAddEquipHours() {
    if (!selectedJobId || !equipHoursForm.equipmentName.trim() || !equipHoursForm.hoursUsed) return;
    const hours = parseFloat(equipHoursForm.hoursUsed);
    if (isNaN(hours) || hours <= 0) { toast.error('Enter a valid number of hours'); return; }
    const equipId = typeof equipHoursForm.equipmentId === 'number'
      ? equipHoursForm.equipmentId
      : equipHoursForm.equipmentId ? parseInt(equipHoursForm.equipmentId as string, 10) : undefined;
    createEquipUse.mutate(
      {
        jobId: selectedJobId,
        data: {
          equipmentName: equipHoursForm.equipmentName.trim(),
          hoursUsed: hours,
          ...(equipId && !isNaN(equipId) ? { equipmentId: equipId } : {}),
          ...(equipHoursForm.notes.trim() ? { notes: equipHoursForm.notes.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Equipment hours logged');
          setEquipHoursForm({ equipmentName: '', equipmentId: '', hoursUsed: '', notes: '' });
          setAddingEquipHours(false);
          refetchEquipUses();
        },
        onError: () => toast.error('Failed to log equipment hours'),
      },
    );
  }

  // ── Waitlist ──────────────────────────────────────────────────────────────
  const { data: waitlistJobs = [], refetch: refetchWaitlist } = useListJobs(
    { status: 'waitlist' },
    { query: { enabled: waitlistOpen, queryKey: ['jobs', 'waitlist'] } },
  );

  function handleSendMessage() {
    const body = msgInput.trim();
    if (!body || !selectedJobId || createJobMessage.isPending) return;
    createJobMessage.mutate(
      { jobId: selectedJobId, data: { body, clientMessageId: crypto.randomUUID() } },
      {
        onSuccess: () => {
          setMsgInput('');
          refetchMessages();
          refetchUnreadSummary();
          qc.invalidateQueries({ queryKey: getGetJobMessagesUnreadSummaryQueryKey() });
        },
        onError: () => toast.error('Failed to send message'),
      },
    );
  }

  function handleSendStaffMessage() {
    const body = staffMsgInput.trim();
    if (!body || staffThreadId == null || createStaffMessage.isPending) return;
    createStaffMessage.mutate({ threadUserId: staffThreadId, data: { body, clientMessageId: crypto.randomUUID() } }, {
      onSuccess: () => {
        setStaffMsgInput('');
        refetchStaffThread();
        qc.invalidateQueries({ queryKey: getListStaffMessageThreadsQueryKey() });
      },
      onError: () => toast.error('Failed to send staff message'),
    });
  }

  const { data: bizTags = [] } = useListTags({ query: { queryKey: getListTagsQueryKey() } });
  const { data: skipReasons = [] } = useListSkipReasons({ query: { queryKey: getListSkipReasonsQueryKey() } });

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
  const { data: supplyInventoryItems } = useListInventoryItems(
    { q: debouncedSuppliesSearch || undefined },
    { query: { enabled: addingSupply, queryKey: getListInventoryItemsQueryKey({ q: debouncedSuppliesSearch || undefined }) } }
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

  const [noCardJobWarning, setNoCardJobWarning] = useState(false);

  const doCreateJob = () => {
    const durationMins = newJob.estimatedDuration
      ? newJob.estimatedDurationUnit === 'hours'
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
        tags: newJob.tags.length ? newJob.tags : undefined,
        ...(newJob.offSeasonEnabled ? { offSeasonStart: newJob.offSeasonStart, offSeasonEnd: newJob.offSeasonEnd } : {}),
      } as any,
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

  const handleCreateJob = () => {
    if (!newJob.title || !newJob.scheduledAt) {
      toast.error('Title and scheduled date are required');
      return;
    }
    // Soft gate: warn if customer has no card on file (unless alert is silenced)
    if (newJob.customerId) {
      const cust = (customers?.items ?? []).find(c => String(c.id) === String(newJob.customerId));
      if (cust && !(cust as any).hasPaymentMethod && !(cust as any).noCardAlertSilenced) {
        setNoCardJobWarning(true);
        return;
      }
    }
    doCreateJob();
  };

  const formatDuration = (mins: number | null | undefined) => {
    if (!mins) return null;
    if (durationUnit === 'hours') return `${(mins / 60).toFixed(1)} hr`;
    return `${mins} min`;
  };

  // No-card warning Dialog (soft gate on job creation)
  const noCardWarningCustomer = noCardJobWarning && newJob.customerId
    ? (customers?.items ?? []).find(c => String(c.id) === String(newJob.customerId))
    : null;

  return (
    <div className="space-y-6 h-full flex flex-col animate-in fade-in duration-500">
      {/* No-card warning */}
      <Dialog open={noCardJobWarning} onOpenChange={open => { if (!open) setNoCardJobWarning(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              No Payment Method on File
            </DialogTitle>
            <DialogDescription>
              <span className="font-medium">{noCardWarningCustomer?.name ?? 'This customer'}</span> does not have a saved payment method.
              Add a card on their customer page before scheduling to ensure smooth billing.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setNoCardJobWarning(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => { setNoCardJobWarning(false); doCreateJob(); }}>
              Schedule Anyway
            </Button>
            {noCardWarningCustomer && (
              <Button onClick={() => {
                setNoCardJobWarning(false);
                setCreateOpen(false);
                setLocation(`/customers/${noCardWarningCustomer.id}`);
              }}>
                Go to Customer
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex flex-col gap-3 shrink-0">
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
        <div className="flex flex-wrap items-center gap-2 w-full rounded-lg border bg-muted/20 p-2">
          {canManageOffice && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs px-3 gap-1.5"
              onClick={() => setStaffInboxOpen(true)}
              data-testid="button-open-staff-messages"
            >
              <MessageSquare className="w-3.5 h-3.5" /> Staff Messages
            </Button>
          )}
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
          <Button
            variant={waitlistOpen ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs px-3 gap-1.5 order-first shrink-0"
            onClick={() => setWaitlistOpen(v => !v)}
            title="View and manage the job waitlist"
          >
            <ListEnd className="w-3 h-3" /> Waitlist
            {waitlistJobs.length > 0 && (
              <span className="ml-1 bg-amber-500 text-white rounded-full text-[10px] w-4 h-4 flex items-center justify-center font-bold shrink-0">{waitlistJobs.length > 99 ? '99+' : waitlistJobs.length}</span>
            )}
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
          <div className="flex items-center rounded-md border p-1 bg-background shadow-sm order-first shrink-0" role="group" aria-label="Calendar view">
            <Button variant={view === 'week' ? 'secondary' : 'ghost'} size="sm" title="Weekly calendar view" aria-label="Show weekly schedule" onClick={() => setView('week')} className="h-8 text-xs px-3 font-medium">Week</Button>
            <Button variant={view === 'month' ? 'secondary' : 'ghost'} size="sm" title="Monthly calendar view" aria-label="Show monthly schedule" onClick={() => setView('month')} className="h-8 text-xs px-3 font-medium">Month</Button>
            <Button variant={view === 'series' ? 'secondary' : 'ghost'} size="sm" title="Recurring visit series view" aria-label="Show recurring series" onClick={() => setView('series')} className="h-8 text-xs px-3 gap-1 font-medium"><RefreshCw className="w-3 h-3" />Series</Button>
          </div>
          <div className="flex items-center gap-2 order-first shrink-0 ml-auto">
            <Button variant="outline" size="sm" className="h-8 text-xs px-3" title="Jump to today" onClick={() => setCurrentDate(new Date())}>Today</Button>
            <Button variant="outline" size="icon" title={`Previous ${view === 'week' ? 'week' : 'month'}`} onClick={prevRange}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="min-w-[190px] text-center font-medium text-sm" aria-live="polite">
              {view === 'week' ? `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}` : view === 'month' ? format(currentDate, 'MMMM yyyy') : 'Recurring series'}
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
      {canReviewJobRequests && jobRequests.filter(request => request.status === 'pending' || request.status === 'clarification_requested').length > 0 && (
        <Card className="shrink-0 border-amber-200 bg-amber-50/40">
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-amber-700" />
              <h2 className="font-semibold text-sm">Pending job requests</h2>
            </div>
            {jobRequests.filter(request => request.status === 'pending' || request.status === 'clarification_requested').map(request => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
                <div className="text-sm">
                  <span className="font-medium">{request.requesterName ?? 'Staff member'}</span>
                  <span className="text-muted-foreground"> requested {request.serviceName ?? 'a job'} · {request.customerName ?? 'No customer'}{request.propertyAddress ? ` · ${request.propertyAddress}` : ''}</span>
                  <div className="text-xs text-muted-foreground mt-1">{format(new Date(request.requestedStartDate), 'PPp')}{request.notes ? ` — ${request.notes}` : ''}</div>
                  {request.adminResponse && <div className="text-xs mt-1">Previous response: {request.adminResponse}</div>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => {
                    const scheduledAt = window.prompt('Final scheduled date/time (ISO format):', request.requestedStartDate);
                    if (!scheduledAt) return;
                    approveJobRequest.mutate({ id: request.id, data: { scheduledAt } }, { onSuccess: () => { refreshJobRequests(); toast.success('Job request approved and scheduled'); }, onError: () => toast.error('Could not approve job request') });
                  }} disabled={approveJobRequest.isPending}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => respondToJobRequest(request.id, 'clarify')}>Clarify</Button>
                  <Button size="sm" variant="destructive" onClick={() => respondToJobRequest(request.id, 'reject')}>Decline</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

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
                      onClick={() => { setSkipNextDialogId(s.id); setSkipReasonId(null); setSkipNote(''); }}
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
                          {(job as any).cancellationRequestedAt && (
                            <div className="mt-0.5 flex items-center gap-1 text-red-700 bg-red-50 rounded px-1 py-0.5 w-fit" title="Customer requested cancellation">
                              <Ban className="w-2.5 h-2.5 shrink-0" />
                              <span className="text-[10px] font-medium">Cancel requested</span>
                            </div>
                          )}
                          {(job as any).rescheduleRequestedAt && (
                            <div className="mt-0.5 flex items-center gap-1 text-amber-700 bg-amber-50 rounded px-1 py-0.5 w-fit" title="Customer requested reschedule">
                              <CalendarSearch className="w-2.5 h-2.5 shrink-0" />
                              <span className="text-[10px] font-medium">Reschedule requested</span>
                            </div>
                          )}
                          {((job as any).customerNotes || (job as any).propertyNotes) && (
                            <div className="mt-0.5 flex items-center gap-1 text-blue-700 bg-blue-50 rounded px-1 py-0.5 w-fit" title={(job as any).customerNotes || (job as any).propertyNotes}>
                              <Bell className="w-2.5 h-2.5 shrink-0" />
                              <span className="text-[10px] font-medium">Notes</span>
                            </div>
                          )}
                          {(unreadByJob.get(job.id) ?? 0) > 0 && (
                            <div className="mt-0.5 flex items-center gap-1 text-violet-700 bg-violet-50 rounded px-1 py-0.5 w-fit" title={`${unreadByJob.get(job.id)} unread staff message${(unreadByJob.get(job.id) ?? 0) > 1 ? 's' : ''}`}>
                              <MessageSquare className="w-2.5 h-2.5 shrink-0" />
                              <span className="text-[10px] font-medium">{unreadByJob.get(job.id)} msg</span>
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
              defaultOffSeasonStart={settings?.defaultOffSeasonStart}
              defaultOffSeasonEnd={settings?.defaultOffSeasonEnd}
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
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <Badge className={`capitalize ${STATUS_COLORS[selectedJob.status] ?? ''}`} variant="outline" title={`Job status: ${selectedJob.status.replace('_', ' ')}`}>
                      {selectedJob.status.replace('_', ' ')}
                    </Badge>
                    {(selectedJob as any).cancellationRequestedAt && (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-xs gap-1" title="Customer requested cancellation via portal">
                        <Ban className="w-3 h-3" /> Cancel Requested
                      </Badge>
                    )}
                    {(selectedJob as any).rescheduleRequestedAt && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-xs gap-1" title="Customer requested reschedule via portal">
                        <CalendarSearch className="w-3 h-3" /> Reschedule Requested
                      </Badge>
                    )}
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
                {/* ── Time on Job (pinned to top for field use) ── */}
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

                {/* Total logged time + budget gauge */}
                {(() => {
                  const jobTimers = (subTimers ?? []).filter((t: any) => t.jobId === selectedJobId);
                  const totalSec = jobTimers.reduce((s: number, t: any) => {
                    if (!t.startedAt) return s;
                    const end = t.stoppedAt ? new Date(t.stoppedAt).getTime() : Date.now();
                    return s + Math.floor((end - new Date(t.startedAt).getTime()) / 1000);
                  }, 0);
                  const hrs = Math.floor(totalSec / 3600);
                  const mins = Math.floor((totalSec % 3600) / 60);
                  if (jobTimers.length === 0 && !selectedJob.estimatedDuration) return null;
                  return (
                    <div className="space-y-2">
                      {jobTimers.length > 0 && (
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
                      )}
                      {selectedJob.estimatedDuration != null && (() => {
                        const budgetSec = selectedJob.estimatedDuration * 60;
                        const pct = Math.min(100, budgetSec > 0 ? Math.round((totalSec / budgetSec) * 100) : 0);
                        const isOver = totalSec > budgetSec;
                        const isNear = !isOver && pct >= 85;
                        return (
                          <div className="space-y-1" title={isOver ? 'Over budget' : isNear ? 'Approaching budget limit' : 'Within budget'}>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Budget ({formatDuration(selectedJob.estimatedDuration)})</span>
                              <span className={isOver ? 'text-red-600 font-medium' : isNear ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>
                                {isOver ? `Over by ${Math.floor((totalSec - budgetSec) / 60)}m` : `${pct}% used`}
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${isOver ? 'bg-red-500' : isNear ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                <Separator />

                {/* Reschedule request banner */}
                {/* Reschedule request banner — pending */}
                {canManageJobs && (selectedJob as any).rescheduleRequestedAt && (!((selectedJob as any).rescheduleRequestStatus) || (selectedJob as any).rescheduleRequestStatus === 'pending') && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
                      <CalendarSearch className="w-4 h-4" /> Reschedule Requested by Customer
                    </p>
                    {(selectedJob as any).reschedulePreferredDate && (
                      <p className="text-xs text-amber-700 bg-amber-100 rounded px-2 py-1">
                        Preferred new date: <strong>{(selectedJob as any).reschedulePreferredDate}</strong>
                      </p>
                    )}
                    <p className="text-xs text-amber-600">
                      Requested {new Date((selectedJob as any).rescheduleRequestedAt).toLocaleString()}
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 border-green-300 text-green-800 hover:bg-green-50"
                        title="Approve this reschedule request"
                        onClick={() => {
                          setRescheduleApproveDate((selectedJob as any).reschedulePreferredDate ?? '');
                          setRescheduleApproveReply('');
                          setRescheduleApproveOpen(true);
                        }}
                      >
                        <CheckCircle className="w-3 h-3" /> Approve Reschedule
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        title="Decline this reschedule request"
                        onClick={() => { setRescheduleDeclineReply(''); setRescheduleDeclineOpen(true); }}
                      >
                        <X className="w-3 h-3" /> Decline
                      </Button>
                    </div>
                  </div>
                )}

                {/* Reschedule request banner — already responded */}
                {canManageJobs && (selectedJob as any).rescheduleRequestedAt && (selectedJob as any).rescheduleRequestStatus && (selectedJob as any).rescheduleRequestStatus !== 'pending' && (
                  <div className={`rounded-lg border p-3 space-y-1 ${(selectedJob as any).rescheduleRequestStatus === 'approved' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                    <p className={`text-xs font-medium flex items-center gap-1.5 ${(selectedJob as any).rescheduleRequestStatus === 'approved' ? 'text-green-800' : 'text-gray-600'}`}>
                      <CalendarSearch className="w-3 h-3" />
                      Reschedule request {(selectedJob as any).rescheduleRequestStatus === 'approved' ? 'approved' : 'declined'}
                    </p>
                    {(selectedJob as any).rescheduleRequestReply && (
                      <p className="text-xs text-muted-foreground">Reply sent: "{(selectedJob as any).rescheduleRequestReply}"</p>
                    )}
                  </div>
                )}

                {/* Cancellation request banner — pending */}
                {canManageJobs && (selectedJob as any).cancellationRequestedAt && (!((selectedJob as any).cancelRequestStatus) || (selectedJob as any).cancelRequestStatus === 'pending') && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                    <p className="text-sm font-medium text-red-800 flex items-center gap-1.5">
                      <Ban className="w-4 h-4" /> Cancellation Requested by Customer
                    </p>
                    {(selectedJob as any).cancellationReason && (
                      <p className="text-xs text-red-700 bg-red-100 rounded px-2 py-1">
                        "{(selectedJob as any).cancellationReason}"
                      </p>
                    )}
                    <p className="text-xs text-red-600">
                      Requested {new Date((selectedJob as any).cancellationRequestedAt).toLocaleString()}
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs gap-1"
                        title="Approve the request and cancel this job"
                        onClick={() => { setCancelApproveReply(''); setCancelApproveOpen(true); }}
                      >
                        <CheckCircle className="w-3 h-3" /> Approve & Cancel Job
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={denyJobCancellation.isPending}
                        title="Decline the request — job stays scheduled, customer is notified"
                        onClick={() => { setDenyReply(''); setDenyDialogOpen(true); }}
                      >
                        <X className="w-3 h-3" /> Decline Request
                      </Button>
                    </div>
                  </div>
                )}

                {/* Cancellation request banner — already declined */}
                {canManageJobs && (selectedJob as any).cancellationRequestedAt && (selectedJob as any).cancelRequestStatus === 'declined' && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1">
                    <p className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
                      <Ban className="w-3 h-3" /> Cancellation request declined
                    </p>
                    {(selectedJob as any).cancelRequestReply && (
                      <p className="text-xs text-muted-foreground">Reply sent: "{(selectedJob as any).cancelRequestReply}"</p>
                    )}
                  </div>
                )}

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

                {/* Cancellation charge */}
                {canManageJobs && (selectedJob as any).cancellationChargeId && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4" /> Cancellation Fee Charged
                    </p>
                    <p className="text-xs text-amber-700">
                      A draft invoice (#{(selectedJob as any).cancellationChargeId}) was automatically created for this cancellation. It can be found in the Financials tab.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-amber-300 text-amber-800 hover:bg-amber-100"
                      onClick={async () => {
                        if (!window.confirm('Remove the cancellation fee charge? This will delete the associated invoice.')) return;
                        try {
                          await customFetch(`/api/jobs/${selectedJobId}/cancellation-charge`, { method: 'DELETE' });
                          toast.success('Cancellation charge removed');
                          qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId!) });
                          qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                        } catch {
                          toast.error('Failed to remove charge');
                        }
                      }}
                    >
                      <X className="w-3 h-3" /> Remove Charge
                    </Button>
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
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Duration</p>
                    {editingDuration ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Input
                          type="number"
                          min={0}
                          step={durationEditUnit === 'hours' ? 0.5 : 15}
                          placeholder={durationEditUnit === 'hours' ? '1.5' : '90'}
                          value={durationEditVal}
                          onChange={e => setDurationEditVal(e.target.value)}
                          className="w-24 h-7 text-sm"
                          autoFocus
                        />
                        <Select value={durationEditUnit} onValueChange={v => setDurationEditUnit(v as 'minutes' | 'hours')}>
                          <SelectTrigger className="w-20 h-7 text-sm" title="Duration unit"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="minutes">min</SelectItem>
                            <SelectItem value="hours">hrs</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button size="sm" className="h-7 px-2 text-xs" disabled={updateJob.isPending} onClick={() => {
                          const raw = parseFloat(durationEditVal);
                          if (!durationEditVal || isNaN(raw) || raw <= 0) { setEditingDuration(false); return; }
                          const mins = durationEditUnit === 'hours' ? Math.round(raw * 60) : Math.round(raw);
                          updateJob.mutate({ id: selectedJobId!, data: { estimatedDuration: mins } as any }, {
                            onSuccess: () => { toast.success('Duration updated'); qc.invalidateQueries(); setEditingDuration(false); },
                            onError: () => toast.error('Failed to update duration'),
                          });
                        }}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingDuration(false)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedJob.estimatedDuration ? formatDuration(selectedJob.estimatedDuration) : <span className="text-muted-foreground text-xs italic">Not set</span>}</span>
                        {canManageJobs && (
                          <button
                            className="text-xs text-primary hover:underline"
                            title="Edit duration"
                            onClick={() => {
                              const mins = selectedJob.estimatedDuration ?? 0;
                              if (durationUnit === 'hours') {
                                setDurationEditUnit('hours');
                                setDurationEditVal(mins > 0 ? (mins / 60).toFixed(1) : '');
                              } else {
                                setDurationEditUnit('minutes');
                                setDurationEditVal(mins > 0 ? String(mins) : '');
                              }
                              setEditingDuration(true);
                            }}
                          >Edit</button>
                        )}
                      </div>
                    )}
                  </div>
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
                  {/* Source estimate back-link */}
                  {(selectedJob as any).estimateId && (
                    <button
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                      onClick={() => setLocation(`/estimates?highlight=${(selectedJob as any).estimateId}`)}
                      title="View the estimate this job was converted from"
                    >
                      <FileText className="w-3 h-3" />
                      From Estimate #{(selectedJob as any).estimateId} →
                    </button>
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
                  {((selectedJob as any).tags as string[] | undefined)?.length ? (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {((selectedJob as any).tags as string[]).map((tag: string) => {
                          const canonical = (bizTags as Array<{ id: number; name: string; color: string; slug: string }>).find(t => t.name === tag);
                          return (
                            <span key={tag} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border"
                              style={canonical ? { backgroundColor: canonical.color + '22', borderColor: canonical.color + '66', color: canonical.color } : undefined}>
                              {canonical && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: canonical.color }} />}
                              {tag}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
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
                  {!(selectedJob as any).invoiceId && canManageJobs && selectedJob.status !== 'cancelled' && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Invoice</p>
                      <Button
                        size="sm"
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs"
                        title={selectedJob.status === 'completed' ? 'Create an invoice for this job' : 'Mark this job complete and create an invoice'}
                        onClick={() => {
                          setCompleteInvoiceStep('review');
                          setCreatedInvoiceId(null);
                          setCreatedInvoiceTotal(0);
                          setOnSitePaymentMethod('cash');
                          setCompleteInvoiceOpen(true);
                        }}
                      >
                        <FileText className="w-3 h-3" />
                        {selectedJob.status === 'completed' ? 'Create Invoice' : 'Complete & Invoice'}
                      </Button>
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

                {/* Internal staff notes — visible to staff only, never to customers */}
                <Separator />
                <StaffNotesPanel
                  entityType="job"
                  entityId={selectedJobId!}
                  currentUserId={user?.id ?? 0}
                  isAdmin={canManageOffice}
                />

                {/* Staff message thread — staff-only, scoped to this job */}
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5" /> Staff Messages
                    </p>
                    {allJobMessages.length > 0 && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]" title={`${allJobMessages.length} message${allJobMessages.length !== 1 ? 's' : ''} loaded in this thread`}>
                        {allJobMessages.length}
                      </Badge>
                    )}
                  </div>

                  {/* Thread */}
                  {allJobMessages.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic" title="No messages yet — be the first to send one">No messages yet. Start the conversation.</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {(canLoadEarlierJob || jobEarlierError) && (
                        <div className="text-center space-y-1">
                          <Button size="sm" variant="outline" disabled={jobEarlierLoading} onClick={() => void loadEarlierJobMessages()}>
                            {jobEarlierLoading ? 'Loading…' : jobEarlierError ? 'Retry loading earlier messages' : 'Load earlier messages'}
                          </Button>
                          {jobEarlierError && <p className="text-xs text-destructive">{jobEarlierError}</p>}
                        </div>
                      )}
                      {allJobMessages.map((msg: any) => {
                        const isOwn = msg.senderId === user?.id;
                        return (
                          <div key={msg.id} className={`flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-medium text-foreground" title={msg.senderName}>{msg.senderName}</span>
                              <Badge variant="outline" className="h-3.5 px-1 text-[9px] capitalize" title={`Role: ${msg.senderRole?.replace('_', ' ')}`}>
                                {msg.senderRole?.replace('_', ' ')}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground" title={new Date(msg.createdAt).toLocaleString()}>
                                {format(new Date(msg.createdAt), 'MMM d h:mm a')}
                              </span>
                            </div>
                            <div className={`rounded-lg px-3 py-2 text-sm max-w-[90%] whitespace-pre-wrap break-words ${isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                              {msg.body}
                            </div>
                            {isOwn && <span className="text-[9px] text-muted-foreground">{msg.readByOthers ? 'Read' : 'Sent'}</span>}
                          </div>
                        );
                      })}
                      <div ref={msgEndRef} />
                    </div>
                  )}

                  {/* Compose */}
                  <div className="flex gap-2 items-end">
                    <Textarea
                      title="Type a message to send to staff on this job"
                      placeholder="Message staff…"
                      rows={2}
                      value={msgInput}
                      onChange={e => setMsgInput(e.target.value)}
                      className="text-sm resize-none flex-1"
                      maxLength={4000}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
                      }}
                    />
                    <Button
                      size="sm"
                      className="gap-1.5 h-auto py-2 self-end"
                      disabled={!msgInput.trim() || createJobMessage.isPending}
                      onClick={handleSendMessage}
                      title="Send message (Enter)"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {createJobMessage.isPending ? 'Sending…' : 'Send'}
                    </Button>
                  </div>
                </div>

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
                      onClick={() => { setAddingPart(true); setPartsSearch(''); setPartQtys({}); }}
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
                                  value={partQtys[item.id] ?? '1'}
                                  onChange={e => setPartQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  onClick={e => e.stopPropagation()}
                                />
                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  title={`Add ${item.name} to this job`}
                                  disabled={addJobPart.isPending}
                                  onClick={() => {
                                    if (!selectedJobId) return;
                                    const qty = parseInt(partQtys[item.id] ?? '1', 10);
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

                {/* Equipment hours */}
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5" /> Equipment Hours
                      {jobEquipUses.length > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{jobEquipUses.length}</Badge>
                      )}
                      {jobEquipUses.length > 0 && (
                        <span className="text-xs text-muted-foreground font-normal ml-1">
                          {jobEquipUses.reduce((s, u) => s + u.hoursUsed, 0).toFixed(1)} h total
                        </span>
                      )}
                    </p>
                    {!isTechnician && !addingEquipHours && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                        title="Log equipment used on this job"
                        onClick={() => setAddingEquipHours(true)}>
                        <Plus className="w-3 h-3" /> Log
                      </Button>
                    )}
                  </div>

                  {addingEquipHours && (
                    <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Equipment *</label>
                        {allEquipment.length > 0 ? (
                          <Select
                            value={typeof equipHoursForm.equipmentId === 'number' ? String(equipHoursForm.equipmentId) : (equipHoursForm.equipmentId as string)}
                            onValueChange={val => {
                              const eq = allEquipment.find(e => e.id === parseInt(val, 10));
                              setEquipHoursForm(f => ({ ...f, equipmentId: parseInt(val, 10), equipmentName: eq?.name ?? f.equipmentName }));
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select equipment…" />
                            </SelectTrigger>
                            <SelectContent>
                              {allEquipment.map(e => (
                                <SelectItem key={e.id} value={String(e.id)} className="text-xs">{e.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="h-8 text-xs"
                            placeholder="Equipment name"
                            value={equipHoursForm.equipmentName}
                            onChange={e => setEquipHoursForm(f => ({ ...f, equipmentName: e.target.value }))}
                          />
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Hours *</label>
                          <Input
                            type="number" min="0.1" step="0.1" className="h-8 text-xs"
                            placeholder="e.g. 2.5"
                            value={equipHoursForm.hoursUsed}
                            onChange={e => setEquipHoursForm(f => ({ ...f, hoursUsed: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Notes</label>
                          <Input
                            className="h-8 text-xs"
                            placeholder="Optional"
                            value={equipHoursForm.notes}
                            onChange={e => setEquipHoursForm(f => ({ ...f, notes: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => { setAddingEquipHours(false); setEquipHoursForm({ equipmentName: '', equipmentId: '', hoursUsed: '', notes: '' }); }}>
                          Cancel
                        </Button>
                        <Button size="sm" className="h-7 text-xs gap-1"
                          disabled={!equipHoursForm.equipmentName || !equipHoursForm.hoursUsed || createEquipUse.isPending}
                          onClick={handleAddEquipHours}>
                          {createEquipUse.isPending ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {jobEquipUses.length > 0 && (
                    <div className="rounded-lg border divide-y text-sm">
                      {jobEquipUses.map(use => (
                        <div key={use.id} className="flex items-center justify-between px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block" title={use.equipmentName}>{use.equipmentName}</span>
                            {use.notes && <span className="text-xs text-muted-foreground italic">{use.notes}</span>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <span className="font-semibold tabular-nums">{use.hoursUsed.toFixed(1)} h</span>
                            {!isTechnician && (
                              <button
                                className="text-muted-foreground/40 hover:text-destructive transition-colors"
                                title="Remove this equipment entry"
                                onClick={() => deleteEquipUse.mutate(
                                  { jobId: selectedJobId!, id: use.id },
                                  { onSuccess: () => { toast.success('Removed'); refetchEquipUses(); }, onError: () => toast.error('Failed to remove') }
                                )}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Supplies needed for job */}
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5" /> Supplies Needed
                      {Array.isArray((selectedJob as any).suppliesNeeded) && (selectedJob as any).suppliesNeeded.length > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{(selectedJob as any).suppliesNeeded.length}</Badge>
                      )}
                    </p>
                    {canManageJobs && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        title="Add a supply item this crew will need on site"
                        onClick={() => { setAddingSupply(true); setSuppliesSearch(''); setSupplyQtys({}); }}
                      >
                        <Plus className="w-3 h-3" /> Add Supply
                      </Button>
                    )}
                  </div>

                  {/* Add supply form */}
                  {addingSupply && (
                    <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                          className="w-full pl-8 pr-8 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                          title="Search inventory by name or SKU"
                          placeholder="Search supplies..."
                          value={suppliesSearch}
                          onChange={e => setSuppliesSearch(e.target.value)}
                          autoFocus
                        />
                        {suppliesSearch && <button title="Clear search" onClick={() => setSuppliesSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
                      </div>
                      {supplyInventoryItems && supplyInventoryItems.length > 0 && (
                        <div className="rounded-md border divide-y text-sm max-h-48 overflow-y-auto">
                          {supplyInventoryItems.slice(0, 8).map(item => (
                            <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate" title={item.name}>{item.name}</div>
                                <div className="text-xs text-muted-foreground">{item.quantity} {item.unit} in stock</div>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  title="Quantity needed"
                                  className="w-14 text-xs border rounded px-1.5 py-1 text-right"
                                  value={supplyQtys[item.id] ?? '1'}
                                  onChange={e => setSupplyQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  onClick={e => e.stopPropagation()}
                                />
                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  title={`Add ${item.name} to supplies needed`}
                                  disabled={updateJob.isPending}
                                  onClick={() => {
                                    if (!selectedJobId || !selectedJob) return;
                                    const qty = parseFloat(supplyQtys[item.id] ?? '1');
                                    if (isNaN(qty) || qty <= 0) { toast.error('Enter a valid quantity'); return; }
                                    const existing: { inventoryItemId: number; name: string; quantity: number; unit: string }[] =
                                      Array.isArray((selectedJob as any).suppliesNeeded) ? (selectedJob as any).suppliesNeeded : [];
                                    const alreadyAdded = existing.find(s => s.inventoryItemId === item.id);
                                    const updated = alreadyAdded
                                      ? existing.map(s => s.inventoryItemId === item.id ? { ...s, quantity: s.quantity + qty } : s)
                                      : [...existing, { inventoryItemId: item.id, name: item.name, quantity: qty, unit: item.unit }];
                                    updateJob.mutate(
                                      { id: selectedJobId, data: { suppliesNeeded: updated } as any },
                                      {
                                        onSuccess: () => {
                                          toast.success(`${item.name} added to supplies`);
                                          qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                                          setAddingSupply(false);
                                          setSuppliesSearch('');
                                        },
                                        onError: () => toast.error('Failed to update supplies'),
                                      }
                                    );
                                  }}
                                >{updateJob.isPending ? 'Saving…' : 'Add'}</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {suppliesSearch && supplyInventoryItems?.length === 0 && (
                        <p className="text-xs text-muted-foreground px-1">No items found for "{suppliesSearch}"</p>
                      )}
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAddingSupply(false)}>Cancel</Button>
                    </div>
                  )}

                  {/* Supplies list */}
                  {Array.isArray((selectedJob as any).suppliesNeeded) && (selectedJob as any).suppliesNeeded.length > 0 ? (
                    <div className="rounded-lg border divide-y text-sm">
                      {((selectedJob as any).suppliesNeeded as { inventoryItemId: number; name: string; quantity: number; unit: string }[]).map((supply, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block" title={supply.name}>{supply.name}</span>
                            <span className="text-xs text-muted-foreground">{supply.quantity} {supply.unit}</span>
                          </div>
                          {canManageJobs && (
                            <button
                              className="text-muted-foreground/40 hover:text-destructive transition-colors"
                              title="Remove this supply"
                              onClick={() => {
                                if (!selectedJobId || !selectedJob) return;
                                const existing: { inventoryItemId: number; name: string; quantity: number; unit: string }[] =
                                  Array.isArray((selectedJob as any).suppliesNeeded) ? (selectedJob as any).suppliesNeeded : [];
                                const updated = existing.filter(s => s.inventoryItemId !== supply.inventoryItemId);
                                updateJob.mutate(
                                  { id: selectedJobId, data: { suppliesNeeded: updated } as any },
                                  {
                                    onSuccess: () => {
                                      toast.success('Supply removed');
                                      qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                                    },
                                    onError: () => toast.error('Failed to update supplies'),
                                  }
                                );
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : !addingSupply && (
                    <p className="text-sm text-muted-foreground py-1">No supplies listed for this job.</p>
                  )}
                </div>

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
                      setChemForm(f => ({
                        ...f,
                        appliedAt: localDT,
                        applicatorName: currentUser?.name ?? user?.name ?? f.applicatorName,
                        applicatorLicenseNumber: license || f.applicatorLicenseNumber,
                      }));
                      setChemFormErrors({});
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
      <Sheet open={chemFormOpen} onOpenChange={open => { if (!open) { setChemFormOpen(false); setChemForm({ ...EMPTY_CHEMICAL_FORM }); setChemFormErrors({}); } }}>
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
                <label className="text-sm font-medium">Tank Mix (Mixture) <span className="text-destructive">*</span></label>
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
                <label className="text-sm font-medium">Raw Product <span className="text-destructive">*</span></label>
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
            {chemFormErrors.productOrMixture && <p className="text-xs text-destructive">{chemFormErrors.productOrMixture}</p>}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Volume Applied <span className="text-destructive">*</span></label>
                <Input type="number" min={0} step={0.01} title="Total volume of product applied" placeholder="e.g. 2.5" value={chemForm.volumeApplied} onChange={e => setChemForm(f => ({ ...f, volumeApplied: e.target.value }))} />
                {chemFormErrors.volumeApplied && <p className="text-xs text-destructive">{chemFormErrors.volumeApplied}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Unit <span className="text-destructive">*</span></label>
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
                {chemFormErrors.volumeUnit && <p className="text-xs text-destructive">{chemFormErrors.volumeUnit}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Applied At <span className="text-destructive">*</span></label>
              <Input type="datetime-local" title="Date and time the chemical was applied" value={chemForm.appliedAt} onChange={e => setChemForm(f => ({ ...f, appliedAt: e.target.value }))} />
              {chemFormErrors.appliedAt && <p className="text-xs text-destructive">{chemFormErrors.appliedAt}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Treated Area {chemicalFieldIsRequired('treatedArea') && <span className="text-destructive">*</span>}</label>
                <Input type="number" min={0} step={1} title="Total area treated by this application" placeholder="e.g. 5000" value={chemForm.treatedArea} onChange={e => setChemForm(f => ({ ...f, treatedArea: e.target.value }))} />
                {chemFormErrors.treatedArea && <p className="text-xs text-destructive">{chemFormErrors.treatedArea}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Area Unit {chemicalFieldIsRequired('treatedArea') && <span className="text-destructive">*</span>}</label>
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

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Treated Zone / Location {chemicalFieldIsRequired('treatedZoneName') && <span className="text-destructive">*</span>}</label>
              <Input title="Named property zone or treatment location" placeholder="e.g. Front lawn" value={chemForm.treatedZoneName} onChange={e => setChemForm(f => ({ ...f, treatedZoneName: e.target.value }))} />
              {chemFormErrors.treatedZoneName && <p className="text-xs text-destructive">{chemFormErrors.treatedZoneName}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Target Pest {chemicalFieldIsRequired('targetPest') && <span className="text-destructive">*</span>}</label>
                <Input title="Target pest or weed being treated" placeholder="e.g. Broadleaf weeds" value={chemForm.targetPest} onChange={e => setChemForm(f => ({ ...f, targetPest: e.target.value }))} />
                {chemFormErrors.targetPest && <p className="text-xs text-destructive">{chemFormErrors.targetPest}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Method {chemicalFieldIsRequired('applicationMethod') && <span className="text-destructive">*</span>}</label>
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
                {chemFormErrors.applicationMethod && <p className="text-xs text-destructive">{chemFormErrors.applicationMethod}</p>}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Wind (mph) {chemicalFieldIsRequired('windSpeed') && <span className="text-destructive">*</span>}</label>
                <Input type="number" min={0} step={0.5} title="Wind speed at time of application (mph)" placeholder="5" value={chemForm.windSpeed} onChange={e => setChemForm(f => ({ ...f, windSpeed: e.target.value }))} />
                {chemFormErrors.windSpeed && <p className="text-xs text-destructive">{chemFormErrors.windSpeed}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Direction {chemicalFieldIsRequired('windDirection') && <span className="text-destructive">*</span>}</label>
                <Select value={chemForm.windDirection} onValueChange={v => setChemForm(f => ({ ...f, windDirection: v }))}>
                  <SelectTrigger title="Wind direction at time of application"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chemFormErrors.windDirection && <p className="text-xs text-destructive">{chemFormErrors.windDirection}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Temp (°F) {chemicalFieldIsRequired('temperature') && <span className="text-destructive">*</span>}</label>
                <Input type="number" title="Temperature at time of application (°F)" placeholder="72" value={chemForm.temperature} onChange={e => setChemForm(f => ({ ...f, temperature: e.target.value }))} />
                {chemFormErrors.temperature && <p className="text-xs text-destructive">{chemFormErrors.temperature}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Applicator Name {chemicalFieldIsRequired('applicatorName') && <span className="text-destructive">*</span>}</label>
              <Input title="Name of the person applying the chemical" placeholder="Applicator name" value={chemForm.applicatorName} onChange={e => setChemForm(f => ({ ...f, applicatorName: e.target.value }))} />
              {chemFormErrors.applicatorName && <p className="text-xs text-destructive">{chemFormErrors.applicatorName}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Applicator License # {chemicalFieldIsRequired('applicatorLicenseNumber') && <span className="text-destructive">*</span>}</label>
              <Input title="Applicator's pesticide license number" placeholder="License number" value={chemForm.applicatorLicenseNumber} onChange={e => setChemForm(f => ({ ...f, applicatorLicenseNumber: e.target.value }))} />
              {chemFormErrors.applicatorLicenseNumber && <p className="text-xs text-destructive">{chemFormErrors.applicatorLicenseNumber}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes {chemicalFieldIsRequired('notes') && <span className="text-destructive">*</span>}</label>
              <Textarea title="Additional notes about this application (weather, conditions, observations, etc.)" placeholder="Additional notes…" rows={2} value={chemForm.notes} onChange={e => setChemForm(f => ({ ...f, notes: e.target.value }))} />
              {chemFormErrors.notes && <p className="text-xs text-destructive">{chemFormErrors.notes}</p>}
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setChemFormOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!validateChemicalForm()) return;
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
                      appliedAt: new Date(chemForm.appliedAt).toISOString(),
                      applicatorName: chemForm.applicatorName.trim() || undefined,
                      applicatorLicenseNumber: chemForm.applicatorLicenseNumber || undefined,
                      notes: chemForm.notes || undefined,
                      treatedArea: chemForm.treatedArea ? parseFloat(chemForm.treatedArea) : undefined,
                      areaUnit: chemForm.areaUnit || undefined,
                      treatedZoneName: chemForm.treatedZoneName.trim() || undefined,
                    },
                  }, {
                    onSuccess: () => {
                      toast.success('Application logged');
                      setChemFormOpen(false);
                      setChemForm({ ...EMPTY_CHEMICAL_FORM });
                      setChemFormErrors({});
                      qc.invalidateQueries({ queryKey: getListJobChemicalApplicationsQueryKey(selectedJobId!) });
                    },
                    onError: (error: any) => {
                      if (error?.data?.fields && typeof error.data.fields === 'object') setChemFormErrors(error.data.fields);
                      toast.error(error?.data?.error ?? 'Failed to log application');
                    },
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
      {/* Approve cancellation request dialog */}
      <Dialog open={cancelApproveOpen} onOpenChange={open => { if (!open) { setCancelApproveOpen(false); setCancelApproveReply(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Approve Cancellation</DialogTitle>
            <DialogDescription>This will cancel the job. The customer will be notified via a portal message.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Textarea
              placeholder="Optional message to customer (e.g. 'Your cancellation has been processed — no further action needed.')"
              value={cancelApproveReply}
              onChange={e => setCancelApproveReply(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => { setCancelApproveOpen(false); setCancelApproveReply(''); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={approveJobCancellation.isPending}
              onClick={() => {
                approveJobCancellation.mutate({ id: selectedJobId!, reply: cancelApproveReply.trim() || undefined }, {
                  onSuccess: () => {
                    toast.success('Job cancelled — customer notified via portal message');
                    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                    qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId!) });
                    setCancelApproveOpen(false);
                    setCancelApproveReply('');
                  },
                  onError: () => toast.error('Failed to approve cancellation'),
                });
              }}
            >
              {approveJobCancellation.isPending ? 'Cancelling…' : 'Approve & Cancel Job'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Decline cancellation request dialog */}
      <Dialog open={denyDialogOpen} onOpenChange={open => { if (!open) { setDenyDialogOpen(false); setDenyReply(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Decline Cancellation Request</DialogTitle>
            <DialogDescription>The job stays scheduled. The customer will receive a portal message with your reply.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Textarea
              placeholder="Optional reply to customer (e.g. 'We were unable to cancel within the required window — please call us.')"
              value={denyReply}
              onChange={e => setDenyReply(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => { setDenyDialogOpen(false); setDenyReply(''); }}>Cancel</Button>
            <Button
              disabled={denyJobCancellation.isPending}
              onClick={() => {
                denyJobCancellation.mutate({ id: selectedJobId!, reply: denyReply.trim() || undefined }, {
                  onSuccess: () => {
                    toast.success('Cancellation request declined — customer notified');
                    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                    qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId!) });
                    setDenyDialogOpen(false);
                    setDenyReply('');
                  },
                  onError: () => toast.error('Failed to decline cancellation request'),
                });
              }}
            >
              {denyJobCancellation.isPending ? 'Saving…' : 'Decline Request'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approve reschedule dialog */}
      <Dialog open={rescheduleApproveOpen} onOpenChange={open => { if (!open) setRescheduleApproveOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Approve Reschedule</DialogTitle>
            <DialogDescription>Confirm the new date and send an optional message to the customer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">New scheduled date</label>
              <Input
                type="date"
                value={rescheduleApproveDate}
                onChange={e => setRescheduleApproveDate(e.target.value)}
                className="text-sm"
              />
              {(selectedJob as any)?.reschedulePreferredDate && (
                <p className="text-xs text-muted-foreground">Customer preferred: {(selectedJob as any).reschedulePreferredDate}</p>
              )}
            </div>
            <Textarea
              placeholder="Optional message to customer"
              value={rescheduleApproveReply}
              onChange={e => setRescheduleApproveReply(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setRescheduleApproveOpen(false)}>Cancel</Button>
            <Button
              disabled={approveReschedule.isPending || !rescheduleApproveDate}
              onClick={() => {
                approveReschedule.mutate({ id: selectedJobId!, approvedDate: rescheduleApproveDate, reply: rescheduleApproveReply.trim() || undefined }, {
                  onSuccess: () => {
                    toast.success('Reschedule approved — customer notified');
                    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                    qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId!) });
                    setRescheduleApproveOpen(false);
                  },
                  onError: () => toast.error('Failed to approve reschedule'),
                });
              }}
            >
              {approveReschedule.isPending ? 'Saving…' : 'Approve'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Decline reschedule dialog */}
      <Dialog open={rescheduleDeclineOpen} onOpenChange={open => { if (!open) { setRescheduleDeclineOpen(false); setRescheduleDeclineReply(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Decline Reschedule Request</DialogTitle>
            <DialogDescription>The job stays on its current date. The customer will receive a portal message.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Textarea
              placeholder="Optional reply to customer"
              value={rescheduleDeclineReply}
              onChange={e => setRescheduleDeclineReply(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => { setRescheduleDeclineOpen(false); setRescheduleDeclineReply(''); }}>Cancel</Button>
            <Button
              disabled={dismissRescheduleRequest.isPending}
              onClick={() => {
                dismissRescheduleRequest.mutate({ id: selectedJobId!, reply: rescheduleDeclineReply.trim() || undefined }, {
                  onSuccess: () => {
                    toast.success('Reschedule request declined — customer notified');
                    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                    qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId!) });
                    setRescheduleDeclineOpen(false);
                    setRescheduleDeclineReply('');
                  },
                  onError: () => toast.error('Failed to decline reschedule request'),
                });
              }}
            >
              {dismissRescheduleRequest.isPending ? 'Saving…' : 'Decline Request'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      {/* Skip Next Occurrence */}
      <Dialog open={skipNextDialogId !== null} onOpenChange={open => { if (!open) { setSkipNextDialogId(null); setSkipReasonId(null); setSkipNote(''); setSkipFee(''); setSkipFeeType('flat'); setSkipFeePercent(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Skip Next Occurrence</DialogTitle>
            <DialogDescription>Skip the next scheduled occurrence of this series? The series continues from the one after it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            {skipReasons.filter(r => r.isActive).length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Reason</label>
                <Select
                  value={skipReasonId ? String(skipReasonId) : 'none'}
                  onValueChange={v => setSkipReasonId(v === 'none' ? null : parseInt(v, 10))}
                >
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Select a reason (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No reason selected</SelectItem>
                    {skipReasons.filter(r => r.isActive).map(r => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {skipReasonId && (() => {
                  const r = skipReasons.find(x => x.id === skipReasonId);
                  if (!r || r.action === 'none') return null;
                  const labels: Record<string, string> = { notify_customer: '📱 Customer will be texted', flag_property: '🚩 Property will be flagged', create_task: '📋 Office task will be created' };
                  return <p className="text-xs text-muted-foreground">{labels[r.action] ?? r.action}</p>;
                })()}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Note <span className="font-normal">(optional)</span></label>
              <input
                className="w-full rounded-md border px-3 py-1.5 text-sm bg-background"
                placeholder="Add context if needed…"
                value={skipNote}
                onChange={e => setSkipNote(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Skip Fee <span className="font-normal">(optional — added to invoice)</span>
              </label>
              {/* Fee type selector */}
              <div className="flex rounded-md overflow-hidden border text-xs font-medium">
                {(['flat', 'percent', 'both'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSkipFeeType(t)}
                    className={`flex-1 py-1.5 transition-colors ${skipFeeType === t ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
                  >
                    {t === 'flat' ? 'Flat $' : t === 'percent' ? '% of Job' : 'Both'}
                  </button>
                ))}
              </div>

              {/* Flat dollar input */}
              {(skipFeeType === 'flat' || skipFeeType === 'both') && (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    className="w-full rounded-md border pl-6 pr-3 py-1.5 text-sm bg-background"
                    placeholder="0.00"
                    value={skipFee}
                    onChange={e => setSkipFee(e.target.value)}
                  />
                </div>
              )}

              {/* Percentage input */}
              {(skipFeeType === 'percent' || skipFeeType === 'both') && (
                <div className="relative">
                  <input
                    type="number" min="0" max="100" step="0.1"
                    className="w-full rounded-md border pr-8 pl-3 py-1.5 text-sm bg-background"
                    placeholder="e.g. 15"
                    value={skipFeePercent}
                    onChange={e => setSkipFeePercent(e.target.value)}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              )}

              {/* Preview */}
              {(() => {
                const flat = parseFloat(skipFee);
                const pct = parseFloat(skipFeePercent);
                const hasFlat = (skipFeeType === 'flat' || skipFeeType === 'both') && flat > 0;
                const hasPct = (skipFeeType === 'percent' || skipFeeType === 'both') && pct > 0;
                if (!hasFlat && !hasPct) return null;
                const parts = [];
                if (hasFlat) parts.push(`$${flat.toFixed(2)} flat`);
                if (hasPct) parts.push(`${pct}% of job total`);
                return <p className="text-xs text-amber-600">Invoice will include: {parts.join(' + ')}</p>;
              })()}
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => { setSkipNextDialogId(null); setSkipReasonId(null); setSkipNote(''); setSkipFee(''); setSkipFeeType('flat'); setSkipFeePercent(''); }}>Cancel</Button>
            <Button
              disabled={skipNextOccurrence.isPending}
              onClick={() => {
                if (!skipNextDialogId) return;
                const feeAmountVal = parseFloat(skipFee);
                const feePctVal = parseFloat(skipFeePercent);
                const hasFlat = (skipFeeType === 'flat' || skipFeeType === 'both') && feeAmountVal > 0;
                const hasPct = (skipFeeType === 'percent' || skipFeeType === 'both') && feePctVal > 0;
                const hasFee = hasFlat || hasPct;
                skipNextOccurrence.mutate(
                  {
                    id: skipNextDialogId,
                    data: {
                      ...(skipReasonId && { reasonId: skipReasonId }),
                      ...(skipNote && { note: skipNote }),
                      ...(hasFee && {
                        feeType: skipFeeType,
                        ...(hasFlat && { feeAmount: feeAmountVal }),
                        ...(hasPct && { feePercent: feePctVal }),
                        feeNote: skipNote || 'Skip fee',
                      }),
                    },
                  },
                  {
                    onSuccess: () => {
                      toast.success(hasFee ? 'Skipped · skip fee invoice created' : 'Next occurrence skipped');
                      qc.invalidateQueries({ queryKey: getListRecurringSeriesQueryKey() });
                      qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                      setSkipNextDialogId(null); setSkipReasonId(null); setSkipNote(''); setSkipFee(''); setSkipFeeType('flat'); setSkipFeePercent('');
                    },
                    onError: () => toast.error('Failed to skip'),
                  }
                );
              }}
            >
              {skipNextOccurrence.isPending ? 'Skipping…' : 'Skip Occurrence'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Complete & Invoice & Pay dialog */}
      <Dialog open={completeInvoiceOpen} onOpenChange={open => { if (!open) setCompleteInvoiceOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {completeInvoiceStep === 'review' ? (selectedJob && selectedJob.status !== 'completed' ? 'Complete & Invoice' : 'Create Invoice') : 'Invoice Created'}
            </DialogTitle>
            <DialogDescription>
              {completeInvoiceStep === 'review'
                ? 'Review and generate an invoice for this job.'
                : `Invoice #${createdInvoiceId} created · Total: $${createdInvoiceTotal.toFixed(2)}`}
            </DialogDescription>
          </DialogHeader>

          {selectedJob && completeInvoiceStep === 'review' && (
            <div className="space-y-4">
              {selectedJob.status !== 'completed' && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                  This will also mark the job as <strong>completed</strong>.
                </div>
              )}
              {/* Line items preview */}
              {Array.isArray((selectedJob as any).lineItems) && (selectedJob as any).lineItems.length > 0 ? (
                <div className="space-y-1.5 text-sm">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Line items</p>
                  {(selectedJob as any).lineItems.map((li: any, i: number) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-muted-foreground truncate mr-2">{li.name || li.description} × {li.quantity}</span>
                      <span className="tabular-nums shrink-0">${(((li.unitPrice ?? li.unit_price ?? 0) * (li.quantity ?? 1))).toFixed(2)}</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex items-center justify-between font-semibold">
                    <span>Total</span>
                    <span>${((selectedJob as any).totalAmount ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Total: <strong className="text-foreground">${((selectedJob as any).totalAmount ?? 0).toFixed(2)}</strong>
                </div>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="outline" size="sm" onClick={() => setCompleteInvoiceOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={completeAndInvoiceJob.isPending}
                  onClick={async () => {
                    if (!selectedJobId) return;
                    try {
                      const inv = await completeAndInvoiceJob.mutateAsync({ id: selectedJobId });
                      setCreatedInvoiceId(inv.id);
                      setCreatedInvoiceTotal(inv.total ?? 0);
                      setCompleteInvoiceStep('pay');
                      qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                      qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                    } catch (err: any) {
                      if (err?.status === 409) {
                        toast.error('An invoice already exists for this job');
                        setCompleteInvoiceOpen(false);
                        qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                      } else {
                        toast.error('Failed to create invoice');
                      }
                    }
                  }}
                >
                  {completeAndInvoiceJob.isPending ? 'Creating…' : 'Create Invoice'}
                </Button>
              </div>
            </div>
          )}

          {completeInvoiceStep === 'pay' && (
            <div className="space-y-4">
              <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2.5 flex items-center gap-2.5 text-emerald-800">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <div className="text-sm">
                  Invoice created · Total: <strong>${createdInvoiceTotal.toFixed(2)}</strong>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mark as paid now?</label>
                <Select value={onSitePaymentMethod} onValueChange={setOnSitePaymentMethod}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="card">Card (manual)</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    toast.success('Invoice created — collect payment later');
                    setCompleteInvoiceOpen(false);
                    if (createdInvoiceId) setLocation(`/financials?invoiceId=${createdInvoiceId}`);
                  }}
                >
                  Pay Later
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={updateInvoice.isPending}
                  onClick={async () => {
                    if (!createdInvoiceId) return;
                    try {
                      await updateInvoice.mutateAsync({ id: createdInvoiceId, data: { status: 'paid', notes: `Paid on-site via ${onSitePaymentMethod}` } as any });
                      toast.success(`Invoice marked paid (${onSitePaymentMethod})`);
                      setCompleteInvoiceOpen(false);
                      if (selectedJobId) qc.invalidateQueries({ queryKey: getGetJobQueryKey(selectedJobId) });
                    } catch {
                      toast.error('Failed to mark invoice as paid');
                    }
                  }}
                >
                  {updateInvoice.isPending ? 'Saving…' : `Mark Paid (${onSitePaymentMethod})`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Waitlist sheet ─────────────────────────────────────────────────── */}
      <Sheet open={staffInboxOpen} onOpenChange={setStaffInboxOpen}>
        <SheetContent className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>General Staff Messages</SheetTitle>
            <SheetDescription>Private staff-member threads. Updates every 30 seconds while open.</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-[220px_1fr] gap-3 mt-5 h-[calc(100vh-150px)]">
            <div className="border-r pr-3 overflow-y-auto space-y-1">
              {staffThreadsLoading ? (
                <p className="text-sm text-muted-foreground" data-testid="status-staff-threads-loading">Loading conversations…</p>
              ) : staffThreads.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="status-staff-threads-empty">No staff conversations available.</p>
              ) : staffThreads.map(thread => (
                <button
                  key={thread.threadUserId}
                  onClick={() => { setStaffThreadId(thread.threadUserId); setStaffMsgInput(''); }}
                  className={`w-full rounded-md p-2 text-left hover:bg-muted ${staffThreadId === thread.threadUserId ? 'bg-muted' : ''}`}
                  data-testid={`button-staff-thread-${thread.threadUserId}`}
                >
                  <div className="flex justify-between gap-2">
                    <span className="text-sm font-medium truncate">{thread.threadUserName}</span>
                    {thread.unreadCount > 0 && <Badge className="h-5 px-1.5 text-[10px]">{thread.unreadCount}</Badge>}
                  </div>
                  <p className="text-[10px] capitalize text-muted-foreground">{thread.threadUserRole.replaceAll('_', ' ')}</p>
                  <p className="text-xs text-muted-foreground truncate mt-1">{thread.lastMessage ?? 'No messages yet'}</p>
                </button>
              ))}
            </div>
            <div className="min-w-0 flex flex-col">
              {staffThreadId == null ? (
                <div className="flex-1 grid place-items-center text-sm text-muted-foreground" data-testid="status-select-staff-thread">Select a staff member to open their thread.</div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {allStaffThreadMessages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet. Start the conversation.</p>}
                    {(canLoadEarlierStaff || staffEarlierError) && (
                      <div className="text-center space-y-1">
                        <Button size="sm" variant="outline" disabled={staffEarlierLoading} onClick={() => void loadEarlierStaffMessages()}>
                          {staffEarlierLoading ? 'Loading…' : staffEarlierError ? 'Retry loading earlier messages' : 'Load earlier messages'}
                        </Button>
                        {staffEarlierError && <p className="text-xs text-destructive">{staffEarlierError}</p>}
                      </div>
                    )}
                    {allStaffThreadMessages.map(message => {
                      const own = message.senderId === user?.id;
                      return (
                        <div key={message.id} className={`flex flex-col ${own ? 'items-end' : 'items-start'}`} data-testid={`staff-message-${message.id}`}>
                          <span className="text-[10px] text-muted-foreground mb-1">{message.senderName} · {message.senderRole.replaceAll('_', ' ')} · {format(new Date(message.createdAt), 'MMM d h:mm a')}</span>
                          <div className={`rounded-lg px-3 py-2 text-sm max-w-[90%] whitespace-pre-wrap break-words ${own ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{message.body}</div>
                          {own && <span className="text-[9px] text-muted-foreground mt-0.5">{message.readByOthers ? 'Read' : 'Sent'}</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 items-end pt-3 border-t mt-3">
                    <Textarea
                      rows={2}
                      maxLength={4000}
                      value={staffMsgInput}
                      onChange={event => setStaffMsgInput(event.target.value)}
                      placeholder="Message this staff member…"
                      className="resize-none"
                      data-testid="input-staff-message"
                      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSendStaffMessage(); } }}
                    />
                    <Button disabled={!staffMsgInput.trim() || createStaffMessage.isPending} onClick={handleSendStaffMessage} data-testid="button-send-staff-message">
                      <Send className="w-4 h-4" /> {createStaffMessage.isPending ? 'Sending…' : 'Send'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={waitlistOpen} onOpenChange={setWaitlistOpen}>
        <SheetContent side="right" className="w-full max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <ListEnd className="w-5 h-5 text-amber-500" />
              Job Waitlist
              {waitlistJobs.length > 0 && (
                <Badge className="bg-amber-500 text-white border-none text-xs">{waitlistJobs.length}</Badge>
              )}
            </SheetTitle>
            <SheetDescription>
              Jobs queued for scheduling. Open a job to assign a date and move it to the schedule.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {waitlistJobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ListEnd className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">Waitlist is empty</p>
                <p className="text-xs mt-1">When creating a job, set its status to "Waitlist" to hold it here until a date is set.</p>
              </div>
            ) : (
              waitlistJobs.map((job: any) => (
                <div
                  key={job.id}
                  className="rounded-lg border p-4 space-y-2 hover:border-primary/40 transition-colors cursor-pointer bg-card"
                  onClick={() => { setSelectedJobId(job.id); setWaitlistOpen(false); }}
                  title="Click to open job detail"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{job.title}</p>
                      {job.customerName && (
                        <p className="text-xs text-muted-foreground truncate">{job.customerName}</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600 shrink-0">Waitlist</Badge>
                  </div>
                  {job.propertyAddress && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate">{job.propertyAddress}</span>
                    </p>
                  )}
                  {job.notes && (
                    <p className="text-xs text-muted-foreground line-clamp-2 italic">{job.notes}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Added {new Date(job.createdAt ?? job.scheduledAt).toLocaleDateString()}</span>
                    <Button size="sm" variant="outline" className="h-6 text-xs gap-1"
                      onClick={e => { e.stopPropagation(); setSelectedJobId(job.id); setWaitlistOpen(false); }}>
                      <Calendar className="w-3 h-3" /> Schedule
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          {waitlistJobs.length > 0 && (
            <div className="px-6 py-4 border-t shrink-0">
              <Button size="sm" variant="ghost" className="w-full h-8 text-xs gap-1.5"
                onClick={() => refetchWaitlist()}>
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
