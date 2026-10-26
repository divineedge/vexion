/** Payment-session URLs must be hosted Stripe Checkout, never arbitrary redirects. */
export function verifiedCheckoutUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The payment page address is invalid. Please contact the office.");
  }
  if (parsed.origin !== "https://checkout.stripe.com" || parsed.username || parsed.password) {
    throw new Error("The payment page address is not trusted. Please contact the office.");
  }
  return parsed.href;
}
