import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';
import { useAutosaveFields, useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { AlertTriangle, CalendarClock, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type ScheduleDepositMode = 'fixed' | 'percent';
type ScheduleDepositRule = { enabled: boolean; mode: ScheduleDepositMode; value: number | null };

const queryKey = ['billing', 'schedule-deposit'] as const;
const EMPTY: ScheduleDepositRule = { enabled: false, mode: 'fixed', value: null };

export function ScheduleDepositCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const query = useQuery<{ rule: ScheduleDepositRule }>({
    queryKey,
    queryFn: () => customFetch<{ rule: ScheduleDepositRule }>('/api/billing/schedule-deposit'),
    enabled: canEdit,
  });
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<ScheduleDepositMode>('fixed');
  const [value, setValue] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!query.data || ready) return;
    const rule = query.data.rule ?? EMPTY;
    setEnabled(rule.enabled);
    setMode(rule.mode === 'percent' ? 'percent' : 'fixed');
    setValue(rule.value != null ? String(rule.value) : '');
    setReady(true);
  }, [query.data, ready]);

  const save = useMutation({
    mutationFn: (rule: ScheduleDepositRule) =>
      customFetch<{ rule: ScheduleDepositRule }>('/api/billing/schedule-deposit', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule }),
      }),
    onSuccess: (result) => { qc.setQueryData(queryKey, result); },
    onError: (error: unknown) => toast.error(error instanceof Error && error.message ? error.message : 'Failed to save scheduling deposit'),
  });
  const amount = Number(value);
  const invalid = enabled && (!value.trim() || !Number.isFinite(amount) || amount <= 0 || (mode === 'percent' && amount > 100));
  const rule: ScheduleDepositRule = { enabled, mode, value: enabled ? amount : (value.trim() ? amount : null) };
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;
  const autosave = useSettingsAutosave((patch) => saveRef.current(patch.rule as ScheduleDepositRule));
  useAutosaveFields({ rule }, ready, autosave.queue, canEdit && !invalid);

  if (!canEdit) return null;
  return (
    <Card data-testid="card-schedule-deposit">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" />Require Deposit to Schedule</CardTitle>
        <CardDescription>
          Collect this deposit before a job can be marked Scheduled on the calendar. Customer requests stay pending until the deposit is received. A paid invoice or a collected estimate deposit counts toward it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? <Skeleton className="h-20 w-full" /> : query.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-4 h-4" />Could not load the scheduling deposit.</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => query.refetch()}><RefreshCw className="w-3.5 h-3.5" />Retry</Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Require a deposit before scheduling</p>
                <p className="text-xs text-muted-foreground">Off leaves scheduling unchanged.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-schedule-deposit" />
            </div>
            {enabled && (
              <div className="grid gap-3 sm:grid-cols-[16rem_8rem]">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="select-schedule-deposit-mode">Deposit type</label>
                  <Select value={mode} onValueChange={(next) => setMode(next as ScheduleDepositMode)}>
                    <SelectTrigger id="select-schedule-deposit-mode" data-testid="select-schedule-deposit-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed dollar amount</SelectItem>
                      <SelectItem value="percent">Percentage of estimate or job total</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="input-schedule-deposit-value">{mode === 'percent' ? 'Percent' : 'Amount'}</label>
                  <div className="flex items-center gap-2">
                    {mode === 'fixed' && <span className="text-sm text-muted-foreground">$</span>}
                    <Input id="input-schedule-deposit-value" type="number" min={0} step={mode === 'percent' ? '1' : '0.01'} value={value} onChange={(event) => setValue(event.target.value)} data-testid="input-schedule-deposit-value" />
                    {mode === 'percent' && <span className="text-sm text-muted-foreground">%</span>}
                  </div>
                </div>
              </div>
            )}
            {invalid && <p className="text-sm text-destructive" role="alert">Not saved — enter a deposit greater than zero{mode === 'percent' ? ' and at most 100%' : ''}.</p>}
            <AutosaveIndicator label="Scheduling deposit" status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={() => { void autosave.retry(); }} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
