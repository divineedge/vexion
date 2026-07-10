import React, { useState } from 'react';
import {
  useListJobs, getListJobsQueryKey,
  useGetJob, getGetJobQueryKey,
  useUpdateJob, useCreateJob,
  useListCustomers, getListCustomersQueryKey,
  useListUsers, getListUsersQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
} from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
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
  DollarSign, ClipboardList, Plus, Users,
} from 'lucide-react';
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
};

const EMPTY_JOB: NewJobForm = {
  title: '',
  description: '',
  scheduledAt: '',
  estimatedDuration: '',
  priority: 'normal',
  customerId: '',
  assigneeId: '',
};

export default function SchedulePage() {
  const { user, isTechnician, canManageJobs } = useAuth();
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'week' | 'month'>('week');
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newJob, setNewJob] = useState<NewJobForm>(EMPTY_JOB);

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

  const days = eachDayOfInterval({ start, end });
  const getJobsForDay = (date: Date) => jobs?.filter(j => isSameDay(new Date(j.scheduledAt), date)) ?? [];

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

    createJob.mutate({
      data: {
        title: newJob.title,
        description: newJob.description || undefined,
        scheduledAt: new Date(newJob.scheduledAt).toISOString(),
        estimatedDuration: durationMins,
        priority: newJob.priority as 'low' | 'normal' | 'high' | 'urgent',
        customerId: newJob.customerId ? parseInt(newJob.customerId, 10) : undefined,
        assigneeId: newJob.assigneeId ? parseInt(newJob.assigneeId, 10) : undefined,
      },
    }, {
      onSuccess: () => {
        toast.success('Job created');
        qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
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
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevRange}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="min-w-[140px] text-center font-medium">
              {view === 'week' ? `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}` : format(currentDate, 'MMMM yyyy')}
            </div>
            <Button variant="outline" size="icon" onClick={nextRange}><ChevronRight className="w-4 h-4" /></Button>
          </div>
          {canManageJobs && (
            <Button className="gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> New Job
            </Button>
          )}
        </div>
      </div>

      {/* Calendar */}
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
                const isToday = isSameDay(day, new Date());
                const isOtherMonth = view === 'month' && day.getMonth() !== currentDate.getMonth();
                return (
                  <div key={day.toISOString()} className={`border-r border-b p-2 flex flex-col ${isOtherMonth ? 'bg-muted/10' : ''}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                        {format(day, 'd')}
                      </span>
                      {dayJobs.length > 0 && <span className="text-xs text-muted-foreground">{dayJobs.length} job{dayJobs.length !== 1 ? 's' : ''}</span>}
                    </div>
                    <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
                      {dayJobs.map(job => (
                        <div
                          key={job.id}
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
                  </div>
                  <Badge className={`shrink-0 capitalize ${STATUS_COLORS[selectedJob.status] ?? ''}`} variant="outline">
                    {selectedJob.status.replace('_', ' ')}
                  </Badge>
                </div>
              </SheetHeader>

              <div className="space-y-5">
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
                {Array.isArray(selectedJob.jobParts) && selectedJob.jobParts.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
                        <ClipboardList className="w-3.5 h-3.5" /> Parts Used
                      </p>
                      <div className="rounded-lg border divide-y text-sm">
                        {(selectedJob.jobParts as { name: string; quantity: number; unitPrice: number; total: number }[]).map((part, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium truncate block">{part.name}</span>
                              <span className="text-xs text-muted-foreground">{part.quantity} × ${part.unitPrice.toFixed(2)}</span>
                            </div>
                            <span className="font-semibold ml-4">${part.total.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

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
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading...</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
