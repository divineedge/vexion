import { usePortalListJobs, usePortalRequestJobCancellation, usePortalGetJobDetail, getPortalListJobsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { CalendarClock, MapPin, Briefcase, Clock, CheckCircle2, User, Search, Ban, FlaskConical, Package, ChevronRight, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function Jobs() {
  const { data: jobs, isLoading } = usePortalListJobs();
  const qc = useQueryClient();
  const requestCancellation = usePortalRequestJobCancellation();
  const [jobSearch, setJobSearch] = useState('');
  const [cancelDialogJobId, setCancelDialogJobId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [detailJobId, setDetailJobId] = useState<number | null>(null);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"><CalendarClock className="w-3 h-3 mr-1"/> Scheduled</Badge>;
      case "in_progress": return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"><Clock className="w-3 h-3 mr-1"/> In Progress</Badge>;
      case "completed": return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle2 className="w-3 h-3 mr-1"/> Completed</Badge>;
      case "cancelled": return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const upcomingJobs = (jobs?.filter(j => j.status === 'scheduled' || j.status === 'in_progress') || []).filter(j => !jobSearch || j.title.toLowerCase().includes(jobSearch.toLowerCase()) || (j.propertyAddress ?? '').toLowerCase().includes(jobSearch.toLowerCase()));
  const pastJobs = (jobs?.filter(j => j.status === 'completed' || j.status === 'cancelled') || []).filter(j => !jobSearch || j.title.toLowerCase().includes(jobSearch.toLowerCase()) || (j.propertyAddress ?? '').toLowerCase().includes(jobSearch.toLowerCase()));

  const handleRequestCancellation = () => {
    if (!cancelDialogJobId) return;
    requestCancellation.mutate(
      { id: cancelDialogJobId, data: cancelReason.trim() ? { reason: cancelReason.trim() } : undefined },
      {
        onSuccess: () => {
          toast.success('Cancellation request submitted. Our team will be in touch shortly.');
          qc.invalidateQueries({ queryKey: getPortalListJobsQueryKey() });
          setCancelDialogJobId(null);
          setCancelReason('');
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? 'Failed to submit cancellation request.';
          toast.error(msg);
        },
      },
    );
  };

  const JobCard = ({ job, showCancel }: { job: any; showCancel?: boolean }) => (
    <Card className="shadow-sm overflow-hidden group cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDetailJobId(job.id)}>
      <div className="h-2 w-full bg-secondary"></div>
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h3 className="text-xl font-bold text-foreground">{job.title}</h3>
              {getStatusBadge(job.status)}
              {job.cancellationRequestedAt && (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1 text-xs">
                  <Ban className="w-3 h-3" /> Cancellation Requested
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
          
          <div className="md:text-right bg-muted/30 p-4 rounded-lg border border-border/50 min-w-[150px]">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">TOTAL</p>
            <p className="text-2xl font-bold text-foreground">
              {formatCurrency(job.totalAmount)}
            </p>
          </div>
        </div>

        {/* Cancel request button / pending notice */}
        {showCancel && (
          <div className="mt-2 pt-4 border-t border-border/50 flex items-center justify-between gap-4">
            {job.cancellationRequestedAt ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Ban className="w-4 h-4 text-red-500 shrink-0" />
                Your cancellation request is pending review. We'll confirm shortly.
              </p>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/30 hover:bg-destructive/5 gap-2"
                onClick={(e) => { e.stopPropagation(); setCancelDialogJobId(job.id); setCancelReason(''); }}
              >
                <Ban className="w-4 h-4" />
                Request Cancellation
              </Button>
            )}
            <ChevronRight className="w-4 h-4 text-muted-foreground opacity-40 shrink-0" />
          </div>
        )}
        {!showCancel && (
          <div className="flex justify-end pt-1">
            <ChevronRight className="w-4 h-4 text-muted-foreground opacity-40" />
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Service History</h1>
        <p className="text-muted-foreground mt-1">View your scheduled and past appointments.</p>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input placeholder="Search by job or address…" value={jobSearch} onChange={e => setJobSearch(e.target.value)} className="pl-8 h-9 text-sm" />
      </div>

      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="upcoming">Upcoming & Active {upcomingJobs.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center bg-primary text-primary-foreground rounded-full text-[10px] font-bold w-4 h-4">{upcomingJobs.length}</span>}</TabsTrigger>
          <TabsTrigger value="past">Past Services {pastJobs.length > 0 && <span className="ml-1.5 inline-flex items-center justify-center bg-muted text-muted-foreground rounded-full text-[10px] font-medium w-4 h-4">{pastJobs.length}</span>}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="upcoming" className="mt-6 space-y-4">
          {isLoading ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
          ) : upcomingJobs.length > 0 ? (
            upcomingJobs.map(job => <JobCard key={job.id} job={job} showCancel />)
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

      {/* Cancellation confirmation dialog */}
      <Dialog open={cancelDialogJobId !== null} onOpenChange={open => { if (!open) { setCancelDialogJobId(null); setCancelReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Cancellation</DialogTitle>
            <DialogDescription>
              Your request will be sent to our team for review. This does not immediately cancel the appointment — we'll confirm with you shortly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Textarea
              placeholder="Let us know why you'd like to cancel…"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelDialogJobId(null); setCancelReason(''); }}>
              Never mind
            </Button>
            <Button
              variant="destructive"
              onClick={handleRequestCancellation}
              disabled={requestCancellation.isPending}
            >
              {requestCancellation.isPending ? 'Submitting…' : 'Submit Request'}
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
  const { data: job, isLoading } = usePortalGetJobDetail(jobId ?? 0);

  const open = jobId !== null;

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {isLoading || !job ? (
          <div className="space-y-4 py-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
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
                    {job.chemicalApplications.map((app, i) => (
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
                      </div>
                    ))}
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
