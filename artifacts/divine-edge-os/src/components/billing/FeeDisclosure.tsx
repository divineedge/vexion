import { bpsToPct, cents, boundsLabel } from '@/lib/softwareBilling';

type Rail = { bps: number | null | undefined; fixed: number | null | undefined; min: number | null | undefined; max: number | null | undefined };

export function railSummary(r: Rail) {
  const base = `${bpsToPct(r.bps ?? 0)} + ${cents(r.fixed ?? 0)}`;
  const b = boundsLabel(r.min, r.max);
  return b ? `${base} (${b})` : base;
}

/** Plain-language explanation of how the added platform fee is computed. */
export function FeeDisclosure({ card, ach, compact }: { card: Rail; ach: Rail; compact?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2" data-testid="fee-disclosure">
      <div className="grid sm:grid-cols-2 gap-2">
        <div><span className="text-muted-foreground">Card added platform fee</span><div className="font-medium tabular-nums" data-testid="disclosure-card">{railSummary(card)}</div></div>
        <div><span className="text-muted-foreground">ACH added platform fee</span><div className="font-medium tabular-nums" data-testid="disclosure-ach">{railSummary(ach)}</div></div>
      </div>
      {!compact && (
        <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
          <li>Percentage of the payment amount plus the fixed amount.</li>
          <li>Then raised to the minimum or capped at the maximum, if set.</li>
          <li>This platform fee is in addition to Stripe's own processing fee, which is charged separately.</li>
          <li>Both are deducted from the business's proceeds. The customer's invoice total does not increase.</li>
        </ol>
      )}
    </div>
  );
}
