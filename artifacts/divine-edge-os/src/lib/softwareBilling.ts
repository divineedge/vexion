const ALLOWED_STRIPE_HOSTS = new Set(['checkout.stripe.com', 'billing.stripe.com', 'connect.stripe.com']);

/** Accept only exact HTTPS Stripe hosted-page URLs (no userinfo, no port, no lookalike hosts). */
export function safeStripeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password || u.port) return null;
  if (!ALLOWED_STRIPE_HOSTS.has(u.hostname)) return null;
  return u.toString();
}

export function redirectToStripe(raw: unknown): boolean {
  const url = safeStripeUrl(raw);
  if (!url) return false;
  window.location.assign(url);
  return true;
}

export const cents = (c: number | null | undefined) =>
  c == null ? null : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const bpsToPct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

export function feeLabel(bps: number | null | undefined, fixed: number | null | undefined) {
  if (bps == null && fixed == null) return 'Inherits company fee';
  return `${bpsToPct(bps ?? 0)} + ${cents(fixed ?? 0)}`;
}

export const REVERSED = (s: string) => /revers|refund|return/i.test(s) && s !== 'reversal_pending';

export function errorMessage(e: unknown, fallback: string) {
  const anyE = e as { data?: { error?: string; message?: string }; message?: string } | null;
  return anyE?.data?.error ?? anyE?.data?.message ?? anyE?.message ?? fallback;
}

// ── Feature catalog + fee bounds (local extended types until the SDK is regenerated) ──
export type FeatureDef = { key: string; label: string; description: string };
export type FeeBounds = {
  cardFeeMinCents?: number | null; cardFeeMaxCents?: number | null;
  achFeeMinCents?: number | null; achFeeMaxCents?: number | null;
};
export const MAX_BOUND_CENTS = 1_000_000_000; // $10,000,000

export function catalogOf(data: unknown): FeatureDef[] {
  const c = (data as { featureCatalog?: unknown } | null)?.featureCatalog;
  return Array.isArray(c) ? (c as FeatureDef[]) : [];
}

/** Split stored plan feature strings into catalog-mapped definitions and unmapped legacy strings. */
export function resolveFeatures(features: string[], catalog: FeatureDef[]) {
  const byKey = new Map(catalog.map(f => [f.key, f]));
  const mapped: FeatureDef[] = []; const unmapped: string[] = [];
  for (const f of features) { const d = byKey.get(f); if (d) mapped.push(d); else unmapped.push(f); }
  return { mapped, unmapped };
}

/** Strict dollars → cents. '' → null. Returns string error message on invalid input. */
export function dollarsToCents(v: string, label: string, maxCents = MAX_BOUND_CENTS): number | null | string {
  const t = v.trim().replace(/,/g, '');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return `${label} must be a non-negative dollar amount (2 decimals max)`;
  const c = Math.round(Number(t) * 100);
  if (c > maxCents) return `${label} must be at most ${cents(maxCents)}`;
  return c;
}
export const centsToDollars = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));

export function boundsLabel(min: number | null | undefined, max: number | null | undefined) {
  if (min == null && max == null) return '';
  if (min != null && max != null) return `min ${cents(min)}, max ${cents(max)}`;
  return min != null ? `min ${cents(min)}` : `max ${cents(max)}`;
}
