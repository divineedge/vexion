# Remote MCP OAuth contract

This service is an OAuth 2.1 authorization server and the protected resource for
the remote MCP endpoint. It follows the MCP authorization specification's
protected-resource discovery requirement and OAuth 2.1 authorization-code flow:
public clients use PKCE with `S256`; implicit, password, client-credentials, and
dynamic client registration are not supported.

## Public discovery and MCP endpoint

These URLs are absolute in the JSON returned at runtime. The application derives
them only from its configured canonical public origin (`OAUTH_ISSUER`, or the
Replit development domain outside production), never from a request Host header.

| URL | Method | Response |
| --- | --- | --- |
| `/.well-known/oauth-protected-resource/api/external/mcp` | GET | RFC 9728 protected-resource metadata. Its `resource` is `/api/external/mcp`; `authorization_servers` identifies this service. |
| `/.well-known/oauth-authorization-server` | GET | RFC 8414 authorization-server metadata. |
| `/api/external/mcp` | POST | Existing Streamable HTTP MCP endpoint. On absent/invalid OAuth bearer token, returns `401` and a `WWW-Authenticate: Bearer resource_metadata="…"` challenge. Existing `eac_` bearer credentials continue to work. |

## Owner management API

All management routes require the existing verified **company owner** staff
session; they never accept a tenant/user header.

| URL | Method | Request | Response |
| --- | --- | --- | --- |
| `/api/external-access/oauth-mcp-connections` | POST | `{name, description?, scopes, allowWrites, expiresAt, riskAcknowledged:true, clientName, redirectUris}` | `201 {connection, clientId, mcpUrl, authorizationServer, protectedResource}` |
| `/api/external-access/oauth-mcp-connections` | GET | — | OAuth registrations for the owner's tenant (no secrets). |

`redirectUris` is a non-empty, de-duplicated array (max 10) of absolute HTTPS
URLs without credentials or fragments. Redirect matching is exact string equality.
The service does **not** implement dynamic client registration: owners explicitly
register each assistant connection and its known redirect URI(s). A registration
is a public OAuth client, has no client secret, and requires PKCE.

Scopes use the existing external-access scope names. At authorization time a
client may ask only for a subset of the connection's pre-approved scopes; an
empty `scope` means the connection's approved set. A client cannot add scopes,
write authority, tenants, or staff identity through OAuth.

## Authorization and consent browser flow

1. The assistant directs the owner to:
   `GET /api/oauth/authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&state=...&resource=<encoded MCP URL>&scope=...`.
2. The API validates the pre-registered client, exact redirect URI, `resource`,
requested scope subset, and `S256` PKCE challenge. It creates a five-minute
pending request and redirects to `/?oauth_consent=<requestId>`.
3. The frontend calls `GET /api/oauth/consent/:requestId` with its existing
   `x-staff-session` header. The response shows the registered assistant,
   exact redirect URI, selected scopes, sensitive/write warnings, and expiry.
4. Only a verified `company_owner` may submit
   `POST /api/oauth/consent/:requestId` with
   `{decision:"approve"}` or `{decision:"deny"}` and `x-staff-session`.
   Approval redirects to the pre-registered redirect URI with `code`, the
   original `state`, and the exact authorization-server `iss`; denial redirects
   with `error=access_denied`, state, and `iss`. The AS metadata advertises
   `authorization_response_iss_parameter_supported:true` for RFC 9207.
   The UI must use a full-page navigation to the returned `redirectTo`.
5. The client exchanges the single-use code at `POST /api/oauth/token` as
   `application/x-www-form-urlencoded`:
   `grant_type=authorization_code&client_id=...&code=...&redirect_uri=...&resource=<encoded MCP URL>&code_verifier=...`.
   Success: `{access_token, token_type:"Bearer", expires_in:3600, scope}`.

Authorization codes expire after five minutes and are atomically consumed before
token issuance only when the submitted PKCE verifier's `S256` hash matches in
the same database transaction; a wrong verifier does not burn the code, while a
repeated/concurrent valid exchange returns `invalid_grant`. Access tokens are
opaque, last at most one hour and never past the connection expiry. There are no
refresh tokens. Disabling/revoking a connection, expiry, or owner deactivation
immediately invalidates its OAuth access tokens. OAuth consent, denial, token
exchange, and resource use are recorded in the existing tenant-scoped audit log.
The public authorization endpoint is rate-limited per registered client and
per client/network identity; its request, code, token, and rate-bucket state is
bounded by expiry cleanup. An expired/revoked OAuth bearer receives MCP's
`401` `WWW-Authenticate: Bearer error="invalid_token"` challenge with protected
resource metadata so clients can rediscover and reauthorize.

## Frontend handling

When `oauth_consent` is present, load consent details, clearly warn for all
sensitive scopes and for `allowWrites`, require an explicit owner click, then
POST the decision. Do not put staff session tokens, authorization codes, or
PKCE verifier in query strings, local logs, analytics, or redirect URLs.

### Compatibility note

The protocol endpoints are standards-oriented, but assistant products vary in
their currently supported remote-MCP OAuth registration/discovery behavior.
Only configure an assistant after it has documented support for protected
resource metadata, authorization-code + PKCE (`S256`), and an owner-entered
pre-registered client ID/redirect URI. Protocol support alone is not a claim of
compatibility with a particular assistant.