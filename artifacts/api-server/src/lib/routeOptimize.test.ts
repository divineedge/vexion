import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateRoute, optimizeRoute, type OptimizeStop } from "./routeOptimize";
import { zonedDateTime } from "./dailyRouteTime";

const shop = { address: "Shop", lat: 0, lng: 0 };

function stop(id: number, lat: number, status = "UPCOMING", locked = false): OptimizeStop {
  return { id, address: `${lat}`, lat, lng: 0, status, lockedTimeWindow: locked };
}

describe("route optimize", () => {
  const previous = process.env.GOOGLE_MAPS_API_KEY;

  afterEach(() => {
    if (previous == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previous;
    vi.restoreAllMocks();
  });

  it("reorders unlocked upcoming stops and keeps the return leg", () => {
    const result = estimateRoute([stop(1, 1), stop(2, 0.1)], shop, shop);
    expect(result.source).toBe("estimated");
    expect(result.order).toEqual([2, 1]);
    expect(result.legs).toHaveLength(3);
    expect(result.legs[0].fromId).toBeNull();
    expect(result.legs[0].toId).toBe(2);
    expect(result.legs[1]).toMatchObject({ fromId: 2, toId: 1 });
    expect(result.legs[2].toId).toBeNull();
    expect(result.totalDurationMinutes).toBe(result.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0));
    expect(result.legs.every(leg => leg.durationMinutes >= 0 && leg.distanceMiles >= 0)).toBe(true);
  });

  it("does not move a locked stop or let an unlocked stop jump over it", () => {
    const result = estimateRoute([stop(1, 1), stop(3, 0.2, "scheduled", true), stop(2, 0.05)], shop, shop);
    expect(result.order).toEqual([1, 3, 2]);
  });

  it("optimizes only the unlocked gap and leaves finished stops in place", () => {
    const result = estimateRoute([
      stop(9, 0.01, "completed"),
      stop(1, 1, "scheduled"),
      stop(2, 0.2, "scheduled"),
    ], shop, shop);
    expect(result.order).toEqual([9, 2, 1]);
  });

  it("uses Google traffic-aware optimization and never returns the key", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "server-only-maps-key";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.routingPreference).toBe("TRAFFIC_AWARE");
      expect(body.optimizeWaypointOrder).toBe(true);
      expect((init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("server-only-maps-key");
      return new Response(JSON.stringify({
        routes: [{
          optimizedIntermediateWaypointIndex: [1, 0],
          legs: [
            { duration: "600s", distanceMeters: 1609.344 },
            { duration: "300s", distanceMeters: 800 },
            { duration: "900s", distanceMeters: 3200 },
          ],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const result = await optimizeRoute(
      { origin: shop, destination: shop, stops: [stop(1, 1), stop(2, 0.1)] },
      { apiKey: "server-only-maps-key", fetchImpl: fetchImpl as typeof fetch },
    );
    expect(result.source).toBe("google");
    expect(result.order).toEqual([2, 1]);
    expect(result.legs.map(leg => leg.durationMinutes)).toEqual([10, 5, 15]);
    expect(JSON.stringify(result)).not.toContain("server-only-maps-key");
  });

  it("falls back to the estimator when the key is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await optimizeRoute(
      { origin: shop, destination: shop, stops: [stop(1, 1), stop(2, 0.1)] },
      { apiKey: null, fetchImpl: fetchImpl as typeof fetch },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.source).toBe("estimated");
    expect(result.order).toEqual([2, 1]);
  });

  it("still returns an order when Google fails", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network"); });
    const result = await optimizeRoute(
      { origin: shop, destination: shop, stops: [stop(1, 1), stop(2, 0.1)] },
      { apiKey: "server-only-maps-key", fetchImpl: fetchImpl as typeof fetch },
    );
    expect(result.source).toBe("estimated");
    expect(result.order).toEqual([2, 1]);
    expect(JSON.stringify(result)).not.toContain("server-only-maps-key");
  });
});

describe("zoned route time", () => {
  it("places 7:00 AM Denver on the same calendar day", () => {
    const instant = zonedDateTime("2026-11-28", 7 * 60, "America/Denver");
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Denver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
    expect(local.replace(",", "")).toContain("2026-11-28");
    expect(local).toContain("07:00");
  });
});
