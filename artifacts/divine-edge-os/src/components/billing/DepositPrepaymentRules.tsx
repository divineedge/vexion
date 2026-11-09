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
  allowEstimateOverrides: boolean;
  rules?: unknown[];
};

const EMPTY: EstimateDepositSettings = {
  enabled: false,
  defaultType: 'percent',
  defaultAmount: null,
  requireBeforeScheduling: false,
  allowEstimateOverrides: false,
};

function coerceDepositSettings(value: unknown): EstimateDepositSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<EstimateDepositSettings> : {};
  const defaultType = raw.defaultType === 'fixed' ? 'fixed' : 'percent';
  const amount = typeof raw.defaultAmount === 'number' && Number.isFinite(raw.defaultAmount) ? raw.defaultAmount : null;
  return {
    ...EMPTY,
    enabled: raw.enabled === true,
    defaultType,
    defaultAmount: amount,
    requireBeforeScheduling: raw.requireBeforeScheduling === true,
    allowEstimateOverrides: raw.allowEstimateOverrides === true,
  };
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
  const [allowEstimateOverrides, setAllowEstimateOverrides] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!tenantQuery.data || ready) return;
    setEnabled(loaded.enabled === true);
    setDefaultType(loaded.defaultType === 'fixed' ? 'fixed' : 'percent');
    setAmount(loaded.defaultAmount != null ? String(loaded.defaultAmount) : '');
    setRequireBeforeScheduling(loaded.requireBeforeScheduling === true);
    setAllowEstimateOverrides(loaded.allowEstimateOverrides === true);
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
  const invalid = enabled && (!amount.trim() || !Number.isFinite(parsed) || parsed <= 0 || (defaultType === 'percent' && parsed > 100));
  const settings = {
    enabled,
    defaultType,
    defaultAmount: amount.trim() && Number.isFinite(parsed) ? parsed : null,
    requireBeforeScheduling,
    allowEstimateOverrides,
  };
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;
  const autosave = useSettingsAutosave((patch) => saveRef.current(patch.settings as Omit<EstimateDepositSettings, 'rules'>));
  useAutosaveFields({ settings }, ready, autosave.queue, canEdit && !invalid);

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
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Require deposit before scheduling</p>
                    <p className="text-xs text-muted-foreground">Jobs created from estimates stay unscheduled until this deposit is paid. A paid invoice or a collected estimate deposit counts.</p>
                  </div>
                  <Switch checked={requireBeforeScheduling === true} onCheckedChange={setRequireBeforeScheduling} data-testid="switch-require-deposit-before-scheduling" />
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
