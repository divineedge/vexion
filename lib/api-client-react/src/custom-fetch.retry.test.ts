import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, customFetch } from "./custom-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("customFetch cold-start retries", () => {
  it("retries a network TypeError and then returns the JSON body", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(customFetch<{ ok: boolean }>("/api/health", {}, 2, 0)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Server waking up"));
  });

  it("does not retry an HTTP error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: "down" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(customFetch("/api/auth/signup", { method: "POST" }, 2, 0)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
