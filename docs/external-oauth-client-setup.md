# Remote MCP OAuth client setup

This is the provider-facing setup note for Divine Edge's remote MCP service. It
does not replace [External access setup](./external-access-setup.md) (the
existing opaque-bearer-token flow) or the repository's
[OAuth contract](./oauth-contract.md).

## Status and compatibility boundary

The official product documentation below describes **documented compatibility**:
the product can connect to a remote MCP server using the listed transport and
authorization mechanisms. It is not evidence that this particular deployment,
plan, or account works.

No Claude or ChatGPT account was available for live provider verification.
The existing deployment is public, and its canonical origin has been configured
as the production-only `OAUTH_ISSUER`; these code changes still require publishing.
Therefore this document makes **no claim
that either assistant has been verified live**. Record a dated, real-account
smoke test before calling a provider supported.

### Local verification — 2026-09-14

A disposable owner completed browser registration of an OAuth MCP client,
signed out, followed authorization through login continuation, and explicitly
approved consent. A local protocol harness intercepted the callback (no code was
sent to Claude), redeemed the code with S256, initialized MCP, and listed the
approved customer tool. Reusing the code was rejected. Owner revocation in the
settings UI invalidated the token with a 401 discovery challenge; the audit log
recorded registration, authorization, consent, and issuance. Focused regression
tests also cover wrong-verifier-then-correct redemption, scope escalation,
cross-tenant consent rejection, and legacy bearer behavior.

This verifies the local application flow, not a real assistant account.

The current non-OAuth connection remains:

```text
POST https://PUBLISHED_ORIGIN/api/external/mcp
Authorization: Bearer CONNECTION_TOKEN
```

Do not put that token in a URL. An assistant must either support a configured
request header (Claude documents this as a beta feature) or use the OAuth
contract. A provider's generic MCP support does not imply support for manually
pasting Divine Edge's bearer token.

## MCP authorization baseline

