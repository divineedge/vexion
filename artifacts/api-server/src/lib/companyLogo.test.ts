import { afterEach, describe, expect, it } from "vitest";
import {
  companyLogoObjectPath,
  isSafeSvg,
  logoContentType,
  isPublishableLogoUrl,
  publicLogoUrl,
  requestOrigin,
  resolveStoredLogoUrl,
  withLogoCacheBust,
  supabasePublicObjectUrl,
  supabaseStorageConfig,
  uploadLogoToSupabase,
} from "./companyLogo";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const previous = { ...process.env };

afterEach(() => {
  process.env = { ...previous };
});

describe("company logos", () => {
  it("recognizes a PNG and rejects a script-bearing SVG", () => {
    expect(logoContentType(png)).toBe("image/png");
    expect(logoContentType(Buffer.from("<svg><script>alert(1)</script></svg>"))).toBeNull();
    expect(isSafeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>')).toBe(true);
  });

  it("builds the company-logos object path and public URL", () => {
    expect(companyLogoObjectPath(12, "image/jpeg")).toBe("12/logo.jpg");
    expect(supabasePublicObjectUrl("https://example.supabase.co/", "company-logos", "12/logo.jpg")).toBe(
      "https://example.supabase.co/storage/v1/object/public/company-logos/12/logo.jpg",
    );
    expect(publicLogoUrl("https://app.example", 12)).toBe("https://app.example/api/public/tenants/12/logo");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    expect(isPublishableLogoUrl("https://example.supabase.co/storage/v1/object/public/company-logos/12/logo.jpg", "https://app.example")).toBe(true);
    expect(isPublishableLogoUrl("https://evil.example/logo.png", "https://app.example")).toBe(false);
  });

  it("uses the forwarded host when no public app URL is configured", () => {
    delete process.env.PUBLIC_APP_URL;
    delete process.env.APP_URL;
    expect(requestOrigin({
      protocol: "http",
      get: (name) => name === "x-forwarded-host" ? "office.example" : name === "x-forwarded-proto" ? "https" : undefined,
    })).toBe("https://office.example");
  });

  it("saves the public bucket URL only when the object can be read", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    expect(supabaseStorageConfig()?.bucket).toBe("company-logos");
    const calls: string[] = [];
    const url = await uploadLogoToSupabase(4, png, "image/png", async (input) => {
      calls.push(input);
      return { ok: !input.includes("/object/public/"), status: 200 };
    });
    expect(url).toBeNull();
    expect(calls.some((call) => call.includes("/storage/v1/bucket"))).toBe(true);
    const visible = await uploadLogoToSupabase(4, png, "image/png", async () => ({ ok: true, status: 200 }));
    expect(visible).toBe("https://example.supabase.co/storage/v1/object/public/company-logos/4/logo.png");
  });

  it("persists the company-logos public URL, and the app URL when the bucket write fails", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    const methods: string[] = [];
    const published = await resolveStoredLogoUrl(9, png, "image/png", "https://app.example", async (input, init) => {
      methods.push(`${init?.method ?? "GET"} ${input}`);
      const post = init?.method === "POST" && input.includes("/storage/v1/object/");
      return { ok: !post, status: post ? 409 : 200 };
    });
    expect(published).toBe("https://example.supabase.co/storage/v1/object/public/company-logos/9/logo.png");
    expect(methods.some((call) => call.startsWith("PUT "))).toBe(true);
    const fallback = await resolveStoredLogoUrl(9, png, "image/png", "https://app.example", async () => {
      throw new Error("storage unavailable");
    });
    expect(fallback).toBe("https://app.example/api/public/tenants/9/logo");
    expect(withLogoCacheBust(published, 1700000000000)).toBe(`${published}?t=1700000000000`);
  });
});
