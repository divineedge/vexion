import React, { useState } from 'react';
import { useParams, useLocation, Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useGetCustomerPlan, getGetCustomerPlanQueryKey,
  useUpdateCustomerPlan, useRenewCustomerPlan, useCancelPlanVisit,
  useReschedulePlanVisit, useListUsers, useUpdateVisit,
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
import { ArrowLeft, CalendarClock, MapPin, DollarSign, X, CalendarDays, Snowflake, Pencil, AlertTriangle, CheckCircle2, TrendingUp, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { WEEKDAYS, formatDateKey, spacingSummary } from '@/components/customer/PlanVisitScheduleFields';
import { useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import { RescheduleFeeDialog, defaultRescheduleFee, apiErrorMessage, moveToDay, type RescheduleFeeChoice } from '@/components/schedule/RescheduleFeeDialog';

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
  const [visitStatusFilter, setVisitStatusFilter] = useState<'all' | 'scheduled' | 'completed' | 'cancelled'>('all');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState('');

  const [isDuplicating, setIsDuplicating] = useState(false);

  // Reschedule visit dialog state
  const [rescheduleVisitId, setRescheduleVisitId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleAssigneeId, setRescheduleAssigneeId] = useState<string>('_keep');

  const { data: plan, isLoading } = useGetCustomerPlan(planId, {
    query: { enabled: !!planId, queryKey: getGetCustomerPlanQueryKey(planId) },
  });
  // Sync notes value when plan loads
  React.useEffect(() => { if (plan) { setNotesVal(plan.notes ?? ''); setEditingNotes(false); } }, [plan?.id]);
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
  const { data: tenantSettings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const [visitFeeAskOpen, setVisitFeeAskOpen] = useState(false);
  const [visitFeeError, setVisitFeeError] = useState<string | null>(null);
  const updateVisit = useUpdateVisit({ mutation: { onSuccess: invalidate, onError: () => toast.error('Failed to update visit') } });

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

  const [rescheduleOriginalAt, setRescheduleOriginalAt] = useState<string | null>(null);
  const openReschedule = (visitId: number, currentScheduledAt: string) => {
    setRescheduleVisitId(visitId);
    setRescheduleOriginalAt(currentScheduledAt);
    setRescheduleDate(toDateInputValue(new Date(currentScheduledAt)));
    setRescheduleAssigneeId('_keep');
  };

  const confirmRescheduleVisit = () => {
    if (!rescheduleVisitId || !rescheduleDate) { toast.error('A new date is required'); return; }
    // Validate date is within the plan's active period
    if (plan?.startDate && rescheduleDate < plan.startDate.slice(0, 10)) {
      toast.error(`Date must be on or after the plan start date (${new Date(plan.startDate).toLocaleDateString()})`);
      return;
    }
    if (plan?.endDate && rescheduleDate > plan.endDate.slice(0, 10)) {
      toast.error(`Date must be on or before the plan end date (${new Date(plan.endDate).toLocaleDateString()})`);
      return;
    }
    setVisitFeeError(null);
    setVisitFeeAskOpen(true);
  };

  const submitRescheduleVisit = (choice: RescheduleFeeChoice) => {
    if (!rescheduleVisitId || !rescheduleDate) return;
    // Keep the visit's original time of day in the tenant timezone (DST-aware).
    const tz = tenantSettings?.timezone ?? null;
    const newScheduledAt = rescheduleOriginalAt
      ? moveToDay(rescheduleOriginalAt, rescheduleDate, tz).toISOString()
      : moveToDay(new Date().toISOString(), rescheduleDate, tz).toISOString();
    const data: { newScheduledAt: string; assigneeId?: number | null } & RescheduleFeeChoice = { newScheduledAt, ...choice };
    if (rescheduleAssigneeId === '_unassign') {
      data.assigneeId = null;
    } else if (rescheduleAssigneeId !== '_keep') {
      data.assigneeId = Number(rescheduleAssigneeId);
    }
    rescheduleVisitMutation.mutate({ id: planId, jobId: rescheduleVisitId, data }, {
      onSuccess: () => {
        toast.success(choice.chargeRescheduleFee ? `Visit rescheduled, $${choice.rescheduleFeeAmount.toFixed(2)} fee added` : 'Visit rescheduled, no fee');
        setVisitFeeAskOpen(false);
        invalidate();
        setRescheduleVisitId(null);
        setRescheduleDate('');
        setRescheduleAssigneeId('_keep');
      },
      onError: (err) => setVisitFeeError(apiErrorMessage(err, 'Failed to reschedule visit.')),
    });
  };

  if (isLoading || !plan) {
    return <div className="py-16 text-center text-muted-foreground">Loading plan...</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Button variant="ghost" size="sm" title="Go back to the plans list" className="gap-2 -ml-2" onClick={() => navigate('/plans')}>
        <ArrowLeft className="w-4 h-4" /> Back to Plans
      </Button>

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight" title={plan.templateName}>{plan.templateName}</h1>
            <Badge variant="outline" className={STATUS_STYLE[plan.status] ?? ''} title={`Plan status: ${plan.status.replace('_', ' ')}`}>{plan.status.replace('_', ' ')}</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
            <Link href={`/properties/${plan.propertyId}`} title="View property details" className="flex items-center gap-1 hover:underline text-muted-foreground"><MapPin className="w-3.5 h-3.5" />{plan.propertyAddress}</Link>
            <Link href={`/customers/${plan.customerId}`} title={`View ${plan.customerName}`} className="hover:underline text-foreground">{plan.customerName}</Link>
            {(plan as any).startDate && <span className="text-muted-foreground" title={new Date((plan as any).startDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}>Started {new Date((plan as any).startDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            {(plan as any).endDate && <span className="text-muted-foreground" title={new Date((plan as any).endDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}>Ends {new Date((plan as any).endDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            title="Create a copy of this plan for the same customer"
            onClick={async () => {
              setIsDuplicating(true);
              try {
                const created = await customFetch<{ id: number }>('/api/service-plans', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    templateId: (plan as any).templateId,
                    customerId: plan.customerId,
                    propertyId: plan.propertyId,
                    billingPrice: plan.billingPrice,
                    billingCycle: plan.billingCycle,
                    autoRenew: plan.autoRenew,
                    notes: plan.notes ?? '',
                  }),
                });
                toast.success('Plan duplicated');
                navigate(`/plans/${created.id}`);
              } catch {
                toast.error('Failed to duplicate plan');
              } finally {
                setIsDuplicating(false);
              }
            }}
          disabled={isDuplicating}
          >
            {isDuplicating ? <><span className="w-4 h-4 mr-1.5 animate-spin inline-block border-2 border-current border-t-transparent rounded-full" /> Duplicating…</> : <><Copy className="w-4 h-4 mr-1.5" /> Duplicate</>}
          </Button>
          {plan.status !== 'cancelled' && <Button variant="outline" title="Edit internal notes for this plan" onClick={() => { setNotesVal(plan.notes ?? ''); setEditingNotes(true); document.getElementById('plan-notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Edit Notes</Button>}
          {plan.status === 'active' && <Button variant="outline" title="Pause this plan — stops new visit generation" disabled={updateMutation.isPending} onClick={() => setStatus('paused')}>{updateMutation.isPending ? 'Pausing…' : 'Pause Plan'}</Button>}
          {plan.status === 'paused' && <Button variant="outline" title="Resume this plan — resumes visit generation" disabled={updateMutation.isPending} onClick={() => setStatus('active')}>{updateMutation.isPending ? 'Resuming…' : 'Resume Plan'}</Button>}
          {plan.status !== 'cancelled' && (
            <Button variant="outline" title="Cancel this plan permanently — cannot be undone" className="text-destructive hover:text-destructive" disabled={updateMutation.isPending} onClick={() => {
              if (!window.confirm('Cancel this plan? Scheduled future visits will be removed. This cannot be undone.')) return;
              setStatus('cancelled');
            }}>{updateMutation.isPending ? 'Cancelling…' : 'Cancel Plan'}</Button>
          )}
        </div>
      </div>

      {(() => {
        const today = new Date();
        const m = today.getMonth() + 1; const d = today.getDate();
        const isInOffSeason = (start: string, end: string) => {
          const [startM, startD] = start.split('-').map(Number);
          const [endM, endD] = end.split('-').map(Number);
          const afterStart = m > startM || (m === startM && d >= startD);
          const beforeEnd = m < endM || (m === endM && d <= endD);
          return startM <= endM ? (afterStart && beforeEnd) : (afterStart || beforeEnd);
        };
        const serviceStates = plan.serviceState as any[] | undefined;
        const activeEntry = serviceStates?.find((svc: any) => {
          const sr = serviceMap.get(svc.serviceId);
          return sr?.offSeasonStart && sr?.offSeasonEnd && isInOffSeason(sr.offSeasonStart, sr.offSeasonEnd);
        });
        if (!activeEntry) return null;
        const sr = serviceMap.get(activeEntry.serviceId);
        return (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
            <Snowflake className="w-4 h-4 flex-shrink-0" />
            <span>Off-season window is active — visits for <strong>{sr?.name ?? activeEntry.serviceName ?? 'this service'}</strong> are paused until {sr?.offSeasonEnd}.</span>
          </div>
        );
      })()}

      <div className={`grid grid-cols-1 gap-4 ${(plan as any).totalBilled != null ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
        {(plan as any).totalBilled != null && (
          <Card><CardContent className="p-6">
            <p className="text-sm text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" />Total Billed</p>
            <p className="text-2xl font-bold mt-1" title={`Total billed to date: $${((plan as any).totalBilled).toFixed(2)}`}>${((plan as any).totalBilled).toFixed(2)}</p>
          </CardContent></Card>
        )}
        <Card><CardContent className="p-6">
          <p className="text-sm text-muted-foreground flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />Billed Price</p>
          <p className="text-2xl font-bold mt-1" title={`Billed $${plan.billingPrice.toFixed(2)} per ${plan.billingCycle}`}>${plan.billingPrice.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">/ {plan.billingCycle}</span></p>
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
          <p className="text-2xl font-bold mt-1" title={plan.nextBillingDate ? new Date(plan.nextBillingDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : undefined}>{plan.nextBillingDate ? (() => { const d = new Date(plan.nextBillingDate!); const days = Math.round((d.getTime() - Date.now()) / 86400000); return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 1 && days <= 60 ? `in ${days}d` : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); })() : '—'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Auto-Renew</p>
            <p className="text-lg font-semibold mt-1" title={plan.autoRenew ? 'This plan will automatically renew when it expires' : 'This plan will not automatically renew'}>{plan.autoRenew ? 'Enabled' : 'Disabled'}</p>
          </div>
          <Switch title={plan.autoRenew ? 'Auto-renew is on — click to disable' : 'Auto-renew is off — click to enable'} checked={plan.autoRenew} onCheckedChange={toggleAutoRenew} disabled={plan.status === 'cancelled' || updateMutation.isPending} />
        </CardContent></Card>
        <Card><CardContent className="p-6 flex flex-col justify-center">
          <Button size="sm" title="Manually renew this plan for another billing period" onClick={handleRenew} disabled={renewMutation.isPending || plan.status === 'cancelled'}>
            {renewMutation.isPending ? 'Renewing...' : 'Renew Now'}
          </Button>
        </CardContent></Card>
      </div>

      {plan.visitSchedule && (() => {
        const vs = plan.visitSchedule;
        const sum = spacingSummary(vs);
        return (
          <Card data-testid="card-visit-schedule">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="w-4 h-4" />Service Date Range</CardTitle>
              <CardDescription>Visits evenly spaced between fixed first and last service dates. Separate from the billing period ({formatDateKey(plan.startDate)} – {formatDateKey(plan.endDate)}).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div><p className="text-muted-foreground text-xs">First service</p><p className="font-medium" data-testid="text-first-service">{formatDateKey(vs.firstServiceDate)}</p></div>
                <div><p className="text-muted-foreground text-xs">Last service</p><p className="font-medium" data-testid="text-last-service">{formatDateKey(vs.lastServiceDate)}</p></div>
                <div><p className="text-muted-foreground text-xs">Total services</p><p className="font-medium">{vs.totalVisits}</p></div>
                <div><p className="text-muted-foreground text-xs">Preferred weekday</p><p className="font-medium">{WEEKDAYS[vs.preferredWeekday] ?? '—'}</p></div>
                <div><p className="text-muted-foreground text-xs">Spacing unit</p><p className="font-medium capitalize">{vs.spacingUnit}</p></div>
              </div>
              {sum && <p className="text-xs text-muted-foreground">{sum.text}.</p>}
              <p className="text-xs text-muted-foreground">Visit dates don't change billing and don't restart when billing renews. Reschedule individual visits below if needed.</p>
            </CardContent>
          </Card>
        );
      })()}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              Scheduled Visits
              {plan.visits.length > 0 && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {plan.visits.filter(v => v.status === 'completed').length}/{plan.visits.length} completed
                </Badge>
              )}
            </CardTitle>
            <CardDescription>All jobs generated from this plan, past and upcoming.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" title="Log a completed visit for this plan" onClick={() => navigate(`/visits?customerId=${plan.customerId}&propertyId=${plan.propertyId}`)}>
              <CalendarDays className="w-3.5 h-3.5" /> Log Visit
            </Button>
            <VisitStatusFilter value={visitStatusFilter} onChange={setVisitStatusFilter} />
          </div>
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
              ) : [...plan.visits].filter(v => visitStatusFilter === 'all' || v.status === visitStatusFilter).sort((a, b) => {
                // Upcoming (scheduled in future) first, then by date desc for past
                const aFuture = a.status === 'scheduled' && new Date(a.scheduledAt) >= new Date();
                const bFuture = b.status === 'scheduled' && new Date(b.scheduledAt) >= new Date();
                if (aFuture !== bFuture) return aFuture ? -1 : 1;
                return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
              }).map(v => {
                const isPast = v.status === 'completed' || v.status === 'cancelled' || (v.status === 'scheduled' && new Date(v.scheduledAt) < new Date());
                return (
                <TableRow key={v.id} className={isPast ? 'opacity-55' : ''}>
                  <TableCell className="font-medium">
                    {(v as any).convertedToJobId ? (
                      <button className="hover:underline text-primary text-left" title={v.title} onClick={() => navigate(`/schedule?jobId=${(v as any).convertedToJobId}`)}>{v.title}</button>
                    ) : <span title={v.title}>{v.title}</span>}
                    {(v as any).convertedToJobId && (
                      <button
                        className="block text-xs text-primary hover:underline mt-0.5"
                        title={`View job #${(v as any).convertedToJobId}`}
                        onClick={() => navigate(`/schedule?jobId=${(v as any).convertedToJobId}`)}
                      >Job #{(v as any).convertedToJobId} →</button>
                    )}
                  </TableCell>
                  <TableCell className={`text-sm ${isPast ? 'text-muted-foreground' : 'font-medium'}`} title={new Date(v.scheduledAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}>
                    {plan.visitSchedule
                      ? formatDateKey(v.scheduledAt, { month: 'short', day: 'numeric', year: 'numeric' }, (plan.visitSchedule as { timeZone?: string | null }).timeZone)
                      : new Date(v.scheduledAt).toLocaleDateString()}
                    {!isPast && v.status !== 'completed' && (() => {
                      const daysUntil = Math.ceil((new Date(v.scheduledAt).getTime() - Date.now()) / 86400000);
                      return daysUntil <= 7 && daysUntil >= 0
                        ? <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${daysUntil <= 2 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>{daysUntil === 0 ? 'Today' : `${daysUntil}d`}</span>
                        : null;
                    })()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground" title={v.assigneeName ?? 'Unassigned'}>{v.assigneeName ?? 'Unassigned'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={VISIT_STATUS_STYLE[v.status] ?? ''} title={`Status: ${v.status.replace(/_/g, ' ')}`}>{v.status.replace('_', ' ')}</Badge>
                    {v.cancelReason && <p className="text-xs text-muted-foreground mt-1" title={v.cancelReason}>{v.cancelReason}</p>}
                  </TableCell>
                  <TableCell>
                    {v.status === 'completed' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1 text-muted-foreground"
                        title="View visit record"
                        onClick={() => navigate(`/visits?visitId=${v.id}`)}
                      >
                        <ExternalLink className="w-3 h-3" /> Visit
                      </Button>
                    )}
                    {v.status === 'scheduled' && (
                      <div className="flex items-center gap-1">
                        {isPast && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-emerald-600"
                            title="Mark as completed"
                            disabled={updateVisit.isPending}
                            onClick={() => updateVisit.mutate({ id: v.id, data: { status: 'completed' } as any })}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
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
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Billing History {plan.billingHistory && (plan.billingHistory as any[]).length > 0 && <Badge variant="secondary" className="text-xs">{(plan.billingHistory as any[]).length}</Badge>}</CardTitle>
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
              ) : plan.billingHistory.slice(0, 10).map(inv => (
                <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/financials?invoiceId=${inv.id}`)}>
                  <TableCell className="font-medium text-primary hover:underline" title={`Invoice ${inv.invoiceNumber}`}>{inv.invoiceNumber}</TableCell>
                  <TableCell className="text-sm text-muted-foreground" title={new Date(inv.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}>{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm text-muted-foreground" title={inv.dueDate ? new Date(inv.dueDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : undefined}>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="text-right font-medium" title={`Invoice total: $${inv.total.toFixed(2)}`}>${inv.total.toFixed(2)}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="capitalize" title={`Invoice status: ${inv.status}`}>{inv.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {plan.billingHistory.length > 10 && (
            <div className="px-6 pb-4 pt-1">
              <a href={`${import.meta.env.BASE_URL}financials?customerId=${plan.customerId}`} className="text-xs text-primary hover:underline">
                View all {plan.billingHistory.length} invoices →
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Services & Off-Season Windows */}
      {plan.serviceState && (plan.serviceState as any[]).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Services in this Plan <Badge variant="secondary" className="text-xs" title={`${(plan.serviceState as any[]).length} service${(plan.serviceState as any[]).length !== 1 ? 's' : ''} in this plan`}>{(plan.serviceState as any[]).length}</Badge></CardTitle>
            <CardDescription>Scheduled services and any configured off-season windows.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Off Season</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(plan.serviceState as any[]).map((svc: any) => {
                  const svcRecord = serviceMap.get(svc.serviceId);
                  const breakdown = (resolvedPriceInfo as any)?.breakdown as Array<{ serviceId: number; price: number }> | undefined;
                  const priceEntry = breakdown?.find(b => b.serviceId === svc.serviceId);
                  return (
                    <TableRow key={svc.serviceId}>
                      <TableCell className="font-medium" title={svc.serviceName}>{svc.serviceName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={`Visits every ${svc.frequencyDays} day${svc.frequencyDays !== 1 ? 's' : ''}`}>
                        Every {svc.frequencyDays} day{svc.frequencyDays !== 1 ? 's' : ''}
                      </TableCell>
                      <TableCell>
                        {svcRecord?.offSeasonStart && svcRecord?.offSeasonEnd ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded" title={`Off-season: ${formatMMDD(svcRecord.offSeasonStart)} – ${formatMMDD(svcRecord.offSeasonEnd)}`}>
                            <Snowflake className="w-3 h-3" />
                            {formatMMDD(svcRecord.offSeasonStart)} – {formatMMDD(svcRecord.offSeasonEnd)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm" title="No off-season window set">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground" title={priceEntry != null ? `Service price: $${priceEntry.price.toFixed(2)}` : 'No price set'}>
                        {priceEntry != null ? `$${priceEntry.price.toFixed(2)}` : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card id="plan-notes">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</p>
            {!editingNotes && (
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => { setNotesVal(plan.notes ?? ''); setEditingNotes(true); }}>
                <Pencil className="w-3 h-3" /> Edit
              </Button>
            )}
          </div>
          {editingNotes ? (
            <div className="space-y-2">
              <Textarea title="Internal notes about this plan (not shown to the customer)" value={notesVal} onChange={e => setNotesVal(e.target.value)} rows={3} className="text-sm" placeholder="Add notes about this plan…" maxLength={2000} />
              <p className="text-xs text-muted-foreground text-right">{notesVal.length}/2000</p>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: plan.id, data: { notes: notesVal } as any }, { onSuccess: () => { toast.success('Notes saved'); setEditingNotes(false); } })}>{updateMutation.isPending ? 'Saving…' : 'Save'}</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingNotes(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" title={plan.notes || undefined}>{plan.notes || <span className="italic">No notes added.</span>}</p>
          )}
        </CardContent>
      </Card>

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
                min={plan?.startDate ? plan.startDate.slice(0, 10) : undefined}
                max={plan?.endDate ? plan.endDate.slice(0, 10) : undefined}
                onChange={e => setRescheduleDate(e.target.value)}
              />
              {(plan?.startDate || plan?.endDate) && (
                <p className="text-xs text-muted-foreground mt-1">
                  Plan active: {plan.startDate ? new Date(plan.startDate).toLocaleDateString() : '—'} – {plan.endDate ? new Date(plan.endDate).toLocaleDateString() : 'ongoing'}
                </p>
              )}
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
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RescheduleFeeDialog
        open={visitFeeAskOpen}
        toLabel={rescheduleDate}
        defaultAmount={defaultRescheduleFee(tenantSettings)}
        pending={rescheduleVisitMutation.isPending}
        error={visitFeeError}
        onConfirm={submitRescheduleVisit}
        onCancel={() => { setVisitFeeAskOpen(false); setVisitFeeError(null); }}
      />

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

function VisitStatusFilter({ value, onChange }: { value: string; onChange: (v: 'all' | 'scheduled' | 'completed' | 'cancelled') => void }) {
  const opts = [
    { key: 'all', label: 'All' },
    { key: 'scheduled', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
  ] as const;
  return (
    <div className="flex gap-1 flex-wrap">
      {opts.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${value === o.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-foreground/30'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
