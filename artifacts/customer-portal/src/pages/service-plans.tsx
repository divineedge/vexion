import * as React from "react";
import { Link, useRoute } from "wouter";
import {
  usePortalListPlans,
  usePortalGetPlan,
  usePortalUpdatePlan,
  getPortalGetPlanQueryKey,
  getPortalListPlansQueryKey,
  PortalPlan,
  PortalPlanDetail,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  ArrowLeft,
  RefreshCw,
  Banknote,
  Layers,
  CalendarDays,
  Receipt,
  TriangleAlert,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

// ─── Constants ────────────────────────────────────────────────────────────────

const RENEWAL_WARNING_DAYS = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isNearExpiry(plan: { status: string; autoRenew: boolean; nextBillingDate: string }) {
  if (plan.autoRenew) return false;
  if (plan.status !== "active" && plan.status !== "pending_renewal") return false;
  const msUntil = new Date(plan.nextBillingDate).getTime() - Date.now();
  const daysUntil = msUntil / (1000 * 60 * 60 * 24);
  return daysUntil <= RENEWAL_WARNING_DAYS;
}

function ExpiryWarningBanner({ nextBillingDate }: { nextBillingDate: string }) {
  const msUntil = new Date(nextBillingDate).getTime() - Date.now();
  const daysUntil = Math.ceil(msUntil / (1000 * 60 * 60 * 24));
  const expiredAlready = daysUntil <= 0;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-3 text-amber-900 dark:text-amber-200">
      <TriangleAlert className="h-5 w-5 shrink-0 mt-0.5 text-amber-500" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">
          {expiredAlready
            ? "Your plan has expired"
            : `Your plan expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`}
        </p>
        <p className="text-xs mt-0.5 text-amber-800 dark:text-amber-300">
          Auto-renew is off. Submit a service request to renew your plan and avoid any interruption.
        </p>
        <Link href="/service-requests">
          <button className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 dark:text-amber-100 underline underline-offset-2 hover:opacity-80 transition-opacity">
            Contact us to renew →
          </button>
        </Link>
      </div>
    </div>
  );
}

function billingCycleLabel(cycle: string, customDays?: number | null) {
  switch (cycle) {
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "annual":
      return "Annual";
    case "custom":
      return customDays ? `Every ${customDays} days` : "Custom";
    default:
      return cycle;
  }
}

function planStatusBadge(status: string) {
  switch (status) {
    case "active":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Active
        </Badge>
      );
    case "paused":
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <Clock className="w-3 h-3 mr-1" />
          Paused
        </Badge>
      );
    case "pending_renewal":
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          <RefreshCw className="w-3 h-3 mr-1" />
          Pending Renewal
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function visitStatusBadge(status: string) {
  switch (status) {
    case "scheduled":
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          <CalendarClock className="w-3 h-3 mr-1" />
          Scheduled
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <Clock className="w-3 h-3 mr-1" />
          In Progress
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Completed
        </Badge>
      );
    case "cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function invoiceStatusBadge(status: string) {
  switch (status) {
    case "paid":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Paid
        </Badge>
      );
    case "sent":
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          Pending
        </Badge>
      );
    case "overdue":
      return <Badge variant="destructive">Overdue</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ─── Plan Detail View ──────────────────────────────────────────────────────────

