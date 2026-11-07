import express from "express";
import cors from "cors";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { FIELD_APP_ORIGIN, corsOptions, isStaffSessionExempt } from "./publicAccess";

describe("public auth and health routes", () => {
  it.each([
    ["POST", "/auth/login"],
    ["POST", "/api/auth/login"],
    ["POST", "/auth/signup"],
    ["POST", "/api/auth/signup"],
    ["POST", "/auth/register"],
    ["GET", "/health"],
    ["GET", "/api/health"],
    ["GET", "/healthz"],
    ["OPTIONS", "/api/auth/login"],
  ])("does not require a session for %s %s", (method, path) => {
    expect(isStaffSessionExempt(method, path)).toBe(true);
  });

  it("still requires a session for authenticated auth routes", () => {
    expect(isStaffSessionExempt("GET", "/auth/me")).toBe(false);
    expect(isStaffSessionExempt("POST", "/auth/logout")).toBe(false);
    expect(isStaffSessionExempt("GET", "/jobs")).toBe(false);
  });
});

describe("field app CORS", () => {
  const app = express();
  app.use(cors(corsOptions));
  app.post("/api/auth/login", (_req, res) => { res.json({ ok: true }); });
  app.get("/api/health", (_req, res) => { res.json({ status: "ok" }); });

  it("allows the production field app to call login with credentials", async () => {
    const preflight = await request(app).options("/api/auth/login")
      .set("Origin", FIELD_APP_ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");
    expect(preflight.headers["access-control-allow-origin"]).toBe(FIELD_APP_ORIGIN);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    expect(preflight.headers["access-control-allow-methods"]).toEqual(expect.stringMatching(/GET/));
    expect(preflight.headers["access-control-allow-methods"]).toEqual(expect.stringMatching(/POST/));
    expect(preflight.headers["access-control-allow-headers"]).toEqual(expect.stringMatching(/authorization/i));

    const response = await request(app).post("/api/auth/login").set("Origin", FIELD_APP_ORIGIN).send({});
    expect(response.headers["access-control-allow-origin"]).toBe(FIELD_APP_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows a credentialed health check from the field app", async () => {
    const response = await request(app).get("/api/health").set("Origin", FIELD_APP_ORIGIN);
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(FIELD_APP_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
