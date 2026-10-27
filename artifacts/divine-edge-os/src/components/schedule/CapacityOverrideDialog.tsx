import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';

/** True when the API rejected a save because the crew's day is over capacity. */
export function isCapacityConflict(err: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const status = e?.status ?? e?.response?.status;
  if (status !== 409) return false;
  const body = e?.data ?? e?.response?.data ?? {};
  const text = `${body?.code ?? ''} ${body?.error ?? ''} ${body?.message ?? ''} ${e?.message ?? ''}`;
  return body?.code === 'crew_capacity_exceeded' || /capacit/i.test(text);
}

export function capacityConflictMessage(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const body = e?.data ?? e?.response?.data ?? {};
  return body?.error ?? body?.message ?? 'This crew is already at capacity for that day.';
}

export function capacityConflictWarnings(err: unknown): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const body = e?.data ?? e?.response?.data ?? {};
  return Array.isArray(body?.capacityWarnings) ? body.capacityWarnings.filter((w: unknown) => typeof w === 'string') : [];
}

/**
 * Shown when a job save returns a capacity 409. Staff can go back and pick another
 * date/crew, or a manager can explicitly override with a written reason. The server
 * decides whether the actor is allowed to override.
 */
export function CapacityOverrideDialog({ open, message, warnings = [], pending, error, onCancel, onOverride, onRetryWithDuration, durationMinutes }: {
  open: boolean;
  message: string;
  warnings?: string[];
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onOverride: (reason: string, minutes?: number) => void;
  onRetryWithDuration?: (minutes: number) => void;
  durationMinutes?: number;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('');
  useEffect(() => { if (open) { setConfirmed(false); setReason(''); setDuration(durationMinutes ? String(durationMinutes) : ''); } }, [open, durationMinutes]);
  const canOverride = confirmed && reason.trim().length >= 5 && !pending;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !pending) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" />Scheduling capacity warning</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        {warnings.length > 0 && (
          <ul className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1" data-testid="list-capacity-conflict">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Capacity includes the employee's or crew's other jobs and travel buffers. Choose a different date, employee, or crew, or ask a manager to override.</p>
        {onRetryWithDuration && <div className="space-y-2 rounded-md border p-3">
          <label htmlFor="capacity-job-duration" className="text-sm font-medium">This job's estimated duration (minutes)</label>
          <Input id="capacity-job-duration" type="number" min="1" step="1" value={duration} onChange={event => setDuration(event.target.value)} data-testid="input-capacity-duration" />
          <p className="text-xs text-muted-foreground">Enter or correct the duration here, then check again without overriding capacity.</p>
          <Button variant="outline" disabled={pending || !Number.isInteger(Number(duration)) || Number(duration) <= 0} onClick={() => onRetryWithDuration(Number(duration))} data-testid="button-capacity-recheck">Save duration &amp; check again</Button>
        </div>}
        <div className="space-y-2 rounded-md border p-3">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} data-testid="checkbox-capacity-override" className="mt-0.5" />
            <span>I'm a manager and I want to book this anyway.</span>
          </label>
          <Textarea rows={2} placeholder="Reason (required for override)" value={reason} onChange={e => setReason(e.target.value)} disabled={!confirmed} data-testid="input-capacity-override-reason" />
        </div>
        {error && <p className="text-sm text-destructive" data-testid="text-capacity-override-error">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending} data-testid="button-capacity-change">Change date or crew</Button>
          <Button onClick={() => onOverride(reason.trim(), Number.isInteger(Number(duration)) && Number(duration) > 0 ? Number(duration) : undefined)} disabled={!canOverride} data-testid="button-capacity-override">
            {pending ? 'Saving…' : 'Override and save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
