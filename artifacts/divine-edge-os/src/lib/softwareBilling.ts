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
