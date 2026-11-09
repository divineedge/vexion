import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch, getGetTenantSettingsQueryKey, useGetTenantSettings } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';
import { useAutosaveFields, useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { CompanyDepositRules } from '@/components/billing/CompanyDepositRules';
import { AlertTriangle, RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';

type DefaultType = 'fixed' | 'percent';
type EstimateDepositSettings = {
  enabled: boolean;
  defaultType: DefaultType;
  defaultAmount: number | null;
  requireBeforeScheduling: boolean;
  schedulingDepositType: DefaultType;
  schedulingDepositValue: number | null;
  schedulingDepositPercent: number | null;
  schedulingDepositFixed: number | null;
  allowEstimateOverrides: boolean;
  rules?: unknown[];
  scheduling_deposit_type?: DefaultType;
  scheduling_deposit_value?: number | null;
  requireCardOnAcceptance?: boolean;
  requirePrepaymentOnAcceptance?: boolean;
  require_card_on_acceptance?: boolean;
  require_prepayment_on_acceptance?: boolean;
};

const EMPTY: EstimateDepositSettings = {
  enabled: false,
  defaultType: 'percent',
  defaultAmount: null,
  requireBeforeScheduling: false,
  schedulingDepositType: 'percent',
  schedulingDepositValue: null,
  schedulingDepositPercent: null,
  schedulingDepositFixed: null,
  allowEstimateOverrides: false,
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function coerceDepositSettings(value: unknown): EstimateDepositSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<EstimateDepositSettings> & Record<string, unknown> : {};
  const defaultType = raw.defaultType === 'fixed' ? 'fixed' : 'percent';
  const amount = numberOrNull(raw.defaultAmount);
  const schedulingDepositType = raw.scheduling_deposit_type === 'fixed' || raw.schedulingDepositType === 'fixed'
    ? 'fixed'
    : raw.scheduling_deposit_type === 'percent' || raw.schedulingDepositType === 'percent'
      ? 'percent'
      : defaultType;
  const schedulingDepositPercent = numberOrNull(raw.scheduling_deposit_percent ?? raw.schedulingDepositPercent);
  const schedulingDepositFixed = numberOrNull(raw.scheduling_deposit_fixed ?? raw.schedulingDepositFixed);
  const schedulingDepositValue = numberOrNull(raw.scheduling_deposit_value ?? raw.schedulingDepositValue)
    ?? (schedulingDepositType === 'fixed' ? schedulingDepositFixed : schedulingDepositPercent)
    ?? amount;
  return {
    ...EMPTY,
    enabled: raw.enabled === true,
    defaultType,
    defaultAmount: amount,
    requireBeforeScheduling: raw.requireBeforeScheduling === true,
    schedulingDepositType,
    schedulingDepositValue,
    schedulingDepositPercent: schedulingDepositPercent ?? (schedulingDepositType === 'percent' ? schedulingDepositValue : null),
    schedulingDepositFixed: schedulingDepositFixed ?? (schedulingDepositType === 'fixed' ? schedulingDepositValue : null),
    allowEstimateOverrides: raw.allowEstimateOverrides === true,
    requireCardOnAcceptance: raw.requireCardOnAcceptance === true || raw.requirePrepaymentOnAcceptance === true || raw.require_card_on_acceptance === true || raw.require_prepayment_on_acceptance === true,
    requirePrepaymentOnAcceptance: raw.requireCardOnAcceptance === true || raw.requirePrepaymentOnAcceptance === true || raw.require_card_on_acceptance === true || raw.require_prepayment_on_acceptance === true,
  };
}

function amountProblem(raw: string, mode: DefaultType): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter an amount';
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return mode === 'fixed' ? 'Use a dollar amount with at most two decimal places' : 'Enter a whole percentage or up to two decimal places';
  const value = Number(trimmed);
  if (!(value > 0)) return 'Enter an amount greater than zero';
  if (mode === 'percent' && value > 100) return 'Percentage cannot exceed 100';
  if (mode === 'fixed' && value > 1_000_000) return 'Amount is too large';
  return null;
}

class DepositSettingsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return (
        <Card data-testid="section-deposit-prepayment-rules">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Deposit &amp; Prepayment Rules</CardTitle>
            <CardDescription>Required deposits stay off until this section can be read. Refresh Settings to try again.</CardDescription>
          </CardHeader>
        </Card>
      );
    }
    return this.props.children;
  }
}

export function DepositPrepaymentRules({ canEdit }: { canEdit: boolean }) {
  return (
    <DepositSettingsBoundary>
      <DepositPrepaymentRulesForm canEdit={canEdit} />
    </DepositSettingsBoundary>
  );
}

