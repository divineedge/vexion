import React, { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useGetCustomerPlan, getGetCustomerPlanQueryKey,
  useUpdateCustomerPlan, useRenewCustomerPlan, useCancelPlanVisit,
  useReschedulePlanVisit, useListUsers,
} from '@workspace/api-client-react';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, CalendarClock, MapPin, DollarSign, X, CalendarDays, Snowflake } from 'lucide-react';
import { toast } from 'sonner';

interface ServiceRecord {
  id: number;
  name: string;
  offSeasonStart: string | null;
  offSeasonEnd: string | null;
}

function formatMMDD(mmdd: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [mm, dd] = mmdd.split('-');
  return `${months[parseInt(mm, 10) - 1] ?? mm} ${parseInt(dd, 10)}`;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-100 text-amber-700 border-amber-200',
  cancelled: 'bg-muted text-muted-foreground',
  pending_renewal: 'bg-blue-100 text-blue-700 border-blue-200',
};

const VISIT_STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-muted text-muted-foreground',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
};

/** Format a JS Date as a local YYYY-MM-DD string for <input type="date"> */
function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const planId = Number(id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  // Cancel visit dialog state
  const [cancelVisitId, setCancelVisitId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // Reschedule visit dialog state
  const [rescheduleVisitId, setRescheduleVisitId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleAssigneeId, setRescheduleAssigneeId] = useState<string>('_keep');

  const { data: plan, isLoading } = useGetCustomerPlan(planId, {
    query: { enabled: !!planId, queryKey: getGetCustomerPlanQueryKey(planId) },
  });
  const { data: users = [] } = useListUsers();

  // Fetch the current resolved price from the template's pricing matrix so staff
  // can see what the next renewal will cost even if property areas changed.
  // We always fetch when templateId + propertyId are available; the API response's
  // pricingMode tells us whether to show area-based messaging.
  const templateId: number | undefined = (plan as any)?.templateId;
  const propertyId: number | undefined = (plan as any)?.propertyId;
  const { data: resolvedPriceInfo } = useQuery<{
    resolvedPrice: number;
    pricingMode: string;
    breakdown?: Array<{ serviceId: number; serviceName: string; areaSqft: number; price: number }>;
  } | null>({
    queryKey: ['plan-resolved-price', templateId, propertyId],
    queryFn: async () => {
      if (!templateId || !propertyId) return null;
      return customFetch<{ resolvedPrice: number; pricingMode: string }>('/api/plan-templates/resolve-price', {
        method: 'POST',
        body: JSON.stringify({ templateId, propertyId }),
      });
    },
    enabled: !!plan && !!templateId && !!propertyId,
  });

  // Fetch services to display off-season windows
  const { data: allServices = [] } = useQuery<ServiceRecord[]>({
    queryKey: ['services'],
    queryFn: () => customFetch<ServiceRecord[]>('/api/services'),
  });
  const serviceMap = new Map(allServices.map(s => [s.id, s]));
  const invalidate = () => qc.invalidateQueries({ queryKey: getGetCustomerPlanQueryKey(planId) });

  const updateMutation = useUpdateCustomerPlan();
  const renewMutation = useRenewCustomerPlan();
  const cancelVisitMutation = useCancelPlanVisit();
  const rescheduleVisitMutation = useReschedulePlanVisit();

  const setStatus = (status: 'active' | 'paused' | 'cancelled' | 'pending_renewal') => {
    updateMutation.mutate({ id: planId, data: { status } }, {
      onSuccess: () => { toast.success(`Plan ${status.replace('_', ' ')}`); invalidate(); },
      onError: () => toast.error('Failed to update plan'),
    });
  };

  const toggleAutoRenew = (autoRenew: boolean) => {
    updateMutation.mutate({ id: planId, data: { autoRenew } }, {
      onSuccess: () => { toast.success(autoRenew ? 'Auto-renew enabled' : 'Auto-renew disabled'); invalidate(); },
      onError: () => toast.error('Failed to update plan'),
    });
  };

  const handleRenew = () => {
    renewMutation.mutate({ id: planId }, {
      onSuccess: () => { toast.success('Plan renewed and invoice generated'); invalidate(); },
      onError: () => toast.error('Failed to renew plan'),
    });
  };

  const confirmCancelVisit = () => {
    if (!cancelVisitId || !cancelReason.trim()) { toast.error('A reason is required'); return; }
    cancelVisitMutation.mutate({ id: planId, jobId: cancelVisitId, data: { reason: cancelReason } }, {
      onSuccess: () => { toast.success('Visit cancelled'); invalidate(); setCancelVisitId(null); setCancelReason(''); },
      onError: () => toast.error('Failed to cancel visit'),
    });
  };

  const openReschedule = (visitId: number, currentScheduledAt: string) => {
    setRescheduleVisitId(visitId);
    setRescheduleDate(toDateInputValue(new Date(currentScheduledAt)));
    setRescheduleAssigneeId('_keep');
  };

  const confirmRescheduleVisit = () => {
    if (!rescheduleVisitId || !rescheduleDate) { toast.error('A new date is required'); return; }
    // Build ISO timestamp from local date (noon UTC to avoid tz shift artifacts)
    const newScheduledAt = `${rescheduleDate}T12:00:00.000Z`;
    const data: { newScheduledAt: string; assigneeId?: number | null } = { newScheduledAt };
    if (rescheduleAssigneeId === '_unassign') {
      data.assigneeId = null;
    } else if (rescheduleAssigneeId !== '_keep') {
      data.assigneeId = Number(rescheduleAssigneeId);
    }
    rescheduleVisitMutation.mutate({ id: planId, jobId: rescheduleVisitId, data }, {
      onSuccess: () => {
        toast.success('Visit rescheduled');
        invalidate();
        setRescheduleVisitId(null);
        setRescheduleDate('');
        setRescheduleAssigneeId('_keep');
      },
      onError: () => toast.error('Failed to reschedule visit'),
    });
  };

  if (isLoading || !plan) {
    return <div className="py-16 text-center text-muted-foreground">Loading plan...</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Button variant="ghost" size="sm" className="gap-2 -ml-2" onClick={() => navigate('/plans')}>
        <ArrowLeft className="w-4 h-4" /> Back to Plans
      </Button>

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{plan.templateName}</h1>
            <Badge variant="outline" className={STATUS_STYLE[plan.status] ?? ''}>{plan.status.replace('_', ' ')}</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{plan.propertyAddress}</span>
            <span>{plan.customerName}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {plan.status === 'active' && <Button variant="outline" onClick={() => setStatus('paused')}>Pause Plan</Button>}
          {plan.status === 'paused' && <Button variant="outline" onClick={() => setStatus('active')}>Resume Plan</Button>}
          {plan.status !== 'cancelled' && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setStatus('cancelled')}>Cancel Plan</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-6">
          <p className="text-sm text-muted-foreground flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />Billed Price</p>
          <p className="text-2xl font-bold mt-1">${plan.billingPrice.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">/ {plan.billingCycle}</span></p>
          {resolvedPriceInfo && resolvedPriceInfo.pricingMode !== 'flat' && resolvedPriceInfo.resolvedPrice !== plan.billingPrice && (
            <p className="text-xs text-amber-600 mt-1">
              Current resolved: ${resolvedPriceInfo.resolvedPrice.toFixed(2)} — will apply on next renewal
            </p>
          )}
          {resolvedPriceInfo && resolvedPriceInfo.pricingMode !== 'flat' && resolvedPriceInfo.resolvedPrice === plan.billingPrice && (
            <p className="text-xs text-emerald-600 mt-1">Area-based pricing · up to date</p>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-6">
          <p className="text-sm text-muted-foreground flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />Next Billing</p>
          <p className="text-2xl font-bold mt-1">{plan.nextBillingDate}</p>
        </CardContent></Card>
        <Card><CardContent className="p-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Auto-Renew</p>
            <p className="text-lg font-semibold mt-1">{plan.autoRenew ? 'Enabled' : 'Disabled'}</p>
          </div>
          <Switch checked={plan.autoRenew} onCheckedChange={toggleAutoRenew} disabled={plan.status === 'cancelled'} />
        </CardContent></Card>
        <Card><CardContent className="p-6 flex flex-col justify-center">
          <Button size="sm" onClick={handleRenew} disabled={renewMutation.isPending || plan.status === 'cancelled'}>
            {renewMutation.isPending ? 'Renewing...' : 'Renew Now'}
          </Button>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled Visits</CardTitle>
          <CardDescription>All jobs generated from this plan, past and upcoming.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Visit</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-[90px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.visits.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No visits scheduled yet.</TableCell></TableRow>
              ) : plan.visits.map(v => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(v.scheduledAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{v.assigneeName ?? 'Unassigned'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={VISIT_STATUS_STYLE[v.status] ?? ''}>{v.status.replace('_', ' ')}</Badge>
                    {v.cancelReason && <p className="text-xs text-muted-foreground mt-1">{v.cancelReason}</p>}
                  </TableCell>
                  <TableCell>
                    {v.status === 'scheduled' && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Reschedule visit"
                          onClick={() => openReschedule(v.id, v.scheduledAt)}
                        >
                          <CalendarDays className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Cancel visit"
                          onClick={() => setCancelVisitId(v.id)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
          <CardDescription>Invoices generated for this plan's billing cycles.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.billingHistory.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No invoices yet.</TableCell></TableRow>
              ) : plan.billingHistory.map(inv => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-right font-medium">${inv.total.toFixed(2)}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="capitalize">{inv.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Services & Off-Season Windows */}
      {plan.serviceState && (plan.serviceState as any[]).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Services in this Plan</CardTitle>
            <CardDescription>Scheduled services and any configured off-season windows.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Off Season</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(plan.serviceState as any[]).map((svc: any) => {
                  const svcRecord = serviceMap.get(svc.serviceId);
                  return (
                    <TableRow key={svc.serviceId}>
                      <TableCell className="font-medium">{svc.serviceName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Every {svc.frequencyDays} day{svc.frequencyDays !== 1 ? 's' : ''}
                      </TableCell>
                      <TableCell>
                        {svcRecord?.offSeasonStart && svcRecord?.offSeasonEnd ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">
                            <Snowflake className="w-3 h-3" />
                            {formatMMDD(svcRecord.offSeasonStart)} – {formatMMDD(svcRecord.offSeasonEnd)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {plan.notes && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">{plan.notes}</CardContent></Card>
      )}

      {/* ── Reschedule Visit Dialog ── */}
      <Dialog
        open={rescheduleVisitId !== null}
        onOpenChange={open => { if (!open) { setRescheduleVisitId(null); setRescheduleDate(''); setRescheduleAssigneeId('_keep'); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule this visit</DialogTitle>
            <DialogDescription>
              Pick a new date for this visit. The rest of the plan's schedule stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-date">New date <span className="text-destructive">*</span></Label>
              <Input
                id="reschedule-date"
                type="date"
                value={rescheduleDate}
                onChange={e => setRescheduleDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-tech">Technician</Label>
              <Select value={rescheduleAssigneeId} onValueChange={setRescheduleAssigneeId}>
                <SelectTrigger id="reschedule-tech">
                  <SelectValue placeholder="Keep current technician" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_keep">Keep current technician</SelectItem>
                  <SelectItem value="_unassign">Unassign</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleVisitId(null)}>Back</Button>
            <Button onClick={confirmRescheduleVisit} disabled={rescheduleVisitMutation.isPending || !rescheduleDate}>
              {rescheduleVisitMutation.isPending ? 'Saving…' : 'Reschedule Visit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Visit Dialog ── */}
      <Dialog open={cancelVisitId !== null} onOpenChange={open => { if (!open) { setCancelVisitId(null); setCancelReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this visit</DialogTitle>
            <DialogDescription>The rest of the plan continues on schedule — only this one visit is skipped.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Reason <span className="text-destructive">*</span></label>
            <Textarea rows={3} placeholder="e.g. Customer requested to skip this visit due to weather" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelVisitId(null)}>Back</Button>
            <Button variant="destructive" onClick={confirmCancelVisit} disabled={cancelVisitMutation.isPending}>
              {cancelVisitMutation.isPending ? 'Cancelling...' : 'Cancel Visit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
