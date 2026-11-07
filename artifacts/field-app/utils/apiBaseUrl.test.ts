import { afterEach, describe, expect, it, vi } from "vitest";

const keys = ["EXPO_PUBLIC_API_BASE_URL", "VITE_API_BASE_URL"] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe("field app API base URL", () => {
  it("uses EXPO_PUBLIC_API_BASE_URL when it is set", async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.example.com";
    process.env.VITE_API_BASE_URL = "https://vite.example.com";
    const { API_BASE_URL, apiUrl } = await import("./apiBaseUrl");
    expect(API_BASE_URL).toBe("https://api.example.com");
    expect(apiUrl("/api/auth/signup")).toBe("https://api.example.com/api/auth/signup");
  });

  it("defaults to the production API when the env var is unset", async () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    process.env.VITE_API_BASE_URL = "https://vite.example.com";
    const { API_BASE_URL, apiUrl } = await import("./apiBaseUrl");
    expect(API_BASE_URL).toBe("https://workspaceapi-server-production-21ea.up.railway.app");
    expect(apiUrl("/api/auth/signup")).toBe(`${API_BASE_URL}/api/auth/signup`);
    expect(apiUrl("/api/auth/login")).toBe(`${API_BASE_URL}/api/auth/login`);
  });
});
