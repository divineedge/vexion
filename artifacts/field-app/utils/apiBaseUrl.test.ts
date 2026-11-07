import { afterEach, describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./apiBaseUrl";

const keys = ["EXPO_PUBLIC_API_BASE_URL", "VITE_API_BASE_URL", "EXPO_PUBLIC_DOMAIN"] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function setEnv(values: Partial<Record<(typeof keys)[number], string | undefined>>) {
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

describe("field app API base URL", () => {
  it("reads EXPO_PUBLIC_API_BASE_URL, then VITE_API_BASE_URL", () => {
    setEnv({
      EXPO_PUBLIC_API_BASE_URL: "https://api.example.com/",
      VITE_API_BASE_URL: "https://vite.example.com",
    });
    expect(process.env.EXPO_PUBLIC_API_BASE_URL || process.env.VITE_API_BASE_URL).toBe("https://api.example.com/");
    expect(resolveApiBaseUrl()).toBe("https://api.example.com");

    setEnv({ EXPO_PUBLIC_API_BASE_URL: "", VITE_API_BASE_URL: "https://vite.example.com/" });
    expect(resolveApiBaseUrl()).toBe("https://vite.example.com");
  });

  it("falls back to the existing Expo domain when neither API base URL is set", () => {
    setEnv({ EXPO_PUBLIC_DOMAIN: "workspacefield-app-production.up.railway.app" });
    expect(resolveApiBaseUrl()).toBe("https://workspacefield-app-production.up.railway.app");

    setEnv({});
    expect(resolveApiBaseUrl()).toBeNull();
  });
});