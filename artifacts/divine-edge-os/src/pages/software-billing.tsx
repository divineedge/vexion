import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBusinessSoftwareBilling, getGetBusinessSoftwareBillingQueryKey,
  useStartBusinessSubscription, useManageBusinessSubscription,
  useStartBusinessPaymentOnboarding, useRefreshBusinessPaymentAccount,
} from '@workspace/api-client-react';
import type { SoftwareBillingRedirect } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { PayoutTable } from '@/components/billing/PayoutTable';
import { cents, errorMessage, redirectToStripe, catalogOf, resolveFeatures } from '@/lib/softwareBilling';
import type { FeeBounds } from '@/lib/softwareBilling';
import { FeeDisclosure, railSummary } from '@/components/billing/FeeDisclosure';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, Landmark, Lock, PauseCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function SoftwareBillingPage() {
  const { isOwner, user } = useAuth();
  const qc = useQueryClient();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const key = [...getGetBusinessSoftwareBillingQueryKey(), user?.id ?? null, user?.tenantId ?? null];
  const billing = useGetBusinessSoftwareBilling({ query: { enabled: isOwner, queryKey: key } });
  const startSub = useStartBusinessSubscription();
  const manage = useManageBusinessSubscription();
  const onboard = useStartBusinessPaymentOnboarding();
  const refreshAcct = useRefreshBusinessPaymentAccount();
  const [terms, setTerms] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<number | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: getGetBusinessSoftwareBillingQueryKey() });
  const refreshRef = useRef(refreshAcct.mutateAsync); refreshRef.current = refreshAcct.mutateAsync;

  const go = (r: SoftwareBillingRedirect) => {
    if (!redirectToStripe(r.url)) toast.error('Received an unexpected redirect address. For your safety it was not opened.');
  };

  // Returning from Stripe: never assume success — ask the server for provider-confirmed state.
  const enabled = billing.data?.enabled;
  const handledReturn = useRef(false);
  useEffect(() => {
    if (handledReturn.current || !isOwner || enabled === undefined) return;
    const params = new URLSearchParams(search);
    if (![...params.keys()].some(k => /return|session|onboard|checkout|portal|success|subscription|connect/i.test(k))) return;
    handledReturn.current = true;
    setLocation('/software-billing', { replace: true });
    if (!enabled) { void reload(); return; }
    toast.info('Checking status with Stripe…');
    refreshRef.current()
      .catch(e => toast.error(errorMessage(e, 'Could not confirm status with Stripe yet. Try Refresh.')))
      .finally(() => void reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isOwner, search]);

  if (!isOwner) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-3" data-testid="state-owner-only">
        <Lock className="w-6 h-6 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-semibold">Owner only</h1>
        <p className="text-sm text-muted-foreground">Software billing and payouts are visible to the company owner.</p>
      </div>
    );
  }

  if (billing.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-44" /><Skeleton className="h-44" /></div>;
  if (billing.isError || !billing.data) {
    return (
      <Card><CardContent className="py-10 text-center space-y-3">
        <AlertTriangle className="w-6 h-6 mx-auto text-destructive" />
        <p className="text-sm">Could not load software billing. {errorMessage(billing.error, '')}</p>
        <Button variant="outline" onClick={() => billing.refetch()} data-testid="button-retry-billing"><RefreshCw className="w-4 h-4 mr-2" />Retry</Button>
      </CardContent></Card>
    );
  }

  const { account, plans, payouts } = billing.data;
  const fees = billing.data.fees as typeof billing.data.fees & FeeBounds;
  const catalog = catalogOf(billing.data);
  const cardRail = { bps: fees.cardFeeBps, fixed: fees.cardFeeFixedCents, min: fees.cardFeeMinCents, max: fees.cardFeeMaxCents };
  const achRail = { bps: fees.achFeeBps, fixed: fees.achFeeFixedCents, min: fees.achFeeMinCents, max: fees.achFeeMaxCents };
  const live = billing.data.enabled;
  const currentPlan = plans.find(p => p.id === account.planId);
  const confirmed = account.hasSubscription && !!account.confirmedAt;

  const choosePlan = (planId: number) => {
    setPendingPlan(planId);
    const opts = { onSuccess: go, onError: (e: unknown) => toast.error(errorMessage(e, 'Could not open Stripe')), onSettled: () => setPendingPlan(null) };
    if (account.hasSubscription) manage.mutate({ data: { planId } }, opts);
    else startSub.mutate({ data: { planId } }, opts);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Software billing & payouts</h1>
        <p className="text-sm text-muted-foreground">Your Divine Edge OS subscription and online payment payouts. This is not your customers' lawn/service plans.</p>
      </div>

      {!live && (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="banner-not-live">
          <PauseCircle className="w-5 h-5 shrink-0" />
          <div>Software billing isn't live yet. There is nothing to purchase or connect right now — your account continues as normal.</div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-subscription">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" />Subscription</CardTitle>
            <CardDescription>Status as confirmed by Stripe.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Plan</span><span className="font-medium">{currentPlan?.name ?? (account.planId ? `Plan #${account.planId}` : 'None')}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span>
              <Badge variant="outline" data-testid="status-subscription">{confirmed ? account.status.replace(/_/g, ' ') : account.hasSubscription ? 'awaiting Stripe confirmation' : 'not subscribed'}</Badge>
            </div>
            {account.currentPeriodEnd && <div className="flex items-center justify-between"><span className="text-muted-foreground">{account.cancelAtPeriodEnd ? 'Ends' : 'Renews'}</span><span>{format(new Date(account.currentPeriodEnd), 'MMM d, yyyy')}</span></div>}
            {account.cancelAtPeriodEnd && <p className="text-xs text-amber-800">Cancellation scheduled at period end.</p>}
            {account.hasSubscription && (
              <Button variant="outline" className="w-full" disabled={!live || manage.isPending}
                onClick={() => manage.mutate({ data: {} }, { onSuccess: go, onError: e => toast.error(errorMessage(e, 'Could not open billing portal')) })}
                data-testid="button-manage-subscription">
                <ExternalLink className="w-4 h-4 mr-2" />{manage.isPending ? 'Opening…' : 'Manage subscription in Stripe'}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-payments">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" />Online payments (Stripe Connect)</CardTitle>
            <CardDescription>Added platform fee: card {railSummary(cardRail)} · ACH {railSummary(achRail)}. Stripe's processing fee is separate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2" data-testid="status-connect">
              {account.connectReady ? <><CheckCircle2 className="w-4 h-4 text-primary" />Ready to accept payments</>
                : account.hasConnectAccount ? <><AlertTriangle className="w-4 h-4 text-amber-600" />Onboarding incomplete or under verification</>
                : <><AlertTriangle className="w-4 h-4 text-muted-foreground" />Not connected</>}
            </div>
            <FeeDisclosure card={cardRail} ach={achRail} compact={account.connectReady} />
            {!account.connectReady && (
              <>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                  <li>You receive each payment minus Stripe's actual processing fee and, additionally, the added platform fee shown below.</li>
                  <li>No surcharge is added to your customers' invoices.</li>
                  <li>Refunds, disputes, and ACH returns may reverse a payout.</li>
                  <li>Separate Stripe Connect or verification costs may apply.</li>
                </ul>
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox checked={terms} onCheckedChange={v => setTerms(v === true)} data-testid="checkbox-terms" />
                  <span>I accept these payout terms.</span>
                </label>
                <Button className="w-full" disabled={!live || !terms || onboard.isPending}
                  onClick={() => onboard.mutate({ data: { acceptedTerms: true } }, { onSuccess: go, onError: e => toast.error(errorMessage(e, 'Could not start onboarding')) })}
                  data-testid="button-start-onboarding">
                  <ExternalLink className="w-4 h-4 mr-2" />{onboard.isPending ? 'Opening Stripe…' : account.hasConnectAccount ? 'Continue Stripe onboarding' : 'Connect with Stripe'}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" disabled={!live || refreshAcct.isPending}
              onClick={() => refreshAcct.mutate(undefined, { onSuccess: () => { toast.success('Status refreshed from Stripe'); void reload(); }, onError: e => toast.error(errorMessage(e, 'Refresh failed')) })}
              data-testid="button-refresh-account">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshAcct.isPending ? 'animate-spin' : ''}`} />Refresh status
            </Button>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Plans</h2>
        {plans.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="empty-plans">No plans are available yet.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.map(p => {
              const isCurrent = p.id === account.planId && confirmed;
              return (
                <Card key={p.id} className={isCurrent ? 'border-primary ring-1 ring-primary/30' : ''} data-testid={`card-plan-${p.id}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center justify-between">{p.name}{isCurrent && <Badge>Current</Badge>}</CardTitle>
                    <p className="text-2xl font-bold tabular-nums">{cents(Math.round(p.price * 100))}<span className="text-sm font-normal text-muted-foreground">/{p.billingInterval}</span></p>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <ul className="space-y-1" data-testid={`plan-features-${p.id}`}>{resolveFeatures(p.features, catalog).mapped.map(f => <li key={f.key} className="flex gap-2" title={f.description}><CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />{f.label}</li>)}</ul>
                    <p className="text-xs text-muted-foreground">Users: {p.maxUsers ?? 'Unlimited'} · Properties: {p.maxProperties ?? 'Unlimited'}</p>
                    <Button className="w-full" variant={isCurrent ? 'outline' : 'default'} disabled={!live || isCurrent || pendingPlan != null}
                      onClick={() => choosePlan(p.id)} data-testid={`button-choose-plan-${p.id}`}>
                      {pendingPlan === p.id ? 'Opening Stripe…' : isCurrent ? 'Current plan' : account.hasSubscription ? 'Switch to this plan' : 'Subscribe'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Payouts</h2>
        <PayoutTable payouts={payouts} />
      </section>
    </div>
  );
}