function PlanDetail({ planId }: { planId: number }) {
  const queryClient = useQueryClient();
  const { data: plan, isLoading } = usePortalGetPlan(planId);
  const detailQueryKey = getPortalGetPlanQueryKey(planId);
  const listQueryKey = getPortalListPlansQueryKey();

  const updateMutation = usePortalUpdatePlan({
    mutation: {
      onMutate: async ({ data }) => {
        await queryClient.cancelQueries({ queryKey: detailQueryKey });
        const previous = queryClient.getQueryData<PortalPlanDetail>(detailQueryKey);
        if (previous) {
          queryClient.setQueryData<PortalPlanDetail>(detailQueryKey, {
            ...previous,
            autoRenew: data.autoRenew,
          });
        }
        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(detailQueryKey, context.previous);
        }
        toast.error("Failed to update auto-renew setting");
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: detailQueryKey });
        queryClient.invalidateQueries({ queryKey: listQueryKey });
        toast.success("Auto-renew preference saved");
      },
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!plan) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center text-muted-foreground">
          Plan not found.
        </CardContent>
      </Card>
    );
  }

  const upcomingVisits = plan.visits.filter(
    (v) => v.status === "scheduled" || v.status === "in_progress"
  );
  const pastVisits = plan.visits.filter(
    (v) => v.status === "completed" || v.status === "cancelled"
  );

  const serviceList = (plan.serviceState as Array<{ serviceName: string; frequencyDays: number }>) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link href="/plans">
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            All Plans
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{plan.templateName}</h1>
          {plan.propertyAddress && (
            <p className="text-muted-foreground text-sm mt-0.5">{plan.propertyAddress}</p>
          )}
        </div>
        {planStatusBadge(plan.status)}
      </div>

      {/* Expiry warning */}
      {isNearExpiry(plan) && <ExpiryWarningBanner nextBillingDate={plan.nextBillingDate} />}

      {/* Key details */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-4 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Price</span>
            <span className="text-xl font-bold">{formatCurrency(plan.billingPrice)}</span>
            <span className="text-xs text-muted-foreground">{billingCycleLabel(plan.billingCycle, plan.customCycleDays)}</span>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Next Billing</span>
            <span className="text-lg font-semibold">{formatDate(plan.nextBillingDate)}</span>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Period</span>
            <span className="text-sm font-medium">{formatDate(plan.startDate)}</span>
            <span className="text-xs text-muted-foreground">to {formatDate(plan.endDate)}</span>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Last Billed</span>
            <span className="text-sm font-medium">
              {plan.lastBilledAt ? formatDate(plan.lastBilledAt) : "—"}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Auto-renew toggle */}
      <Card className="shadow-sm">
        <CardContent className="p-5 flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="auto-renew" className="text-sm font-semibold cursor-pointer">
              Auto-Renew
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {plan.autoRenew
                ? "Your plan will renew automatically at the end of each billing period."
                : "Your plan will not renew automatically. You'll receive a reminder before the plan expires."}
            </p>
          </div>
          <Switch
            id="auto-renew"
            checked={plan.autoRenew}
            disabled={updateMutation.isPending || plan.status === "cancelled"}
            onCheckedChange={(checked) => {
              updateMutation.mutate({ id: planId, data: { autoRenew: checked } });
            }}
          />
        </CardContent>
      </Card>

      {/* Included services */}
      {serviceList.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Included Services
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2">
              {serviceList.map((svc, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span>{svc.serviceName}</span>
                  <span className="text-muted-foreground text-xs">
                    Every {svc.frequencyDays} day{svc.frequencyDays === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Upcoming visits */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            Upcoming Visits
          </CardTitle>
          <CardDescription>{upcomingVisits.length} scheduled</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {upcomingVisits.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No upcoming visits scheduled.</p>
          ) : (
            upcomingVisits.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium">{v.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(v.scheduledAt)}
                    {v.assigneeName ? ` · ${v.assigneeName}` : ""}
                  </p>
                </div>
                {visitStatusBadge(v.status)}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Past visits */}
      {pastVisits.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              Past Visits
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {pastVisits.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium">{v.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(v.scheduledAt)}
                    {v.assigneeName ? ` · ${v.assigneeName}` : ""}
                  </p>
                </div>
                {visitStatusBadge(v.status)}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Billing history */}
      {plan.billingHistory.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              Billing History
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {plan.billingHistory.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium">{entry.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.paidAt ? `Paid ${formatDate(entry.paidAt)}` : entry.dueDate ? `Due ${formatDate(entry.dueDate)}` : formatDate(entry.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {invoiceStatusBadge(entry.status)}
                  <span className="text-sm font-semibold">{formatCurrency(entry.total)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Plans List ────────────────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: PortalPlan }) {
  const showWarning = isNearExpiry(plan);
  return (
    <div className="space-y-1.5">
      {showWarning && <ExpiryWarningBanner nextBillingDate={plan.nextBillingDate} />}
      <Link href={`/plans/${plan.id}`}>
        <Card className={`shadow-sm hover:border-primary/40 transition-colors cursor-pointer ${showWarning ? "border-amber-300 dark:border-amber-700" : ""}`}>
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-foreground">{plan.templateName}</h3>
                  {planStatusBadge(plan.status)}
                </div>
                {plan.propertyAddress && (
                  <p className="text-sm text-muted-foreground mt-0.5 truncate">{plan.propertyAddress}</p>
                )}
                <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Banknote className="h-3.5 w-3.5" />
                    {formatCurrency(plan.billingPrice)} / {billingCycleLabel(plan.billingCycle, plan.customCycleDays)}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Next billing: {formatDate(plan.nextBillingDate)}
                  </span>
                  <span className="flex items-center gap-1">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Auto-renew: {plan.autoRenew ? "On" : "Off"}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

function PlansList() {
  const { data: plans, isLoading } = usePortalListPlans({
    query: { queryKey: ["portalListPlans"] },
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Service Plans</h1>
        <p className="text-muted-foreground mt-1">
          Your active service agreements with upcoming visits and billing details.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="p-5">
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-4 w-64 mb-3" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : plans && plans.length > 0 ? (
        <div className="space-y-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed shadow-none bg-muted/50">
          <CardContent className="p-10 text-center">
            <CalendarDays className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <h3 className="font-medium text-foreground mb-1">No active service plans</h3>
            <p className="text-sm text-muted-foreground">
              You don't have any active service plans. Contact us to learn about our recurring service options.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Page entry point ──────────────────────────────────────────────────────────

export default function ServicePlans() {
  const [, params] = useRoute("/plans/:id");
  const planId = params?.id ? Number(params.id) : null;

  if (planId) {
    return <PlanDetail planId={planId} />;
  }

  return <PlansList />;
}