function DepositPrepaymentRulesForm({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const tenantQuery = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const tenantSettings = tenantQuery.data as { estimateDepositSettings?: unknown; estimate_deposits?: unknown } | undefined;
  const loaded = coerceDepositSettings(tenantSettings?.estimateDepositSettings ?? tenantSettings?.estimate_deposits ?? EMPTY);
  const [enabled, setEnabled] = useState(false);
  const [defaultType, setDefaultType] = useState<DefaultType>('percent');
  const [amount, setAmount] = useState('');
  const [requireBeforeScheduling, setRequireBeforeScheduling] = useState(false);
  const [scheduleType, setScheduleType] = useState<DefaultType>('percent');
  const [schedulePercent, setSchedulePercent] = useState('');
  const [scheduleFixed, setScheduleFixed] = useState('');
  const [allowEstimateOverrides, setAllowEstimateOverrides] = useState(false);
  const [requirePaymentOnAcceptance, setRequirePaymentOnAcceptance] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!tenantQuery.data || ready) return;
    setEnabled(loaded.enabled === true);
    setDefaultType(loaded.defaultType === 'fixed' ? 'fixed' : 'percent');
    setAmount(loaded.defaultAmount != null ? String(loaded.defaultAmount) : '');
    setRequireBeforeScheduling(loaded.requireBeforeScheduling === true);
    setScheduleType(loaded.schedulingDepositType === 'fixed' ? 'fixed' : 'percent');
    setSchedulePercent(loaded.schedulingDepositPercent != null ? String(loaded.schedulingDepositPercent) : '');
    setScheduleFixed(loaded.schedulingDepositFixed != null ? String(loaded.schedulingDepositFixed) : '');
    setAllowEstimateOverrides(loaded.allowEstimateOverrides === true);
    setRequirePaymentOnAcceptance(loaded.requireCardOnAcceptance === true || loaded.requirePrepaymentOnAcceptance === true);
    setReady(true);
  }, [tenantQuery.data, ready, loaded]);

  const save = useMutation({
    mutationFn: (settings: Omit<EstimateDepositSettings, 'rules'>) =>
      customFetch<{ settings: EstimateDepositSettings }>('/api/billing/estimate-deposit-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
    onError: (error: unknown) => toast.error(error instanceof Error && error.message ? error.message : 'Failed to save deposit rules'),
  });
  const parsed = Number(amount);
  const invalid = enabled && (!amount.trim() || !Number.isFinite(parsed) || parsed <= 0 || (defaultType === 'percent' && parsed > 100) || (defaultType === 'fixed' && !/^\d+(\.\d{1,2})?$/.test(amount.trim())));
  const scheduleRaw = scheduleType === 'fixed' ? scheduleFixed : schedulePercent;
  const scheduleInvalid = enabled && requireBeforeScheduling ? amountProblem(scheduleRaw, scheduleType) : null;
  const schedulePercentValue = schedulePercent.trim() && /^\d+(\.\d{1,2})?$/.test(schedulePercent.trim()) ? Number(schedulePercent) : null;
  const scheduleFixedValue = scheduleFixed.trim() && /^\d+(\.\d{1,2})?$/.test(scheduleFixed.trim()) ? Number(scheduleFixed) : null;
  const scheduleValue = scheduleType === 'fixed' ? scheduleFixedValue : schedulePercentValue;
  const settings = {
    enabled,
    defaultType,
    defaultAmount: amount.trim() && Number.isFinite(parsed) ? parsed : null,
    requireBeforeScheduling,
    schedulingDepositType: scheduleType,
    schedulingDepositValue: scheduleValue,
    schedulingDepositPercent: schedulePercentValue,
    schedulingDepositFixed: scheduleFixedValue,
    scheduling_deposit_type: scheduleType,
    scheduling_deposit_value: scheduleValue,
    scheduling_deposit_percent: schedulePercentValue,
    scheduling_deposit_fixed: scheduleFixedValue,
    allowEstimateOverrides,
    requireCardOnAcceptance: requirePaymentOnAcceptance,
    requirePrepaymentOnAcceptance: requirePaymentOnAcceptance,
    require_card_on_acceptance: requirePaymentOnAcceptance,
    require_prepayment_on_acceptance: requirePaymentOnAcceptance,
  };
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;
  const autosave = useSettingsAutosave((patch) => saveRef.current(patch.settings as Omit<EstimateDepositSettings, 'rules'>));
  useAutosaveFields({ settings }, ready, autosave.queue, canEdit && !invalid && !scheduleInvalid);

  if (!canEdit) return null;
  return (
    <Card data-testid="section-deposit-prepayment-rules">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" />Deposit &amp; Prepayment Rules</CardTitle>
        <CardDescription>
          One company setting for the default deposit, whether a job can be scheduled before that deposit is paid, and whether an estimate can use a different amount.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {tenantQuery.isLoading ? <Skeleton className="h-24 w-full" /> : tenantQuery.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-4 h-4" />Could not load deposit rules. Required deposits stay off until they load.</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => tenantQuery.refetch()}><RefreshCw className="w-3.5 h-3.5" />Retry</Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Enable Required Deposits/Prepayments</p>
                <p className="text-xs text-muted-foreground">Off leaves new estimates without a company deposit and does not block scheduling for one.</p>
              </div>
              <Switch checked={enabled === true} onCheckedChange={setEnabled} data-testid="switch-required-deposits" />
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Require Payment Upon Acceptance</p>
                <p className="text-xs text-muted-foreground">These two rules stay together. Turning either one on requires both a saved card and payment before the customer can accept the estimate.</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Require Credit Card on File Upon Acceptance</p>
                  <p className="text-xs text-muted-foreground">The customer saves a card when they accept.</p>
                </div>
                <Switch checked={requirePaymentOnAcceptance} onCheckedChange={setRequirePaymentOnAcceptance} data-testid="switch-require-card-on-acceptance" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Require Prepayment Upon Acceptance</p>
                  <p className="text-xs text-muted-foreground">The customer pays the deposit, or the full estimate when no deposit is set, when they accept.</p>
                </div>
                <Switch checked={requirePaymentOnAcceptance} onCheckedChange={setRequirePaymentOnAcceptance} data-testid="switch-require-prepayment-on-acceptance" />
              </div>
            </div>
            {enabled && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="select-default-deposit-type">Default deposit requirement</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={defaultType === 'fixed' ? 'fixed' : 'percent'} onValueChange={(value) => setDefaultType(value === 'fixed' ? 'fixed' : 'percent')}>
                      <SelectTrigger id="select-default-deposit-type" className="w-64" data-testid="select-default-deposit-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Percentage %</SelectItem>
                        <SelectItem value="fixed">Fixed dollar $</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      {defaultType === 'fixed' && <span className="text-sm text-muted-foreground">$</span>}
                      <Input id="input-default-deposit-amount" className="w-28" type="number" min={0} step={defaultType === 'percent' ? '1' : '0.01'} value={amount} onChange={(event) => setAmount(event.target.value)} data-testid="input-default-deposit-amount" />
                      {defaultType === 'percent' && <span className="text-sm text-muted-foreground">%</span>}
                    </div>
                  </div>
                  {invalid && <p className="text-sm text-destructive" role="alert">Not saved — enter a deposit greater than zero{defaultType === 'percent' ? ' and at most 100%' : ''}.</p>}
                </div>
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Require deposit before scheduling</p>
                      <p className="text-xs text-muted-foreground">Jobs stay unscheduled until the collected deposit reaches this amount. A paid invoice or a collected estimate deposit counts.</p>
                    </div>
                    <Switch checked={requireBeforeScheduling === true} onCheckedChange={setRequireBeforeScheduling} data-testid="switch-require-deposit-before-scheduling" />
                  </div>
                  {requireBeforeScheduling && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="select-scheduling-deposit-type">Amount required before scheduling</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={scheduleType === 'fixed' ? 'fixed' : 'percent'} onValueChange={(value) => setScheduleType(value === 'fixed' ? 'fixed' : 'percent')}>
                          <SelectTrigger id="select-scheduling-deposit-type" className="w-64" data-testid="select-scheduling-deposit-type"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percent">Percentage (%) of estimate total</SelectItem>
                            <SelectItem value="fixed">Fixed dollar amount ($)</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                          {scheduleType === 'fixed' && <span className="text-sm text-muted-foreground">$</span>}
                          <Input
                            id="input-scheduling-deposit-value"
                            className="w-32"
                            inputMode="decimal"
                            type="number"
                            min={0}
                            step={scheduleType === 'percent' ? '1' : '0.01'}
                            placeholder={scheduleType === 'fixed' ? '100.00' : '25'}
                            value={scheduleType === 'fixed' ? scheduleFixed : schedulePercent}
                            onChange={(event) => (scheduleType === 'fixed' ? setScheduleFixed(event.target.value) : setSchedulePercent(event.target.value))}
                            data-testid="input-scheduling-deposit-value"
                          />
                          {scheduleType === 'percent' && <span className="text-sm text-muted-foreground">%</span>}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {scheduleType === 'fixed'
                          ? 'For example, $100.00 required before the job can be scheduled. If the estimate total is lower, the required amount is capped at that total.'
                          : 'Required deposit is the estimate total multiplied by this percentage.'}
                      </p>
                      {scheduleInvalid && <p className="text-sm text-destructive" role="alert">{scheduleInvalid}</p>}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Deposit rules by estimate</p>
                    <p className="text-xs text-muted-foreground">Override the default amount on an estimate. Matching rules apply automatically, and the estimate form can use a different amount.</p>
                  </div>
                  <Switch checked={allowEstimateOverrides === true} onCheckedChange={setAllowEstimateOverrides} data-testid="switch-estimate-deposit-overrides" />
                </div>
                {allowEstimateOverrides && <CompanyDepositRules embedded />}
              </div>
            )}
            <AutosaveIndicator label="Deposit rules" status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={() => { void autosave.retry(); }} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
