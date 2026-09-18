import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type Settings = { periodDays: number; gallonThreshold: number | null; valueThreshold: number | null };
type Alert = { tankId: number; tankName: string; lossGallons: number; lossValue: number; adjustmentCount: number };
type Result = { settings: Settings; alerts: Alert[] };
export const fuelLossAlertKey = ['/api/bulk-fuel/loss-alerts'];

export function BulkFuelLossAlerts({ onHistory }: { onHistory: (tankId: number) => void }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: fuelLossAlertKey,
    queryFn: ({ signal }) => customFetch<Result>('/api/bulk-fuel/loss-alerts', { signal }),
    refetchInterval: 30_000,
    staleTime: 0,
  });
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState('30');
  const [gallons, setGallons] = useState('');
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: (settings: Settings) => customFetch<Settings>('/api/bulk-fuel/loss-alerts/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: fuelLossAlertKey });
      setOpen(false);
      toast.success('Loss warning settings saved');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Unable to save settings'),
  });
  const settings = query.data?.settings;
  return <section className="space-y-3 rounded-lg border p-4" aria-label="Reconciliation loss warnings">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="text-sm font-semibold">Reconciliation loss warnings</h4>
        <p className="text-xs text-muted-foreground">Measured stock corrections only — equipment dispensing is excluded. No expenses are created.</p>
      </div>
      <Button size="sm" variant="outline" disabled={!settings} onClick={() => {
        if (!settings) return;
        setDays(String(settings.periodDays));
        setGallons(settings.gallonThreshold == null ? '' : String(settings.gallonThreshold));
        setValue(settings.valueThreshold == null ? '' : String(settings.valueThreshold));
        setOpen(true);
      }}>Configure loss limits</Button>
    </div>
    {query.isLoading && <p className="text-sm text-muted-foreground">Loading loss warnings…</p>}
    {query.isError ? <div role="alert" className="text-sm text-destructive">Unable to load loss warnings. <Button variant="link" size="sm" onClick={() => query.refetch()}>Retry</Button></div> : settings && <>
      <p className="text-xs text-muted-foreground">
        {settings.gallonThreshold == null && settings.valueThreshold == null
          ? 'Warnings are off. Choose a gallon or dollar limit to enable them.'
          : `Warnings appear when losses recorded in the last ${settings.periodDays} days exceed ${[
              settings.gallonThreshold == null ? null : `${settings.gallonThreshold} gal`,
              settings.valueThreshold == null ? null : `$${settings.valueThreshold.toFixed(2)}`,
            ].filter(Boolean).join(' or ')}. Positive corrections do not offset losses.`}
      </p>
      {query.data?.alerts.map(alert => <div key={alert.tankId} role="status" className="flex gap-3 rounded-md border border-amber-400/50 bg-amber-500/10 p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">{alert.tankName}: reconciliation loss limit exceeded</p>
          <p>{alert.lossGallons.toLocaleString(undefined, { maximumFractionDigits: 3 })} gal · ${alert.lossValue.toFixed(2)} recorded value · {alert.adjustmentCount} negative correction{alert.adjustmentCount === 1 ? '' : 's'} in the last {settings.periodDays} days.</p>
          <Button variant="link" size="sm" className="h-auto px-0" onClick={() => onHistory(alert.tankId)}>Review tank history</Button>
        </div>
      </div>)}
      {(settings.gallonThreshold != null || settings.valueThreshold != null) && query.data?.alerts.length === 0 &&
        <p className="text-sm">No tanks exceed the configured loss limits.</p>}
    </>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reconciliation loss limits</DialogTitle><DialogDescription>Company-wide limits apply separately to each tank. Either exceeded limit triggers one informational warning per tank. Leave a limit blank to disable it.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          save.mutate({ periodDays: Number(days), gallonThreshold: gallons.trim() ? Number(gallons) : null, valueThreshold: value.trim() ? Number(value) : null });
        }}>
          <label className="block space-y-1 text-sm"><span>Rolling period (days)</span><Input required type="number" min="1" max="365" step="1" value={days} onChange={e => setDays(e.target.value)} /></label>
          <label className="block space-y-1 text-sm"><span>Gallon loss limit</span><Input type="number" min="0.001" step="0.001" placeholder="Off" value={gallons} onChange={e => setGallons(e.target.value)} /></label>
          <label className="block space-y-1 text-sm"><span>Recorded value loss limit ($)</span><Input type="number" min="0.01" step="0.01" placeholder="Off" value={value} onChange={e => setValue(e.target.value)} /></label>
          <p className="text-xs text-muted-foreground">The period uses when the correction was recorded, not its entered business date. Value is the loss value recorded at reconciliation, not today's fuel price.</p>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save limits'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}