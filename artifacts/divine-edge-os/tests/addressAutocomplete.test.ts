import { describe, expect, it, vi } from "vitest";
import { resolveAddressSuggestions, type AddressSuggestion } from "../src/lib/addressAutocompleteLogic";

describe("AddressAutocomplete localization", () => {
  it("passes the explicit tenant center for a normal query and keeps results within 200 miles", async () => {
    const center = { lat: 39.7392, lng: -104.9903 };
    const fallback: AddressSuggestion = {
      address: "12 Example St",
      city: "Denver",
      state: "CO",
      zip: "80202",
      lat: 39.74,
      lng: -104.99,
      label: "12 Example St, Denver, CO 80202",
      distanceMiles: 0.1,
      source: "photon",
    };
    const googleResult: AddressSuggestion = { ...fallback, source: "google" };
    const provider = vi.fn(async (_query: string, receivedCenter: typeof center | null) => {
      expect(receivedCenter).toEqual(center);
      return [googleResult];
    });

    const results = await resolveAddressSuggestions("12 Example", {
      items: [fallback],
      radiusApplied: true,
      center,
    }, provider);

    expect(provider).toHaveBeenCalledWith("12 Example", center);
    expect(results).toEqual([googleResult]);
  });
});