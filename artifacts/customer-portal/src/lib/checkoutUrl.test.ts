import { describe, expect, it } from "vitest";
import { verifiedCheckoutUrl } from "./checkoutUrl";

describe("Stripe Checkout redirects", () => {
  it("preserves a hosted session's query string and fragment", () => {
    const url = "https://checkout.stripe.com/c/pay/cs_test_fixture?locale=en#payment";
    expect(verifiedCheckoutUrl(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)", "data:text/html,unsafe",
    "http://checkout.stripe.com/c/pay/fixture", "//checkout.stripe.com/c/pay/fixture",
    "https://checkout.stripe.com.evil.invalid/pay",
    "https://checkout.stripe.com@evil.invalid/pay",
    "https://evil.invalid/checkout.stripe.com", "https://checkout.stripe.com:444/pay",
    "https://user:password@checkout.stripe.com/pay", "/payment", "",
  ])("rejects an untrusted destination: %s", url => {
    expect(() => verifiedCheckoutUrl(url)).toThrow();
  });
});
