import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Loader2 } from 'lucide-react';

export interface RescheduleFeeChoice { chargeRescheduleFee: boolean; rescheduleFeeAmount: number }

/**
 * Asked before every reschedule. Staff must explicitly choose Yes or No.
 * Yes adds the (editable) fee to the job's billing; it never charges a card.
 * Cancel leaves the job untouched.
 */
export function RescheduleFeeDialog({ open, title, fromDate, toDate, defaultAmount, pending, error, onConfirm, onCancel, toLabel }: {
  open: boolean;
  title?: string;
  fromDate?: string | Date | null;
  toDate?: string | Date | null;
  /** Shown instead of a formatted toDate (e.g. date-only moves). */
  toLabel?: string;
  defaultAmount: number;
  pending?: boolean;
  error?: string | null;
  onConfirm: (choice: RescheduleFeeChoice) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<'yes' | 'no' | null>(null);
  const [amount, setAmount] = useState(String(defaultAmount));
  useEffect(() => { if (open) { setChoice(null); setAmount(defaultAmount.toFixed(2)); } }, [open, defaultAmount]);

  const amt = parseFloat(amount);
  const amountValid = Number.isFinite(amt) && amt > 0;
  const canSave = choice === 'no' || (choice === 'yes' && amountValid);
  const fmt = (d?: string | Date | null) => d ? format(new Date(d), 'EEE, MMM d, yyyy h:mm a') : '';

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !pending) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Charge a rescheduling fee?</DialogTitle>
          <DialogDescription>
            {title ? <span className="font-medium text-foreground">{title}</span> : 'This visit'}
            {fromDate ? <> moves from {fmt(fromDate)}</> : null}
            {(toLabel || toDate) ? <> to <span className="font-medium text-foreground">{toLabel ?? fmt(toDate)}</span></> : null}.
            {' '}Nothing changes until you save.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Charge a rescheduling fee" className="grid grid-cols-2 gap-2">
          {(['yes', 'no'] as const).map(v => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={choice === v}
              onClick={() => setChoice(v)}
              data-testid={`reschedule-fee-${v}`}
              className={`rounded-md border px-3 py-2.5 text-sm font-medium text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${choice === v ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
            >
              {v === 'yes' ? 'Yes, add a fee' : 'No fee'}
            </button>
          ))}
        </div>

        {choice === 'yes' && (
          <div className="space-y-1.5">
            <label htmlFor="reschedule-fee-amount" className="text-sm font-medium">Fee amount ($)</label>
            <Input id="reschedule-fee-amount" type="number" min={0} step={0.01} value={amount} onChange={e => setAmount(e.target.value)} className="w-36" data-testid="input-reschedule-fee-amount" />
            <p className="text-xs text-muted-foreground">Added to this job's billing. The customer's card is not charged automatically.</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive" role="alert">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error} The job was not changed.</span>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            onClick={() => onConfirm({ chargeRescheduleFee: choice === 'yes', rescheduleFeeAmount: choice === 'yes' ? Math.round(amt * 100) / 100 : 0 })}
            disabled={!canSave || pending}
            data-testid="button-confirm-reschedule"
          >
            {pending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Save reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defaultRescheduleFee(settings: any): number {
  const v = Number(settings?.oneTimeRescheduleCharge ?? settings?.routeExceptionFee ?? 0);
  return Number.isFinite(v) ? v : 0;
}

/** Move a timestamp to another calendar day while keeping its local wall-clock time. */
function zoneParts(instant: Date, tz?: string | null) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(instant)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** Instant for a wall-clock time in a timezone (DST-aware, two-pass offset correction). */
export function zonedWallTimeToDate(y: number, m: number, d: number, h: number, mi: number, s: number, tz?: string | null): Date {
  const target = Date.UTC(y, m - 1, d, h, mi, s);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    guess += target - asUtc;
  }
  return new Date(guess);
}

/**
 * Move an appointment to another calendar day, keeping its original wall-clock
 * time of day in the tenant timezone (DST-aware). `day` is a Date (its local
 * calendar date is used) or a 'YYYY-MM-DD' string.
 */
export function moveToDay(originalIso: string, day: Date | string, tz?: string | null): Date {
  const o = zoneParts(new Date(originalIso), tz);
  let y: number, m: number, d: number;
  if (typeof day === 'string') { [y, m, d] = day.slice(0, 10).split('-').map(Number); }
  else { y = day.getFullYear(); m = day.getMonth() + 1; d = day.getDate(); }
  try { return zonedWallTimeToDate(y, m, d, o.h, o.mi, o.s, tz); }
  catch { const n = new Date(y, m - 1, d); const oo = new Date(originalIso); n.setHours(oo.getHours(), oo.getMinutes(), oo.getSeconds()); return n; }
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const msg = e?.response?.data?.error ?? e?.data?.error ?? e?.data?.message;
  if (e?.status === 403) return msg ?? 'You do not have permission to reschedule this job.';
  return msg ?? (typeof e?.message === 'string' && e.message.trim() ? e.message : fallback);
}
