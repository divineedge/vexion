import React, { useState } from 'react';
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
} from '@workspace/api-client-react';
import { format } from 'date-fns';
import {
  Plus, MapPin, User, Clock, CheckCircle2, ChevronRight, FileText, Briefcase, Footprints,
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

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState<number | null>(null);
  const [outcomeNotes, setOutcomeNotes] = useState('');

  const [form, setForm] = useState({
    customerId: '',
    propertyId: '',
    assigneeId: '',
    visitMode: 'scheduled',
    purpose: '',
    notes: '',
    scheduledAt: '',
    smsReminderEnabled: false,
  });

  const { data: visits, isLoading } = useListVisits({}, { query: { queryKey: getListVisitsQueryKey({}) } });
  const { data: selectedVisit } = useGetVisit(selectedId!, {
    query: { enabled: selectedId != null, queryKey: getGetVisitQueryKey(selectedId!) },
  });
  const { data: customers } = useListCustomers({}, { query: { enabled: createOpen, queryKey: getListCustomersQueryKey({}) } });
  const { data: users } = useListUsers({ query: { enabled: createOpen, queryKey: getListUsersQueryKey() } });

  const createVisit = useCreateVisit();
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
    createVisit.mutate({
      data: {
        customerId: form.customerId ? parseInt(form.customerId, 10) : undefined,
        assigneeId: form.assigneeId ? parseInt(form.assigneeId, 10) : undefined,
        visitMode: form.visitMode as 'scheduled' | 'drop_by' | 'drive_by',
        purpose: form.purpose,
        notes: form.notes || undefined,
        scheduledAt: form.scheduledAt || undefined,
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
    completeVisit.mutate({ id, data: { outcomeNotes: outcomeNotes || undefined } }, {
      onSuccess: () => {
        toast.success('Visit marked complete');
        invalidate();
        setCompleteOpen(null);
        setOutcomeNotes('');
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
      onError: () => toast.error('Failed to convert to job'),
    });
  }

  const upcoming = visits?.filter(v => !v.completedAt) ?? [];
  const completed = visits?.filter(v => v.completedAt) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Visits</h1>
          <p className="text-muted-foreground mt-1">Track customer visits, follow-ups, and site check-ins.</p>
        </div>
        {canManageJobs && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Log Visit
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading visits...</div>
      ) : (
        <div className="space-y-6">
          {/* Upcoming */}
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
                    {upcoming.map(visit => (
                      <div key={visit.id} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => setSelectedId(visit.id)}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium truncate">{visit.purpose}</span>
                            <Badge variant="outline" className={`text-xs ${VISIT_MODE_COLORS[visit.visitMode] ?? ''}`}>
                              {VISIT_MODE_LABELS[visit.visitMode] ?? visit.visitMode}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                            {visit.customerName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{visit.customerName}</span>}
                            {visit.assigneeName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{visit.assigneeName}</span>}
                            {visit.scheduledAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(visit.scheduledAt), 'MMM d, h:mm a')}</span>}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Completed */}
          {completed.length > 0 && (
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
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Log a Visit</SheetTitle>
            <SheetDescription>Record a customer visit, check-in, or follow-up.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Purpose <span className="text-destructive">*</span></label>
              <Input placeholder="e.g. Follow up on irrigation repair" value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Visit Mode</label>
              <Select value={form.visitMode} onValueChange={v => setForm(f => ({ ...f, visitMode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled Appointment</SelectItem>
                  <SelectItem value="drop_by">Drop By / Flexible</SelectItem>
                  <SelectItem value="drive_by">Drive-By</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.visitMode === 'scheduled' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Date & Time</label>
                <Input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Customer</label>
              <Select value={form.customerId} onValueChange={v => setForm(f => ({ ...f, customerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
                <SelectContent>{(customers?.items ?? []).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Assign To</label>
              <Select value={form.assigneeId} onValueChange={v => setForm(f => ({ ...f, assigneeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select assignee..." /></SelectTrigger>
                <SelectContent>{(users ?? []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={3} placeholder="Additional context..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
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
                {createVisit.isPending ? 'Saving...' : 'Log Visit'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Visit Detail Sheet */}
      <Sheet open={selectedId != null} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
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
                {/* Actions */}
                {!selectedVisit.completedAt && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => { setCompleteOpen(selectedVisit.id); }}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Mark Complete
                    </Button>
                    {!selectedVisit.convertedToEstimateId && (
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => handleConvertToEstimate(selectedVisit.id)} disabled={convertToEstimate.isPending}>
                        <FileText className="w-3.5 h-3.5" /> Convert to Estimate
                      </Button>
                    )}
                    {!selectedVisit.convertedToJobId && (
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => handleConvertToJob(selectedVisit.id)} disabled={convertToJob.isPending}>
                        <Briefcase className="w-3.5 h-3.5" /> Convert to Job
                      </Button>
                    )}
                  </div>
                )}

                {selectedVisit.convertedToEstimateId && (
                  <p className="text-sm text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> → Estimate #{selectedVisit.convertedToEstimateId}</p>
                )}
                {selectedVisit.convertedToJobId && (
                  <p className="text-sm text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> → Job #{selectedVisit.convertedToJobId}</p>
                )}

                <Separator />

                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedVisit.customerName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customer</p>
                      <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" />{selectedVisit.customerName}</div>
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
                      <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" />{format(new Date(selectedVisit.scheduledAt), 'MMM d, yyyy h:mm a')}</div>
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

      {/* Complete Dialog */}
      <Sheet open={completeOpen != null} onOpenChange={open => { if (!open) setCompleteOpen(null); }}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Complete Visit</SheetTitle>
            <SheetDescription>Optionally record what happened during this visit.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <Textarea
              rows={4}
              placeholder="Outcome notes (optional)..."
              value={outcomeNotes}
              onChange={e => setOutcomeNotes(e.target.value)}
            />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCompleteOpen(null)}>Cancel</Button>
              <Button onClick={() => completeOpen && handleComplete(completeOpen)} disabled={completeVisit.isPending}>
                {completeVisit.isPending ? 'Saving...' : 'Mark Complete'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