The [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization)
and its [client-registration rules](https://modelcontextprotocol.io/specification/latest/basic/authorization/client-registration)
are the normative baseline:

- For HTTP transports, authorization is optional, but a protected server should
  follow the MCP OAuth flow. The server publishes Protected Resource Metadata
  (RFC 9728), normally discovered from a `401` response's
  `WWW-Authenticate: Bearer resource_metadata="..."` challenge or a
  `/.well-known/oauth-protected-resource` URL.
- The client discovers and validates Authorization Server Metadata (RFC 8414 or
  OIDC discovery), uses authorization-code + PKCE, and sends the OAuth
  `resource` value in authorization and token requests. The server must bind
  and validate token audience. All authorization endpoints and redirects must
  use HTTPS, except native-app loopback redirects.
- Current MCP registration priority is: pre-registered client, Client ID
  Metadata Document (CIMD) when advertised, Dynamic Client Registration (DCR)
  as a fallback, then user-entered client information. CIMD client IDs are
  HTTPS URLs whose metadata contains `client_id`, `client_name`, and
  `redirect_uris`; redirect URIs must be validated against that metadata.
- The current client-registration page labels DCR deprecated for new
  implementations; it remains a backwards-compatibility fallback when CIMD
  is unavailable.
- Clients must use PKCE and verify `S256` support. Authorization-server issuer
  and returned `iss` values must be compared exactly; do not normalize a
  trailing slash, port, path, or casing.

The specification's
[security guidance](https://modelcontextprotocol.io/specification/latest/basic/authorization/security-considerations)
also requires secure token storage, short-lived access tokens where practical,
and audience validation. A client registration is not permission to bypass
Divine Edge's owner consent, scopes, expiry, or connection revocation.

## Divine Edge OAuth contract

After publishing the OAuth routes on the configured
HTTPS origin, the provider-facing values are:

```text
MCP endpoint:
  https://PUBLISHED_ORIGIN/api/external/mcp
Protected Resource Metadata:
  https://PUBLISHED_ORIGIN/.well-known/oauth-protected-resource/api/external/mcp
Authorization Server Metadata:
  https://PUBLISHED_ORIGIN/.well-known/oauth-authorization-server
Authorization endpoint:
  https://PUBLISHED_ORIGIN/api/oauth/authorize
Token endpoint:
  https://PUBLISHED_ORIGIN/api/oauth/token
```

An owner explicitly creates one OAuth MCP connection per assistant. The
registration contains the assistant name, approved scopes, write flag, expiry,
and the assistant's exact redirect URI. The contract deliberately uses a
pre-registered public client: no client secret, DCR disabled, PKCE `S256`
required, exact string redirect matching, and HTTPS redirect URIs only (up to
ten per registration). Authorization codes are single-use and short-lived;
access tokens expire within one hour or at the connection expiry. There are no
refresh tokens in this contract, so a client may need to ask the owner to
authenticate again after expiry.

Those constraints are intentionally stricter than the broad MCP standard.
Never guess a callback, accept a wildcard redirect, enable DCR merely to make a
client connect, or reuse a connection for multiple unrelated assistants.

## Claude

### What Anthropic documents

Anthropic's current [remote-MCP connector
instructions](https://claude.com/docs/connectors/custom/remote-mcp) support
Streamable HTTP. For Team/Enterprise, an owner goes to **Organization settings
> Connectors > Add > Custom > Web**, enters the MCP URL, optionally enters an
OAuth client ID/secret in Advanced settings, and adds it. Members then go to
**Customize > Connectors** and click **Connect**. Free/Pro/Max users can add a
custom connector from **Customize > Connectors**. The connector is enabled per
conversation from the `+` menu.

Anthropic's [authentication
reference](https://claude.com/docs/connectors/building/authentication) documents
these relevant modes:

- Claude supports OAuth DCR and CIMD, and also a custom connection where the
  user enters a pre-registered OAuth client. The client secret is optional for
  a public client.
- Hosted Claude surfaces use this documented callback:
  `https://claude.ai/api/mcp/auth_callback`.
- Claude supports Streamable HTTP and sends `code_challenge_method=S256`.
  It supports refresh/expiry handling.
- Static API-key or bearer request headers are a beta `static_headers` mode
  configured by an organization administrator. The standard `authorization`
  header is supported. This is a shared organization credential, not
  per-user delegated OAuth.
- Remote connectors are reached from Anthropic's cloud, so the MCP and
  discovery endpoints must be public and reachable from Anthropic's egress
  ranges. See the [network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Conditional setup for this service

For the repository's pre-registered public-client contract, use Claude's
**custom connection / Use your own OAuth client** path:

1. Use a published HTTPS MCP URL, not a development-preview URL.
2. Before creating the owner connection, use Claude's documented callback
   exactly as `https://claude.ai/api/mcp/auth_callback`. Register only that
   URI; do not add a guessed Claude Code loopback URI unless Claude Code is a
   separately approved client.
3. Have the company owner create an OAuth MCP connection with client name
   `Claude`, the minimum scopes, writes disabled unless needed, an expiry, and
   that exact redirect URI. Keep the returned client ID confidential enough to
   prevent accidental reassignment, although it is a public-client identifier.
4. In Claude, add the MCP URL, choose the custom/pre-registered OAuth client
   option, enter the returned client ID, and leave the secret blank. Click
   **Connect** and complete the owner consent page.
5. Enable only the connector tools needed for the conversation and verify a
   read operation before considering any write operation.

This is a **documented setup path**, not a verified result. If the product
instead selects DCR/CIMD and provides no way to enter the pre-registered client
ID, stop: the current contract intentionally does not offer DCR or CIMD.

For a legacy bearer connection, the documented Claude `static_headers` beta may
accept `Authorization: Bearer <connection token>` when that option is available
to the organization. It is shared by that organization, shown only at
creation/rotation, and is not a claim that the option is enabled for a given
account. Prefer OAuth for user consent and revocation.

## ChatGPT

### What OpenAI documents

OpenAI's [ChatGPT developer-mode and MCP-app
instructions](https://help.openai.com/articles/12584461) currently describe
custom MCP apps for Business and Enterprise/Edu workspaces on ChatGPT web.
An administrator enables **Workspace settings > Permissions & Roles >
Connected Data Developer mode / Create custom MCP connectors**. An authorized
user then goes to **Apps > Create**, enters the MCP endpoint and metadata,
chooses authentication, clicks **Scan Tools**, completes OAuth if prompted,
and clicks **Create**. Test the draft in a new chat before publishing it.
Availability, rollout, role, and plan restrictions can change.

OpenAI's [Apps SDK authentication
guide](https://developers.openai.com/apps-sdk/build/auth) says a protected
server must publish Protected Resource Metadata and Authorization Server
Metadata, support authorization-code + PKCE with `S256`, echo `resource`
through the flow, and validate issuer, audience, expiry, and scopes. It
documents ChatGPT client identification using CIMD, DCR, or a predefined OAuth
client. When CIMD is used, ChatGPT's current production metadata/redirect mode
is shown in the app management page.

**Copy the exact production redirect URI shown by ChatGPT's app management
page into the owner registration. Do not infer it.** Depending on issuer
identification, OpenAI documents either:

```text
https://chatgpt.com/connector/oauth/{callback_id}
https://chatgpt.com/connector_platform_oauth_redirect
```

The stable URI requires the authorization server to advertise
`authorization_response_iss_parameter_supported: true` and return the exact
`iss` value in successful and error responses. OpenAI also recommends refresh
tokens (for OIDC, commonly `offline_access`) so the connection survives access
token expiry.

### Compatibility decision for this service

Do **not** advertise a working ChatGPT setup yet. The repository contract uses
an owner-pre-registered public client, does not expose DCR, does not advertise
CIMD, and does not issue refresh tokens. OpenAI's documented app flow centers
on CIMD, DCR, or a predefined client and does not document a field for pasting
an arbitrary per-connection bearer token. Initial OAuth may be technically
close, but the documented client-registration and token-lifetime behavior is
not an established match.

To evaluate ChatGPT later, first decide whether to add a standards-compliant
CIMD path (preferred for broadly hosted clients), a tightly controlled DCR
path, or an explicitly supported predefined ChatGPT client. Then use the exact
redirect shown by ChatGPT, perform an actual draft-app OAuth test, and record
the result. Do not loosen redirect or tenant binding just to make tool
discovery pass.

## Registration policy recommendation

1. Keep one owner-managed connection per assistant and bind every OAuth token
   to that connection's tenant, scopes, write flag, and expiry. Never accept a
   caller-selected tenant or treat tool discovery as authorization.
2. Keep explicit pre-registration as the safe supported path for clients such
   as Claude that expose a custom client ID. Require exact redirect equality and
   an owner approval page with sensitive-scope and write warnings.
3. If broad assistant support is a product requirement, implement CIMD next:
   validate the HTTPS metadata URL, exact `client_id`, client name, and
   redirect list, and restrict the token endpoint to public-client
   authentication plus PKCE. Add DCR only as a deliberate fallback, with
   registration rate limits, metadata/redirect validation, and a way to revoke
   registrations. Never run an unrestricted registration endpoint.
4. Keep hosted redirects on HTTPS. Support loopback only in a separately
   designed native-client policy with clear consent warnings; the current
   contract's HTTPS-only rule is appropriate for Claude.ai and ChatGPT web.
5. Add refresh tokens only with rotation and replay detection. Until then,
   document reauthentication explicitly instead of implying a connection is
   long-lived.

## Verification checklist

Before marking a provider “supported,” test on a published origin and record
the provider plan/account and date:

- Fetch both discovery documents and confirm their issuer/resource values and
  cache behavior. Confirm an unauthenticated MCP request returns `401` with the
  protected-resource metadata challenge.
- Create a least-privilege owner connection and confirm the exact registered
  redirect is the one the assistant uses.
- Complete consent, list tools, call one permitted read tool, and confirm an
  unapproved scope/write is denied.
- Confirm token expiry, connection pause/revocation, and owner deactivation stop
  subsequent calls; confirm no token, code, verifier, or customer payload is
  logged.
- For ChatGPT, include tool scan plus draft-app invocation. For Claude, include
  connector creation plus a hosted callback and token refresh/expiry test.