import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAchPaymentPolicy, getGetAchPaymentPolicyQueryKey, useUpdateAchPaymentPolicy,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
} from '@workspace/api-client-react';
import type { AchPaymentPolicy } from '@workspace/api-client-react';
import { Landmark, AlertCircle, RefreshCw, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';
import { useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { useAuth } from '@/contexts/AuthContext';

type Mode = AchPaymentPolicy['mode'];

const MODES: Array<{ value: Mode; title: string; body: (t: string) => string }> = [
  { value: 'disabled', title: 'Cards only', body: () => 'Customers pay online invoices by card. Bank payment is not offered.' },
  { value: 'optional', title: 'Card or bank, any amount', body: () => 'Customers choose card or bank account (ACH) on every online invoice payment.' },
  { value: 'offer_above', title: 'Offer bank at or above an amount', body: t => `Bank account is offered alongside card when the amount being paid is ${t} or more. Below that, cards only.` },
  { value: 'require_above', title: 'Require bank at or above an amount', body: t => `When the amount being paid is ${t} or more, bank account is the only online option. Below that, cards only.` },
];

/** Returns the threshold in dollars, or an error message. */
export function parseThreshold(raw: string): { value?: number; error?: string } {
  const v = raw.trim().replace(/[$,]/g, '');
  if (v === '') return { error: 'Enter an amount.' };
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { error: 'Use a dollar amount with up to two decimal places, like 500 or 750.25.' };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { error: 'Amount cannot be negative.' };
  if (n > 1_000_000) return { error: 'Amount cannot exceed $1,000,000.' };
  return { value: Math.round(n * 100) / 100 };
}

/** Invalid in-progress drafts survive leaving and returning to Settings (valid edits are already queued/saved).
 * Keyed by tenant and user so a draft can never be applied to a different company or sign-in. */
const invalidDrafts = new Map<string, { mode: Mode; threshold: string }>();

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function AchPaymentRules({ canEdit, onOpenPayments }: { canEdit: boolean; onOpenPayments?: () => void }) {
  const qc = useQueryClient();
  const { data: policy, isLoading, isError, refetch, isFetching } = useGetAchPaymentPolicy({ query: { queryKey: getGetAchPaymentPolicyQueryKey() } });
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const update = useUpdateAchPaymentPolicy();
  const updateRef = useRef(update.mutateAsync); updateRef.current = update.mutateAsync;
  const autosave = useSettingsAutosave(
    patch => updateRef.current({ data: patch.policy as AchPaymentPolicy }),
    { onSaved: () => qc.invalidateQueries({ queryKey: getGetAchPaymentPolicyQueryKey() }) },
  );

  const [mode, setMode] = useState<Mode>('disabled');
  const [threshold, setThreshold] = useState('500');
  const { user } = useAuth();
  const draftKey = user?.id != null && user?.tenantId != null ? `${user.tenantId}:${user.id}` : null;
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);
  const hydratedKey = useRef<string | null>(null);
  const lastQueued = useRef<string | null>(null);

  useEffect(() => {
    if (policy && draftKey && !hydrated.current) {
      hydrated.current = true;
      hydratedKey.current = draftKey;
      const draft = invalidDrafts.get(draftKey);
      lastQueued.current = JSON.stringify({ mode: policy.mode, threshold: policy.threshold });
      setMode(draft?.mode ?? policy.mode);
      setThreshold(draft?.threshold ?? String(policy.threshold));
      // Autosave only runs once these hydrated values have rendered (next render).
      setReady(true);
    }
  }, [policy, draftKey]);

  const parsed = parseThreshold(threshold);
  const usesThreshold = mode === 'offer_above' || mode === 'require_above';
  // Disabled/optional ignore the amount, but the saved snapshot must still be valid.
  const effectiveThreshold = parsed.value ?? (usesThreshold ? undefined : policy?.threshold ?? 500);
  const thresholdError = usesThreshold ? parsed.error : undefined;

  const sameAccount = ready && draftKey != null && draftKey === hydratedKey.current;

  useEffect(() => {
    if (!sameAccount || !draftKey) return;
    if (thresholdError) invalidDrafts.set(draftKey, { mode, threshold });
    else invalidDrafts.delete(draftKey);
  }, [sameAccount, draftKey, mode, threshold, thresholdError]);

  useEffect(() => {
    // Never autosave before hydrated values render, or under a different sign-in.
    if (!sameAccount || !canEdit || effectiveThreshold == null) return; // invalid drafts never overwrite saved rules
    const snapshot: AchPaymentPolicy = { mode, threshold: effectiveThreshold };
    const json = JSON.stringify(snapshot);
    if (json === lastQueued.current) return;
    lastQueued.current = json;
    autosave.queue({ policy: snapshot });
  }, [sameAccount, mode, effectiveThreshold, canEdit, autosave.queue]);

  const stripeOn = !!settings?.stripeEnabled;
  const tLabel = parsed.value != null ? fmt(parsed.value) : 'the amount';

  return (
    <Card data-testid="card-ach-rules">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Landmark className="w-5 h-5" /> Bank payments (ACH) on online invoices</CardTitle>
            <CardDescription className="mt-1">
              Choose when customers can pay an online invoice from a US bank account. Applies only to online invoice payments in the customer portal and invoice links; estimate card deposits are not affected.
            </CardDescription>
          </div>
          {ready && <AutosaveIndicator status={autosave.status} label="bank payment rules" hasUnsaved={autosave.hasUnsaved} onRetry={autosave.retry} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!stripeOn && settings && (
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="text-ach-stripe-off">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">Stripe payments are turned off</p>
              <p className="text-xs mt-0.5">These rules are saved, but customers cannot pay online by card or bank until Stripe is enabled in Payments &amp; Integrations. Nothing is enabled automatically.</p>
            </div>
            {onOpenPayments && <Button size="sm" variant="outline" className="shrink-0" onClick={onOpenPayments} data-testid="button-open-payments">Open Payments</Button>}
          </div>
        )}

        {isLoading || (policy && !ready) ? (
          <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : isError || !policy ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <span className="flex items-center gap-2 text-destructive"><AlertCircle className="w-4 h-4" /> Bank payment rules could not be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1.5" data-testid="button-retry-ach-rules">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Retry
            </Button>
          </div>
        ) : (
          <>
            <div role="radiogroup" aria-label="Bank payment rule" className="grid gap-2 sm:grid-cols-2">
              {MODES.map(m => {
                const active = mode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!canEdit}
                    onClick={() => setMode(m.value)}
                    className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-60 ${active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40'}`}
                    data-testid={`radio-ach-mode-${m.value}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className={`h-3.5 w-3.5 rounded-full border-2 ${active ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`} />
                      {m.title}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-1 pl-5">{m.body(tLabel)}</span>
                  </button>
                );
              })}
            </div>

            {usesThreshold && (
              <div className="space-y-1.5 max-w-xs">
                <Label htmlFor="ach-threshold">Amount threshold (USD)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    id="ach-threshold"
                    inputMode="decimal"
                    value={threshold}
                    disabled={!canEdit}
                    onChange={e => setThreshold(e.target.value)}
                    className={`pl-6 ${thresholdError ? 'border-destructive' : ''}`}
                    aria-invalid={!!thresholdError}
                    aria-describedby="ach-threshold-help"
                    data-testid="input-ach-threshold"
                  />
                </div>
                <p id="ach-threshold-help" className={`text-xs ${thresholdError ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {thresholdError ?? 'Compared with the amount actually being collected, after credits and deposits. A payment equal to the threshold counts. Up to $1,000,000.'}
                </p>
                {thresholdError && <p className="text-xs text-muted-foreground">Your last valid rule stays in effect until this is corrected.</p>}
              </div>
            )}

            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
              <p className="font-medium text-foreground flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> How bank payments work</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Customers enter bank details on Stripe's secure hosted checkout. Account numbers are not entered or stored in this software.</li>
                <li>Stripe verifies the bank account automatically: instantly through Stripe Financial Connections when the customer's bank supports it, otherwise with small microdeposits that can take a few business days.</li>
                <li>A bank payment can take up to 4 business days to confirm. Until then the invoice shows the payment as pending, not paid.</li>
                <li>Separate Stripe fees may apply for bank verification, processing, and failed or returned payments and disputes. Stripe currently lists $1.50 per Financial Connections verification; your actual pricing depends on your Stripe account, so check your Stripe pricing for current rates.</li>
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
