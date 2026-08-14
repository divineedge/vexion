import { usePortalListJobs, usePortalRequestJobCancellation, usePortalRequestJobReschedule, usePortalGetJobDetail, getPortalListJobsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { CalendarClock, MapPin, Briefcase, Clock, CheckCircle2, User, Search, Ban, CalendarSearch, FlaskConical, Package, ChevronRight, CloudRain, ShieldAlert, AlertCircle, DollarSign, TriangleAlert, Repeat } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type RequestType = "cancel" | "reschedule";

interface RequestDialogState {
  jobId: number;
  type: RequestType;
}

export default function Jobs() {
  const { data: jobs, isLoading } = usePortalListJobs();
  const qc = useQueryClient();
  const requestCancellation = usePortalRequestJobCancellation();
  const requestReschedule = usePortalRequestJobReschedule();

  const [jobSearch, setJobSearch] = useState('');
  const [requestDialog, setRequestDialog] = useState<RequestDialogState | null>(null);
  const [requestReason, setRequestReason] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [detailJobId, setDetailJobId] = useState<number | null>(null);

  const closeRequestDialog = () => {
    setRequestDialog(null);
    setRequestReason('');
    setPreferredDate('');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"><CalendarClock className="w-3 h-3 mr-1"/> Scheduled</Badge>;
      case "in_progress": return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"><Clock className="w-3 h-3 mr-1"/> In Progress</Badge>;
      case "completed": return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3 mr-1"/> Completed</Badge>;
      case "cancelled": return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Upcoming: next 30 days only, sorted soonest-first, one entry per recurring plan
  const allUpcoming = (jobs?.filter(j =>
    (j.status === 'scheduled' || j.status === 'in_progress') &&
    new Date((j as any).scheduledAt) <= thirtyDaysOut,
  ) ?? []).sort((a, b) => new Date((a as any).scheduledAt).getTime() - new Date((b as any).scheduledAt).getTime());

  const seenPlanIds = new Set<number>();
  const upcomingJobs = allUpcoming
    .filter(j => {
      const planId: number | null = (j as any).planId ?? null;
      if (planId == null) return true;          // one-off job — always include
      if (seenPlanIds.has(planId)) return false; // already showing this plan
      seenPlanIds.add(planId);
      return true;
    })
    .filter(j => !jobSearch || j.title.toLowerCase().includes(jobSearch.toLowerCase()) || ((j as any).propertyAddress ?? '').toLowerCase().includes(jobSearch.toLowerCase()));

  const pastJobs = (jobs?.filter(j => j.status === 'completed' || j.status === 'cancelled') || []).filter(j => !jobSearch || j.title.toLowerCase().includes(jobSearch.toLowerCase()) || ((j as any).propertyAddress ?? '').toLowerCase().includes(jobSearch.toLowerCase()));

  const handleSubmitRequest = () => {
    if (!requestDialog) return;
    const { jobId, type } = requestDialog;

    if (type === "cancel") {
      requestCancellation.mutate(
        { id: jobId, data: requestReason.trim() ? { reason: requestReason.trim() } : undefined },
        {
          onSuccess: () => {
            toast.success('Cancellation request submitted. Our team will be in touch shortly.');
            qc.invalidateQueries({ queryKey: getPortalListJobsQueryKey() });
            closeRequestDialog();
          },
          onError: (err: any) => {
            toast.error(err?.response?.data?.error ?? 'Failed to submit cancellation request.');
          },
        },
      );
    } else {
      requestReschedule.mutate(
        {
          id: jobId,
          data: {
            ...(requestReason.trim() ? { reason: requestReason.trim() } : {}),
            ...(preferredDate ? { preferredDate } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.success('Reschedule request submitted. Our team will be in touch shortly.');
            qc.invalidateQueries({ queryKey: getPortalListJobsQueryKey() });
            closeRequestDialog();
          },
          onError: (err: any) => {
            toast.error(err?.response?.data?.error ?? 'Failed to submit reschedule request.');
          },
        },
      );
    }
  };

  const isPending = requestCancellation.isPending || requestReschedule.isPending;

  const PriceDisplay = ({ job }: { job: any }) => {
    const isPlanVisit = job.planId != null && (job.totalAmount === 0 || job.totalAmount == null);
    return (
      <div className="md:text-right bg-muted/30 p-4 rounded-lg border border-border/50 min-w-[150px]">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">TOTAL</p>
        {isPlanVisit ? (
          <p className="text-sm font-semibold text-muted-foreground">Included in plan</p>
        ) : (
          <p className="text-2xl font-bold text-foreground">{formatCurrency(job.totalAmount)}</p>
        )}
      </div>
    );
  };

  const JobCard = ({ job, showActions }: { job: any; showActions?: boolean }) => {
    const cancelStatus: string | null = (job as any).cancelRequestStatus ?? null;
    const rescheduleStatus: string | null = (job as any).rescheduleRequestStatus ?? null;
    // A request is "pending" if status is explicitly 'pending' or if the timestamp is set but no status yet (legacy)
    const hasCancelPending = cancelStatus === 'pending' || (!cancelStatus && !!(job as any).cancellationRequestedAt);
    const hasReschedulePending = rescheduleStatus === 'pending' || (!rescheduleStatus && !!(job as any).rescheduleRequestedAt);
    const hasCancelDeclined = cancelStatus === 'declined';
    const hasCancelApproved = cancelStatus === 'approved';
    const hasRescheduleDeclined = rescheduleStatus === 'declined';
    const hasRescheduleApproved = rescheduleStatus === 'approved';
    const hasPendingRequest = hasCancelPending || hasReschedulePending;

    return (
      <Card className="shadow-sm overflow-hidden group cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDetailJobId(job.id)}>
        <div className="h-2 w-full bg-secondary"></div>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h3 className="text-xl font-bold text-foreground">{job.title}</h3>
                {getStatusBadge(job.status)}
                {(job as any).planId != null && (
                  <Badge variant="outline" className="text-xs gap-1 text-indigo-700 border-indigo-200 bg-indigo-50 dark:bg-indigo-900/20 dark:text-indigo-300">
                    <Repeat className="w-3 h-3" /> Recurring
                  </Badge>
                )}
                {hasCancelPending && (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1 text-xs">
                    <Ban className="w-3 h-3" /> Cancellation Requested
                  </Badge>
                )}
                {hasCancelDeclined && (
                  <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200 gap-1 text-xs">
                    <Ban className="w-3 h-3" /> Cancellation Declined
                  </Badge>
                )}
                {hasCancelApproved && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1 text-xs">
                    <CheckCircle2 className="w-3 h-3" /> Cancellation Approved
                  </Badge>
                )}
                {hasReschedulePending && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1 text-xs">
                    <CalendarSearch className="w-3 h-3" /> Reschedule Requested
                  </Badge>
                )}
                {hasRescheduleApproved && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1 text-xs">
                    <CalendarSearch className="w-3 h-3" /> Reschedule Approved
                  </Badge>
                )}
                {hasRescheduleDeclined && (
                  <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200 gap-1 text-xs">
                    <CalendarSearch className="w-3 h-3" /> Reschedule Declined
                  </Badge>
                )}
              </div>
              {job.description && (
                <p className="text-sm text-muted-foreground mb-4">{job.description}</p>
              )}
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6">
                <div className="flex items-start gap-2">
                  <CalendarClock className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">SCHEDULED</p>
                    <p className="text-sm text-foreground">{formatDateTime(job.scheduledAt)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">LOCATION</p>
                    <p className="text-sm text-foreground">{job.propertyAddress}</p>
                  </div>
                </div>
                {job.assignedToName && (
                  <div className="flex items-start gap-2">
                    <User className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">TECHNICIAN</p>
                      <p className="text-sm text-foreground">{job.assignedToName}</p>
                    </div>
                  </div>
                )}
                {job.status === 'completed' && job.completedAt && (
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">COMPLETED</p>
                      <p className="text-sm text-foreground">{formatDate(job.completedAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <PriceDisplay job={job} />
          </div>

          {/* Action bar / pending notice / staff response */}
          {showActions && (
            <div className="mt-2 pt-4 border-t border-border/50 space-y-3">
              {/* Terminal states: approved cancellation or pending requests — no action buttons shown */}
              {hasCancelApproved ? (
                <div className="space-y-1">
                  <p className="text-sm text-green-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" /> Your cancellation request was approved — this job has been cancelled.
                  </p>
                  {(job as any).cancelRequestReply && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">"{(job as any).cancelRequestReply}"</p>
                  )}
                </div>
              ) : hasRescheduleApproved && !hasPendingRequest ? (
                <p className="text-sm text-green-700 flex items-center gap-2">
                  <CalendarSearch className="w-4 h-4 shrink-0" /> Your reschedule was approved — see the updated date above.
                  {(job as any).rescheduleRequestReply && (
                    <span className="text-xs text-muted-foreground"> "{(job as any).rescheduleRequestReply}"</span>
                  )}
                </p>
              ) : hasPendingRequest ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  {hasCancelPending
                    ? <><Ban className="w-4 h-4 text-red-500 shrink-0" /> Your cancellation request is pending review.</>
                    : <><CalendarSearch className="w-4 h-4 text-amber-500 shrink-0" /> Your reschedule request is pending review.</>
                  }
                  {' '}We'll confirm shortly.
                </p>
              ) : null}

              {/* Staff response history for declined requests — shown alongside fresh action buttons */}
              {!hasCancelApproved && !hasPendingRequest && hasCancelDeclined && (
                <div className="space-y-1">
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <Ban className="w-4 h-4 shrink-0" /> Your previous cancellation request was not approved — your job remains scheduled.
                  </p>
                  {(job as any).cancelRequestReply && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">"{(job as any).cancelRequestReply}"</p>
                  )}
                </div>
              )}
              {!hasCancelApproved && !hasPendingRequest && hasRescheduleDeclined && (
                <div className="space-y-1">
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <CalendarSearch className="w-4 h-4 shrink-0" /> Your previous reschedule request was not approved — your job remains scheduled.
                  </p>
                  {(job as any).rescheduleRequestReply && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">"{(job as any).rescheduleRequestReply}"</p>
                  )}
                </div>
              )}

              {/* Fresh action buttons — show whenever job is scheduled and no request is actively pending */}
              {!hasCancelApproved && !hasPendingRequest && job.status === 'scheduled' && (
                <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-amber-700 border-amber-300 hover:bg-amber-50 gap-2"
                    onClick={() => { setRequestDialog({ jobId: job.id, type: "reschedule" }); setRequestReason(''); setPreferredDate(''); }}
                  >
                    <CalendarSearch className="w-4 h-4" />
                    Request Reschedule
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/5 gap-2"
                    onClick={() => { setRequestDialog({ jobId: job.id, type: "cancel" }); setRequestReason(''); setPreferredDate(''); }}
                  >
                    <Ban className="w-4 h-4" />
                    Request Cancellation
                  </Button>
                </div>
              )}
            </div>
          )}
          {!showActions && (
            <div className="flex justify-end pt-1">
              <ChevronRight className="w-4 h-4 text-muted-foreground opacity-40" />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">My Services</h1>
        <p className="text-muted-foreground mt-1">Upcoming appointments and past service history.</p>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input placeholder="Search by job or address…" value={jobSearch} onChange={e => setJobSearch(e.target.value)} className="pl-8 h-9 text-sm" />
      </div>

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="upcoming">Next 30 Days {upcomingJobs.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center bg-primary text-primary-foreground rounded-full text-[10px] font-bold w-4 h-4">{upcomingJobs.length}</span>}</TabsTrigger>
          <TabsTrigger value="past">Past Services {pastJobs.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center bg-muted text-muted-foreground rounded-full text-[10px] font-medium w-4 h-4">{pastJobs.length}</span>}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="upcoming" className="mt-6 space-y-4">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
          ) : upcomingJobs.length > 0 ? (
            upcomingJobs.map(job => <JobCard key={job.id} job={job} showActions />)
          ) : (
            <Card className="border-dashed shadow-none bg-muted/20">
              <CardContent className="p-12 text-center">
                <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground mb-2">No upcoming services</h3>
                <p className="text-muted-foreground">You don't have any jobs scheduled at the moment.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        <TabsContent value="past" className="mt-6 space-y-4">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
          ) : pastJobs.length > 0 ? (
            pastJobs.map(job => <JobCard key={job.id} job={job} />)
          ) : (
            <Card className="border-dashed shadow-none bg-muted/20">
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground mb-2">No past services</h3>
                <p className="text-muted-foreground">You haven't had any services completed yet.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Shared cancellation / reschedule request dialog */}
      <Dialog open={requestDialog !== null} onOpenChange={open => { if (!open) closeRequestDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {requestDialog?.type === "reschedule" ? "Request Reschedule" : "Request Cancellation"}
            </DialogTitle>
            <DialogDescription>
              {requestDialog?.type === "reschedule"
                ? "Let us know you'd like a new date and we'll reach out to confirm."
                : "Your request will be sent to our team for review. This does not immediately cancel the appointment — we'll confirm with you shortly."}
            </DialogDescription>
          </DialogHeader>

          {/* Fee warning — shown for both types */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <p>
              <span className="font-semibold">Please note —</span> cancellations or rescheduling may be subject to an additional charge. A team member will reach out to confirm.
            </p>
          </div>

          <div className="space-y-3">
            {/* Preferred date — only for reschedule */}
            {requestDialog?.type === "reschedule" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Preferred new date <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input
                  type="date"
                  value={preferredDate}
                  onChange={e => setPreferredDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {requestDialog?.type === "reschedule" ? "Reason / notes" : "Reason"}
                {" "}<span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Textarea
                placeholder={requestDialog?.type === "reschedule"
                  ? "Let us know why you need to reschedule or any other details…"
                  : "Let us know why you'd like to cancel…"}
                value={requestReason}
                onChange={e => setRequestReason(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeRequestDialog}>
              Never mind
            </Button>
            <Button
              variant={requestDialog?.type === "reschedule" ? "default" : "destructive"}
              onClick={handleSubmitRequest}
              disabled={isPending}
            >
              {isPending ? 'Submitting…' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Job detail modal */}
      <JobDetailModal jobId={detailJobId} onClose={() => setDetailJobId(null)} />
    </div>
  );
}

function JobDetailModal({ jobId, onClose }: { jobId: number | null; onClose: () => void }) {
  const { data: job, isLoading, isError } = usePortalGetJobDetail(jobId ?? 0);

  const open = jobId !== null;
  const isPlanVisit = job?.planId != null && ((job as any).totalAmount === 0 || (job as any).totalAmount == null);

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {isLoading ? (
          <div className="space-y-4 py-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : isError || !job ? (
          <div className="py-10 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
            <p className="font-medium text-foreground">Couldn't load job details</p>
            <p className="text-sm text-muted-foreground">Please close and try again, or contact us if the issue persists.</p>
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl leading-tight">{job.title}</DialogTitle>
              {job.description && (
                <DialogDescription className="text-sm">{job.description}</DialogDescription>
              )}
            </DialogHeader>

            <div className="space-y-6 pt-2">
              {/* Price */}
              <div className="flex items-center justify-between rounded-lg bg-muted/40 border border-border/60 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="w-4 h-4" />
                  <span>Total</span>
                </div>
                {isPlanVisit ? (
                  <span className="text-sm font-medium text-muted-foreground">Included in plan</span>
                ) : (
                  <span className="text-xl font-bold text-foreground">{formatCurrency((job as any).totalAmount)}</span>
                )}
              </div>

              {/* Service Timeline */}
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" /> Service Timeline
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Scheduled</span>
                    <span className="font-medium text-foreground">{formatDateTime(job.scheduledAt)}</span>
                  </div>
                  {job.assignedToName && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Technician</span>
                      <span className="font-medium text-foreground">{job.assignedToName}</span>
                    </div>
                  )}
                  {job.clockInAt && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Technician arrived</span>
                      <span className="font-medium text-foreground">{formatDateTime(job.clockInAt)}</span>
                    </div>
                  )}
                  {job.completedAt && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Completed</span>
                      <span className="font-medium text-green-600">{formatDateTime(job.completedAt)}</span>
                    </div>
                  )}
                  {job.propertyAddress && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Location</span>
                      <span className="font-medium text-foreground text-right max-w-[60%]">{job.propertyAddress}</span>
                    </div>
                  )}
                  {!job.clockInAt && !job.completedAt && (
                    <p className="text-xs text-muted-foreground italic">Service has not started yet.</p>
                  )}
                </div>
              </section>

              {/* Materials Used — hidden when empty */}
              {job.parts.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                    <Package className="w-3.5 h-3.5" /> Materials Used
                  </h4>
                  <div className="divide-y divide-border rounded-lg border overflow-hidden">
                    {job.parts.map((part, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="text-foreground">{part.name ?? '—'}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {part.quantity != null ? part.quantity : '—'}{part.unit ? ` ${part.unit}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Chemical Applications — hidden when empty */}
              {job.chemicalApplications.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                    <FlaskConical className="w-3.5 h-3.5" /> What Was Applied
                  </h4>
                  <div className="space-y-3">
                    {job.chemicalApplications.map((app, i) => {
                      const now = new Date();
                      const rainfastActive = app.rainfastUntil && new Date(app.rainfastUntil) > now;
                      const reentryActive = app.reentryUntil && new Date(app.reentryUntil) > now;
                      return (
                        <div key={app.id ?? i} className="rounded-lg border bg-muted/20 p-4 space-y-1.5">
                          <p className="text-sm font-medium text-foreground">{app.productName ?? 'Unknown product'}</p>
                          {app.mixtureName && (
                            <p className="text-xs text-muted-foreground">Mixture: {app.mixtureName}</p>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>{app.volumeApplied} {app.volumeUnit} applied</span>
                            {app.treatedArea != null && (
                              <span>{app.treatedArea} {app.areaUnit ?? ''} treated</span>
                            )}
                            {app.treatedZoneName && (
                              <span>Zone: {app.treatedZoneName}</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{formatDateTime(app.appliedAt)}</p>
                          {/* Rainfast / Re-entry timers */}
                          {(app.rainfastUntil || app.reentryUntil) && (
                            <div className="pt-1 border-t border-border/50 space-y-1">
                              {app.rainfastUntil && (
                                <div className={`flex items-center gap-1.5 text-xs ${rainfastActive ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-muted-foreground'}`}>
                                  <CloudRain className="w-3 h-3 shrink-0" />
                                  {rainfastActive
                                    ? <>Rainfast until <strong>{formatDateTime(app.rainfastUntil)}</strong></>
                                    : <>Rainfast cleared: {formatDateTime(app.rainfastUntil)}</>}
                                </div>
                              )}
                              {app.reentryUntil && (
                                <div className={`flex items-center gap-1.5 text-xs ${reentryActive ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}`}>
                                  <ShieldAlert className="w-3 h-3 shrink-0" />
                                  {reentryActive
                                    ? <>Re-entry restricted until <strong>{formatDateTime(app.reentryUntil)}</strong></>
                                    : <>Re-entry allowed from: {formatDateTime(app.reentryUntil)}</>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
