import React, { useState } from 'react';
import { directionsUrl } from '@/lib/directions';
import { VisitClockControl } from '@/components/visits/VisitClockControl';
import { serverErrorMessage } from '@/lib/serverError';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  useListVisits, getListVisitsQueryKey,
  useGetVisit, getGetVisitQueryKey,
  useCreateVisit,
  useUpdateVisit,
  useDeleteVisit,
  useCompleteVisit,
  useConvertVisitToEstimate,
  useConvertVisitToJob,
  useListCustomers, getListCustomersQueryKey,
  useListUsers, getListUsersQueryKey,
  useListProperties, getListPropertiesQueryKey,
} from '@workspace/api-client-react';
import { format } from 'date-fns';
import {
  Plus, MapPin, User, Clock, CheckCircle2, ChevronRight, FileText, Briefcase, Footprints, Search, Edit2, AlertTriangle,
} from 'lucide-react';

const VISIT_MODE_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
  drop_by:   'bg-amber-100 text-amber-700 border-amber-200',
  drive_by:  'bg-slate-100 text-slate-700 border-slate-200',
};

const VISIT_MODE_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  drop_by:   'Drop By',
  drive_by:  'Drive-By',
};

export default function VisitsPage() {
  const { canManageJobs } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState<number | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [createFollowUp, setCreateFollowUp] = useState(false);
  const [visitSearch, setVisitSearch] = useState('');
  const [visitStatusFilter, setVisitStatusFilter] = useState<'all' | 'upcoming' | 'completed'>('all');

  // Read URL search params to support prefill and auto-open
  const { prefillCustomerId, prefillPropertyId, openVisitId } = React.useMemo(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return {
        prefillCustomerId: p.get('customerId') ?? '',
        prefillPropertyId: p.get('propertyId') ?? '',
        openVisitId: p.get('visitId') ? parseInt(p.get('visitId')!, 10) : null,
      };
    }
    return { prefillCustomerId: '', prefillPropertyId: '', openVisitId: null };
  }, []);

  const [form, setForm] = useState({
    customerId: prefillCustomerId,
    propertyId: prefillPropertyId,
    assigneeId: '',
    visitMode: 'scheduled',
    purpose: '',
    notes: '',
    scheduledAt: '',
    smsReminderEnabled: false,
  });

  // Open create dialog or visit detail automatically when URL params are present
  React.useEffect(() => {
    if (prefillCustomerId || prefillPropertyId) setCreateOpen(true);
    if (openVisitId) setSelectedId(openVisitId);
  }, [prefillCustomerId, prefillPropertyId, openVisitId]);

  const visitsQuery = prefillPropertyId ? { propertyId: parseInt(prefillPropertyId, 10) } : {};
  const { data: visits, isLoading } = useListVisits(visitsQuery as any, { query: { queryKey: getListVisitsQueryKey(visitsQuery as any) } });
  const { data: selectedVisit } = useGetVisit(selectedId!, {
    query: { enabled: selectedId != null, queryKey: getGetVisitQueryKey(selectedId!) },
  });
  const { data: customers } = useListCustomers({}, { query: { enabled: createOpen, queryKey: getListCustomersQueryKey({}) } });
  const { data: users } = useListUsers({ query: { enabled: createOpen, queryKey: getListUsersQueryKey() } });
  const { data: customerProperties } = useListProperties(
    { customerId: form.customerId ? parseInt(form.customerId, 10) : undefined },
    { query: { enabled: createOpen && !!form.customerId, queryKey: [...getListPropertiesQueryKey({}), form.customerId] } },
  );

  const [editingVisit, setEditingVisit] = useState<{ id: number; purpose: string; notes: string | null; scheduledAt?: string } | null>(null);

  const createVisit = useCreateVisit();
  const updateVisit = useUpdateVisit();
  const deleteVisit = useDeleteVisit();
  const completeVisit = useCompleteVisit();
  const convertToEstimate = useConvertVisitToEstimate();
  const convertToJob = useConvertVisitToJob();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListVisitsQueryKey() });
    if (selectedId) qc.invalidateQueries({ queryKey: getGetVisitQueryKey(selectedId) });
  }

  function handleCreate() {
    if (!form.purpose.trim()) { toast.error('Purpose is required'); return; }
    if (!form.scheduledAt) { toast.error('Scheduled date and time is required'); return; }
    if (!form.propertyId) { toast.error('Property is required'); return; }
    if (!form.assigneeId) { toast.error('Assigned technician is required'); return; }
    createVisit.mutate({
      data: {
        customerId: form.customerId ? parseInt(form.customerId, 10) : undefined,
        propertyId: parseInt(form.propertyId, 10),
        assigneeId: parseInt(form.assigneeId, 10),
        visitMode: 'scheduled' as const,
        purpose: form.purpose,
        notes: form.notes || undefined,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        smsReminderEnabled: form.smsReminderEnabled,
      },
    }, {
      onSuccess: (v) => {
        toast.success('Visit created');
        invalidate();
        setCreateOpen(false);
        setForm({ customerId: '', propertyId: '', assigneeId: '', visitMode: 'scheduled', purpose: '', notes: '', scheduledAt: '', smsReminderEnabled: false });
        setSelectedId(v.id);
      },
      onError: () => toast.error('Failed to create visit'),
    });
  }

  function handleComplete(id: number) {
    const shouldFollowUp = createFollowUp;
    const visit = visits?.find(v => v.id === id) ?? (selectedVisit?.id === id ? selectedVisit : null);
    completeVisit.mutate({ id, data: { outcomeNotes: outcomeNotes || undefined } }, {
      onSuccess: () => {
        toast.success('Visit marked complete');
        invalidate();
        setCompleteOpen(null);
        setOutcomeNotes('');
        setCreateFollowUp(false);
        if (shouldFollowUp) {
          const params = new URLSearchParams({ action: 'create' });
          if ((visit as any)?.customerId) params.set('customerId', String((visit as any).customerId));
          if ((visit as any)?.propertyId) params.set('propertyId', String((visit as any).propertyId));
          setLocation(`/schedule?${params}`);
        }
      },
      onError: () => toast.error('Failed to complete visit'),
    });
  }

  function handleConvertToEstimate(id: number) {
    convertToEstimate.mutate({ id }, {
      onSuccess: (r) => { toast.success(`Estimate #${r.estimateId} created`); invalidate(); },
      onError: () => toast.error('Failed to convert to estimate'),
    });
  }

  function handleConvertToJob(id: number) {
    convertToJob.mutate({ id }, {
      onSuccess: (r) => { toast.success(`Job #${r.jobId} created`); invalidate(); },
      onError: (err: unknown) => toast.error(serverErrorMessage(err, 'Failed to convert to job')),
    });
  }

  const matchesSearch = (v: { purpose?: string | null; customerName?: string | null; assigneeName?: string | null }) =>
    !visitSearch.trim() ||
    (v.purpose ?? '').toLowerCase().includes(visitSearch.toLowerCase()) ||
    (v.customerName ?? '').toLowerCase().includes(visitSearch.toLowerCase()) ||
    (v.assigneeName ?? '').toLowerCase().includes(visitSearch.toLowerCase());

  const upcoming = (visits?.filter(v => !v.completedAt) ?? []).filter(matchesSearch);
  const completed = (visits?.filter(v => v.completedAt) ?? []).filter(matchesSearch);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Visits</h1>
          <p className="text-muted-foreground mt-1">Track customer visits, follow-ups, and site check-ins.{visits && visits.length > 0 ? ` ${visits.length} total.` : ''}</p>
        </div>
        {canManageJobs && (
          <Button title="Schedule a new customer visit" onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Schedule Visit
          </Button>
        )}
      </div>

      {/* Search + status filter bar */}
      {visits && visits.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              title="Search visits by customer name, address, or note"
              placeholder="Search visits…"
              className="pl-9"
              value={visitSearch}
              onChange={e => setVisitSearch(e.target.value)}
            />
          </div>
          <Select value={visitStatusFilter} onValueChange={v => setVisitStatusFilter(v as typeof visitStatusFilter)}>
            <SelectTrigger className="w-36 h-9 text-sm" title="Filter visits by completion status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Visits</SelectItem>
              <SelectItem value="upcoming">Upcoming Only</SelectItem>
              <SelectItem value="completed">Completed Only</SelectItem>
            </SelectContent>
          </Select>
          {(visitSearch || visitStatusFilter !== 'all') && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setVisitSearch(''); setVisitStatusFilter('all'); }}>Clear</button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading visits...</div>
      ) : (
        <div className="space-y-6">
          {/* Upcoming */}
          {visitStatusFilter !== 'completed' && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Upcoming & Pending</h2>
            {upcoming.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">
                <Footprints className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No upcoming visits.</p>
              </CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {upcoming.map(visit => {
                      const isUnscheduled = !visit.scheduledAt;
                      return (
                        <div key={visit.id} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => setSelectedId(visit.id)}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{visit.purpose}</span>
                              {isUnscheduled ? (
                                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Unscheduled
                                </Badge>
                              ) : (
                                <Badge variant="outline" className={`text-xs ${VISIT_MODE_COLORS[visit.visitMode] ?? ''}`}>
                                  {VISIT_MODE_LABELS[visit.visitMode] ?? visit.visitMode}
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                              {visit.customerName && (
                                <button
                                  className="flex items-center gap-1 hover:text-primary hover:underline"
                                  onClick={e => { e.stopPropagation(); setLocation(`/customers/${(visit as any).customerId}`); }}
                                >
                                  <User className="w-3 h-3" />{visit.customerName}
                                </button>
                              )}
                              {(() => {
                                const v = visit as typeof visit & { propertyAddress?: string | null; propertyLat?: number | null; propertyLng?: number | null };
                                const url = directionsUrl({ lat: v.propertyLat, lng: v.propertyLng, address: v.propertyAddress });
                                return v.propertyAddress && url ? (
                                  <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary hover:underline" onClick={e => e.stopPropagation()} data-testid={`link-visit-directions-${visit.id}`}>
                                    <MapPin className="w-3 h-3" />{v.propertyAddress}
                                  </a>
                                ) : null;
                              })()}
                              {visit.assigneeName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{visit.assigneeName}</span>}
                              {visit.scheduledAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(visit.scheduledAt), 'MMM d, h:mm a')}</span>}
                            </div>
                          </div>
                          {!isUnscheduled && <VisitClockControl visitId={visit.id} compact />}
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          )}

          {/* Completed */}
          {visitStatusFilter !== 'upcoming' && completed.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Completed</h2>
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {completed.map(visit => (
                      <div key={visit.id} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 cursor-pointer transition-colors opacity-70" onClick={() => setSelectedId(visit.id)}>
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium truncate">{visit.purpose}</span>
                          {visit.completedAt && (
                            <p className="text-xs text-muted-foreground mt-0.5">Completed {format(new Date(visit.completedAt), 'MMM d, yyyy')}</p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Create Sheet */}
      <Sheet open={createOpen} onOpenChange={open => { if (!open) setCreateOpen(false); }}>
        <SheetContent className="w-full sm:max-w-[75vw] overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Schedule a Visit</SheetTitle>
            <SheetDescription>Book a visit with a date, property, and assigned technician. Mark it complete when done.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Purpose <span className="text-destructive">*</span></label>
              <Input title="Brief description of why this visit is being made" placeholder="e.g. Follow up on irrigation repair" value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date & Time <span className="text-destructive">*</span></label>
              <Input type="datetime-local" title="Scheduled date and time for this visit" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Customer</label>
              <Select value={form.customerId} onValueChange={v => setForm(f => ({ ...f, customerId: v, propertyId: '' }))}>
                <SelectTrigger title="Customer this visit is for"><SelectValue placeholder="Select customer..." /></SelectTrigger>
                <SelectContent>{(customers?.items ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property <span className="text-destructive">*</span></label>
              <Select value={form.propertyId} onValueChange={v => setForm(f => ({ ...f, propertyId: v }))} disabled={!form.customerId}>
                <SelectTrigger title="Property to visit"><SelectValue placeholder={form.customerId ? 'Select property…' : 'Select a customer first'} /></SelectTrigger>
                <SelectContent>
                  {(customerProperties ?? []).map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.address}{p.city ? `, ${p.city}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              {!form.customerId && <p className="text-xs text-muted-foreground">Select a customer to choose their property.</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Assign To <span className="text-destructive">*</span></label>
              <Select value={form.assigneeId} onValueChange={v => setForm(f => ({ ...f, assigneeId: v }))}>
                <SelectTrigger title="Technician assigned to this visit"><SelectValue placeholder="Select technician..." /></SelectTrigger>
                <SelectContent>{(users ?? []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={3} title="Additional context or instructions for this visit" placeholder="Additional context..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">SMS Reminder</label>
                <p className="text-xs text-muted-foreground">Send customer an SMS before this visit.</p>
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, smsReminderEnabled: !f.smsReminderEnabled }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.smsReminderEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.smsReminderEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createVisit.isPending}>
                {createVisit.isPending ? 'Saving...' : 'Schedule Visit'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Visit Detail Sheet */}
      <Sheet open={selectedId != null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full sm:max-w-[75vw] overflow-y-auto">
          {selectedVisit && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-center gap-2">
                  <SheetTitle className="flex-1">{selectedVisit.purpose}</SheetTitle>
                  <Badge variant="outline" className={`capitalize text-xs ${VISIT_MODE_COLORS[selectedVisit.visitMode] ?? ''}`}>
                    {VISIT_MODE_LABELS[selectedVisit.visitMode] ?? selectedVisit.visitMode}
                  </Badge>
                </div>
                <SheetDescription>Visit #{selectedVisit.id} · {format(new Date(selectedVisit.createdAt), 'MMM d, yyyy')}</SheetDescription>
              </SheetHeader>

              <div className="space-y-5">
                <VisitClockControl visitId={selectedVisit.id} completed={!!selectedVisit.completedAt} />
                {/* Actions */}
                {!selectedVisit.completedAt && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" title="Edit this visit's details" className="gap-2" onClick={() => setEditingVisit({ id: selectedVisit.id, purpose: selectedVisit.purpose, notes: (selectedVisit as any).notes ?? null, scheduledAt: selectedVisit.scheduledAt ? new Date(selectedVisit.scheduledAt).toISOString().slice(0, 16) : undefined })}>
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" title="Mark this visit as completed" className="gap-2" onClick={() => { setCompleteOpen(selectedVisit.id); }}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Mark Complete
                    </Button>
                    {!selectedVisit.convertedToEstimateId && (
                      <Button size="sm" variant="outline" title="Create a new estimate based on this visit" className="gap-2" onClick={() => handleConvertToEstimate(selectedVisit.id)} disabled={convertToEstimate.isPending}>
                        <FileText className="w-3.5 h-3.5" /> Convert to Estimate
                      </Button>
                    )}
                    {!selectedVisit.convertedToJobId && (
                      <Button size="sm" variant="outline" title="Create a new job based on this visit" className="gap-2" onClick={() => handleConvertToJob(selectedVisit.id)} disabled={convertToJob.isPending}>
                        <Briefcase className="w-3.5 h-3.5" /> Convert to Job
                      </Button>
                    )}
                  </div>
                )}

                {selectedVisit.convertedToEstimateId && (
                  <button className="text-sm text-emerald-700 flex items-center gap-1 hover:underline" onClick={() => { setSelectedId(null); setLocation(`/estimates?highlight=${selectedVisit.convertedToEstimateId}`); }}>
                    <CheckCircle2 className="w-4 h-4" /> → Estimate #{selectedVisit.convertedToEstimateId}
                  </button>
                )}
                {selectedVisit.convertedToJobId && (
                  <button className="text-sm text-emerald-700 flex items-center gap-1 hover:underline" onClick={() => { setSelectedId(null); setLocation(`/schedule?jobId=${selectedVisit.convertedToJobId}`); }}>
                    <CheckCircle2 className="w-4 h-4" /> → Job #{selectedVisit.convertedToJobId}
                  </button>
                )}

                <Separator />

                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedVisit.customerName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customer</p>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        {(selectedVisit as any).customerId ? (
                          <button className="text-sm text-primary hover:underline" onClick={() => { setSelectedId(null); setLocation(`/customers/${(selectedVisit as any).customerId}`); }}>{selectedVisit.customerName}</button>
                        ) : selectedVisit.customerName}
                      </div>
                    </div>
                  )}
                  {selectedVisit.assigneeName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Assignee</p>
                      <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" />{selectedVisit.assigneeName}</div>
                    </div>
                  )}
                  {selectedVisit.scheduledAt && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Scheduled</p>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        {format(new Date(selectedVisit.scheduledAt), 'MMM d, yyyy h:mm a')}
                        {(selectedVisit as any).status !== 'completed' && (
                          <button
                            className="ml-1 text-xs text-primary hover:underline"
                            onClick={() => setEditingVisit({ id: selectedVisit.id, purpose: selectedVisit.purpose, notes: (selectedVisit as any).notes ?? null, scheduledAt: selectedVisit.scheduledAt ? new Date(selectedVisit.scheduledAt).toISOString().slice(0, 16) : undefined })}
                          >
                            Reschedule
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {selectedVisit.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Notes</p>
                    <p className="text-sm">{selectedVisit.notes}</p>
                  </div>
                )}

                {selectedVisit.completedAt && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Completed</p>
                      <p className="text-sm">{format(new Date(selectedVisit.completedAt), 'MMM d, yyyy h:mm a')}</p>
                      {selectedVisit.outcomeNotes && (
                        <>
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1 mt-3">Outcome Notes</p>
                          <p className="text-sm">{selectedVisit.outcomeNotes}</p>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Edit Visit Dialog */}
      <Sheet open={editingVisit != null} onOpenChange={open => { if (!open) setEditingVisit(null); }}>
        <SheetContent className="w-full sm:max-w-[75vw]">
          <SheetHeader>
            <SheetTitle>Edit Visit</SheetTitle>
            <SheetDescription>Update visit details or reschedule.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Scheduled Date & Time</label>
              <Input
                type="datetime-local"
                title="Rescheduled date and time for this visit"
                value={editingVisit?.scheduledAt ?? ''}
                onChange={e => setEditingVisit(v => v ? { ...v, scheduledAt: e.target.value } : v)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Purpose</label>
              <Input
                title="Brief description of the visit purpose"
                value={editingVisit?.purpose ?? ''}
                onChange={e => setEditingVisit(v => v ? { ...v, purpose: e.target.value } : v)}
                placeholder="Visit purpose..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                rows={4}
                title="Additional context or instructions for this visit"
                value={editingVisit?.notes ?? ''}
                onChange={e => setEditingVisit(v => v ? { ...v, notes: e.target.value } : v)}
                placeholder="Notes (optional)..."
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setEditingVisit(null)}>Cancel</Button>
              <Button
                title="Save changes to this visit"
                disabled={updateVisit.isPending}
                onClick={() => {
                  if (!editingVisit || !editingVisit.purpose.trim()) { toast.error('Purpose is required'); return; }
                  updateVisit.mutate(
                    { id: editingVisit.id, data: { purpose: editingVisit.purpose, notes: editingVisit.notes ?? undefined, ...(editingVisit.scheduledAt ? { scheduledAt: new Date(editingVisit.scheduledAt).toISOString() } : {}) } as any },
                    {
                      onSuccess: () => {
                        toast.success('Visit updated');
                        invalidate();
                        setEditingVisit(null);
                      },
                      onError: () => toast.error('Failed to update visit'),
                    },
                  );
                }}
              >
                {updateVisit.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Complete Dialog */}
      <Sheet open={completeOpen != null} onOpenChange={open => { if (!open) setCompleteOpen(null); }}>
        <SheetContent className="w-full sm:max-w-[75vw]">
          <SheetHeader>
            <SheetTitle>Complete Visit</SheetTitle>
            <SheetDescription>Optionally record what happened during this visit.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <Textarea
              rows={4}
              title="Notes describing what happened during this visit (optional)"
              placeholder="Outcome notes (optional)..."
              value={outcomeNotes}
              onChange={e => setOutcomeNotes(e.target.value)}
            />
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-input"
                checked={createFollowUp}
                onChange={e => setCreateFollowUp(e.target.checked)}
              />
              <span className="text-sm">Create a follow-up job after completing</span>
            </label>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCompleteOpen(null)}>Cancel</Button>
              <Button title="Mark this visit as completed" onClick={() => completeOpen && handleComplete(completeOpen)} disabled={completeVisit.isPending}>
                {completeVisit.isPending ? 'Saving...' : 'Mark Complete'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
