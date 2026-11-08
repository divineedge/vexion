import { afterEach, describe, expect, it, vi } from "vitest";

const keys = ["EXPO_PUBLIC_API_BASE_URL"] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("field app API base URL", () => {
  it("uses VITE_API_URL before EXPO_PUBLIC_API_BASE_URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://vite.example.com");
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.example.com";
    const { BASE_URL, API_BASE_URL, apiUrl } = await import("./apiBaseUrl");
    expect(BASE_URL).toBe("https://vite.example.com");
    expect(API_BASE_URL).toBe("https://vite.example.com");
    expect(apiUrl("/api/auth/signup")).toBe("https://vite.example.com/api/auth/signup");
  });

  it("uses EXPO_PUBLIC_API_BASE_URL when VITE_API_URL is unset", async () => {
    vi.stubEnv("VITE_API_URL", "");
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.example.com/";
    const { BASE_URL, apiUrl } = await import("./apiBaseUrl");
    expect(BASE_URL).toBe("https://api.example.com/");
    expect(apiUrl("/api/auth/signup")).toBe("https://api.example.com/api/auth/signup");
    expect(apiUrl("/api/auth/login")).toBe("https://api.example.com/api/auth/login");
  });

  it("stays empty when neither env var is set", async () => {
    vi.stubEnv("VITE_API_URL", "");
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    const { BASE_URL, apiUrl } = await import("./apiBaseUrl");
    expect(BASE_URL).toBe("");
    expect(apiUrl("/api/auth/signup")).toBe("/api/auth/signup");
  });
});
