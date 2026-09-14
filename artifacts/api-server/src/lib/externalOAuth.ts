import crypto from "node:crypto";
import { EXTERNAL_SCOPES, type ExternalScope } from "./externalAccess";

const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * An OAuth issuer is a deployment identity, not a value supplied by a client.
 * Development has a Replit-provided domain fallback; production must configure
 * OAUTH_ISSUER explicitly so a Host header can never mint discovery URLs.
 */
export function oauthIssuer(): string | null {
  const configured = process.env.OAUTH_ISSUER
    ?? (process.env.NODE_ENV !== "production" ? process.env.REPLIT_DEV_DOMAIN : undefined);
  if (!configured) return null;
  const candidate = configured.startsWith("http") ? configured : `https://${configured}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function oauthEndpoints(issuer = oauthIssuer()) {
  if (!issuer) return null;
  const resource = `${issuer}/api/external/mcp`;
  return {
    issuer,
    resource,
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource/api/external/mcp`,
    authorizationEndpoint: `${issuer}/api/oauth/authorize`,
    tokenEndpoint: `${issuer}/api/oauth/token`,
    consentPage: `${issuer}/`,
  };
}

export function protectedResourceMetadata() {
  const endpoints = oauthEndpoints();
  if (!endpoints) return null;
  return {
    resource: endpoints.resource,
    authorization_servers: [endpoints.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [...EXTERNAL_SCOPES],
  };
}

export function authorizationServerMetadata() {
  const endpoints = oauthEndpoints();
  if (!endpoints) return null;
  return {
    issuer: endpoints.issuer,
    authorization_endpoint: endpoints.authorizationEndpoint,
    token_endpoint: endpoints.tokenEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...EXTERNAL_SCOPES],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  };
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
export function randomOAuthValue(prefix: "eao" | "eac" | "oar" | "oac"): string {
  return `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
}
export function pkceS256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
export function isValidPkceChallenge(value: unknown): value is string {
  return typeof value === "string" && S256_CHALLENGE.test(value);
}
export function isValidPkceVerifier(value: unknown): value is string {
  return typeof value === "string" && PKCE_VALUE.test(value);
}

export function validateRedirectUris(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10 || value.some((item) => typeof item !== "string")) {
    return { ok: false, error: "redirectUris must contain 1-10 HTTPS URLs" };
  }
  const uris = [...new Set(value)];
  if (uris.length !== value.length) return { ok: false, error: "redirectUris must not contain duplicates" };
  for (const value of uris) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash || url.toString() !== value) {
        return { ok: false, error: "Each redirect URI must be an exact absolute HTTPS URL without credentials or a fragment" };
      }
    } catch {
      return { ok: false, error: "Each redirect URI must be an exact absolute HTTPS URL without credentials or a fragment" };
    }
  }
  return { ok: true, value: uris };
}

export function parseRequestedScopes(value: unknown, allowed: readonly string[]): { ok: true; value: ExternalScope[] } | { ok: false; error: string } {
  if (value != null && typeof value !== "string") return { ok: false, error: "scope must be a space-delimited string" };
  const scopes = value?.trim() ? [...new Set(value.trim().split(/\s+/))] : [...allowed];
  if (!scopes.every((scope) => EXTERNAL_SCOPES.includes(scope as ExternalScope)) || !scopes.every((scope) => allowed.includes(scope))) {
    return { ok: false, error: "Requested scope is not approved for this connection" };
  }
  return { ok: true, value: scopes as ExternalScope[] };
}

export function oauthErrorRedirect(redirectUri: string, error: string, state: string | null, issuer: string | null = oauthIssuer()): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  if (issuer) url.searchParams.set("iss", issuer);
  return url.toString();
}